const fs = require('node:fs/promises');
const fsStreams = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parse } = require('@babel/parser');
const yauzl = require('yauzl');
const { analyzeRepository, classifyLayer, evaluateRules, loadRules } = require('./scanner');

const MAX_REPOSITORY_SIZE_KB = 50 * 1024;
const MAX_ARCHIVE_SIZE = 50 * 1024 * 1024;
const MAX_SOURCE_FILE_SIZE = 2 * 1024 * 1024;
const MAX_FILES = 3000;
const MAX_ARCHIVE_ENTRIES = 10000;
const SCAN_TIMEOUT_MS = 120000;
const HISTORY_TIMEOUT_MS = 10 * 60 * 1000;
const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx']);
const IGNORED_DIRECTORIES = new Set([
  '.git', 'node_modules', 'dist', 'build', '.next',
  'test', 'tests', '__tests__', 'mock', 'mocks', '__mocks__'
]);
const RESOLUTION_EXTENSIONS = ['.js', '.jsx', '.ts', '.tsx'];

class PublicScanError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function parseRepositoryUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) {
    throw new PublicScanError(400, 'invalid_repository_url', 'Enter a valid public GitHub repository URL.');
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new PublicScanError(400, 'invalid_repository_url', 'Enter a valid public GitHub repository URL.');
  }

  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com'
      || url.username || url.password || url.port || url.search || url.hash) {
    throw new PublicScanError(400, 'invalid_repository_url', 'Use an HTTPS repository URL from github.com.');
  }

  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length !== 2) {
    throw new PublicScanError(400, 'invalid_repository_url', 'Use a repository URL in the form https://github.com/owner/repository.');
  }
  const [owner, rawRepository] = segments;
  const repo = rawRepository.replace(/\.git$/i, '');
  if (!/^[A-Za-z0-9-]{1,100}$/.test(owner) || !/^[A-Za-z0-9._-]{1,100}$/.test(repo)) {
    throw new PublicScanError(400, 'invalid_repository_url', 'Use a repository URL in the form https://github.com/owner/repository.');
  }

  return { owner, repo };
}

function validateBranch(value) {
  if (value === undefined) return null;
  if (typeof value !== 'string' || !value.trim() || value.length > 255 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new PublicScanError(400, 'invalid_branch', 'Enter a valid branch name.');
  }
  return value.trim();
}

function isIgnoredPath(parts) {
  return parts.slice(0, -1).some((part) => IGNORED_DIRECTORIES.has(part.toLowerCase()));
}

function layerForPath(filePath) {
  const layer = classifyLayer(filePath);
  if (!layer || layer === 'shared') return 'other';
  return layer === 'service' ? 'services' : layer;
}

function collectModuleSpecifiers(ast) {
  const specifiers = new Set();
  const pending = [ast];

  while (pending.length) {
    const node = pending.pop();
    if (!node || typeof node !== 'object') continue;

    if (node.type === 'ImportDeclaration' || node.type === 'ExportNamedDeclaration'
        || node.type === 'ExportAllDeclaration') {
      if (node.source && typeof node.source.value === 'string') specifiers.add(node.source.value);
    } else if (node.type === 'ImportExpression' && node.source?.type === 'StringLiteral') {
      specifiers.add(node.source.value);
    } else if (node.type === 'CallExpression') {
      const [argument] = node.arguments;
      if (node.callee?.type === 'Import' && argument?.type === 'StringLiteral') {
        specifiers.add(argument.value);
      } else if (node.callee?.type === 'Identifier' && node.callee.name === 'require'
          && node.arguments.length === 1 && argument?.type === 'StringLiteral') {
        specifiers.add(argument.value);
      }
    } else if (node.type === 'TSImportType' && node.argument?.type === 'StringLiteral') {
      specifiers.add(node.argument.value);
    }

    for (const [key, value] of Object.entries(node)) {
      if (key === 'loc' || key === 'comments' || key === 'tokens' || key === 'extra') continue;
      if (Array.isArray(value)) {
        for (const child of value) {
          if (child && typeof child === 'object') pending.push(child);
        }
      } else if (value && typeof value === 'object') {
        pending.push(value);
      }
    }
  }

  return [...specifiers];
}

function resolveRelativeImport(from, specifier, fileSet) {
  if (!specifier.startsWith('.')) return null;
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier));
  if (base === '..' || base.startsWith('../') || path.posix.isAbsolute(base)) return null;

  const candidates = [base];
  const extension = path.posix.extname(base);
  if (extension) {
    if (RESOLUTION_EXTENSIONS.includes(extension)) {
      const withoutExtension = base.slice(0, -extension.length);
      candidates.push(...RESOLUTION_EXTENSIONS.map((candidate) => `${withoutExtension}${candidate}`));
    }
  } else {
    candidates.push(...RESOLUTION_EXTENSIONS.map((candidate) => `${base}${candidate}`));
  }
  candidates.push(...RESOLUTION_EXTENSIONS.map((candidate) => `${base}/index${candidate}`));
  return candidates.find((candidate) => fileSet.has(candidate)) || null;
}

function importsForFile(filePath, source) {
  const extension = path.posix.extname(filePath).toLowerCase();
  const plugins = ['decorators-legacy'];
  if (extension === '.ts' || extension === '.tsx') plugins.push('typescript');
  if (extension === '.js' || extension === '.jsx' || extension === '.tsx') plugins.push('jsx');

  let ast;
  try {
    ast = parse(source, { sourceType: 'unambiguous', plugins, errorRecovery: true });
  } catch {
    throw new PublicScanError(422, 'source_parse_failed', `Could not parse ${filePath}; the scanner does not support its syntax.`);
  }
  return collectModuleSpecifiers(ast);
}

function checkDeadline(deadline) {
  if (Date.now() > deadline) {
    throw new PublicScanError(504, 'scan_timeout', 'The repository scan took too long. Try a smaller repository.');
  }
}

async function fetchGitHub(url, signal, notFoundError = {
  code: 'repository_not_found',
  message: 'Repository not found or it is private.'
}, token) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'Driftwatch-Scanner'
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  let response;
  try {
    response = await fetch(url, {
      headers,
      signal
    });
  } catch (cause) {
    if (signal.aborted || cause.name === 'TimeoutError' || cause.name === 'AbortError') {
      throw new PublicScanError(504, 'scan_timeout', 'GitHub did not respond in time. Please try again.');
    }
    throw new PublicScanError(502, 'github_unavailable', 'Could not reach GitHub. Check your connection and try again.');
  }

  if (response.status === 404) {
    throw new PublicScanError(404, notFoundError.code, notFoundError.message);
  }
  if (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0') {
    throw new PublicScanError(
      429,
      'github_rate_limited',
      'GitHub API rate limit reached. Set GITHUB_TOKEN in .env to raise the limit.'
    );
  }
  if (!response.ok) {
    throw new PublicScanError(502, 'github_request_failed', 'GitHub could not complete the scan request. Please try again.');
  }
  return response;
}

async function readArchive(response, signal) {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_ARCHIVE_SIZE) {
    throw new PublicScanError(413, 'repository_too_large', 'This repository exceeds the 50 MB scan limit.');
  }
  if (!response.body) {
    throw new PublicScanError(502, 'invalid_archive', 'GitHub returned an empty repository archive.');
  }

  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      if (signal.aborted) throw new PublicScanError(504, 'scan_timeout', 'The repository scan took too long. Try again.');
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_ARCHIVE_SIZE) {
        await reader.cancel();
        throw new PublicScanError(413, 'repository_too_large', 'This repository exceeds the 50 MB scan limit.');
      }
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    if (error instanceof PublicScanError) throw error;
    if (signal.aborted) {
      throw new PublicScanError(504, 'scan_timeout', 'The repository scan took too long. Try again.');
    }
    throw new PublicScanError(502, 'archive_download_failed', 'Could not download the repository archive from GitHub.');
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, size);
}

function extractSourceFiles(archive, destination, deadline) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(archive, { lazyEntries: true, validateEntrySizes: true }, (openError, zip) => {
      if (openError) {
        reject(new PublicScanError(422, 'invalid_archive', 'GitHub returned an invalid repository archive.'));
        return;
      }

      const files = [];
      const configFiles = [];
      let rootFolder;
      let entryCount = 0;
      let fileCount = 0;
      let expandedSize = 0;
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        zip.close();
        if (error) reject(error);
        else resolve({ files: files.sort(), configFiles });
      };

      zip.on('error', () => finish(new PublicScanError(422, 'invalid_archive', 'GitHub returned an invalid repository archive.')));
      zip.on('end', () => finish());
      zip.on('entry', (entry) => {
        try {
          checkDeadline(deadline);
          entryCount += 1;
          if (entryCount > MAX_ARCHIVE_ENTRIES) {
            throw new PublicScanError(413, 'repository_too_large', 'This repository contains too many archive entries to scan.');
          }

          const entryName = entry.fileName.replace(/\\/g, '/');
          const parts = entryName.split('/').filter(Boolean);
          if (entryName.startsWith('/') || entryName.includes('\0') || parts.some((part) => part === '.' || part === '..')
              || parts.length === 0) {
            throw new PublicScanError(422, 'invalid_archive', 'GitHub returned an unsafe repository archive.');
          }
          if (!rootFolder) rootFolder = parts[0];
          if (parts[0] !== rootFolder) {
            throw new PublicScanError(422, 'invalid_archive', 'GitHub returned an invalid repository archive layout.');
          }
          const relativeParts = parts.slice(1);
          if (entry.fileName.endsWith('/') || relativeParts.length === 0) {
            zip.readEntry();
            return;
          }

          fileCount += 1;
          expandedSize += entry.uncompressedSize;
          if (fileCount > MAX_FILES) {
            throw new PublicScanError(413, 'repository_too_large', 'This repository contains more than 3,000 files, which exceeds the scan limit.');
          }
          if (!Number.isSafeInteger(expandedSize) || expandedSize > MAX_ARCHIVE_SIZE) {
            throw new PublicScanError(413, 'repository_too_large', 'This repository exceeds the 50 MB extracted-size scan limit.');
          }

          const relativePath = relativeParts.join('/');
          const extension = path.posix.extname(relativePath).toLowerCase();
          const isRuleConfig = relativeParts.length === 1
            && ['driftwatch.yml', 'driftwatch.json'].includes(relativePath.toLowerCase());
          if (isIgnoredPath(relativeParts) || (!SOURCE_EXTENSIONS.has(extension) && !isRuleConfig)) {
            zip.readEntry();
            return;
          }
          if (entry.uncompressedSize > (isRuleConfig ? 128 * 1024 : MAX_SOURCE_FILE_SIZE)) {
            throw new PublicScanError(
              413,
              'source_file_too_large',
              isRuleConfig
                ? 'A rule configuration exceeds the 128 KiB per-file scan limit.'
                : 'A source file exceeds the 2 MiB per-file scan limit.'
            );
          }

          const unixMode = (entry.externalFileAttributes >>> 16) & 0xf000;
          if (unixMode === 0xa000) {
            throw new PublicScanError(422, 'invalid_archive', 'Symbolic links are not supported in repository archives.');
          }
          const outputPath = path.join(destination, ...relativeParts);
          fs.mkdir(path.dirname(outputPath), { recursive: true }).then(() => {
            zip.openReadStream(entry, (streamError, stream) => {
              if (streamError) {
                finish(new PublicScanError(422, 'invalid_archive', 'Could not read a file from the repository archive.'));
                return;
              }
              const output = fsStreams.createWriteStream(outputPath, { flags: 'wx' });
              stream.on('error', () => finish(new PublicScanError(422, 'invalid_archive', 'Could not read a file from the repository archive.')));
              output.on('error', () => finish(new PublicScanError(422, 'invalid_archive', 'Could not extract a file from the repository archive.')));
              output.on('finish', () => {
                if (isRuleConfig) configFiles.push(relativePath);
                else files.push(relativePath);
                zip.readEntry();
              });
              stream.pipe(output);
            });
          }).catch(() => finish(new PublicScanError(500, 'scan_failed', 'Could not create the temporary scan workspace.')));
        } catch (error) {
          finish(error);
        }
      });
      zip.readEntry();
    });
  });
}

async function getRepositoryMetadata(owner, repo, signal, token) {
  const metadataResponse = await fetchGitHub(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
    signal,
    undefined,
    token
  );
  let metadata;
  try {
    metadata = await metadataResponse.json();
  } catch {
    throw new PublicScanError(502, 'invalid_github_response', 'GitHub returned invalid repository information.');
  }
  if (metadata.private) {
    throw new PublicScanError(403, 'private_repository', 'Private repositories are not supported; use a public GitHub repository.');
  }
  if (!Number.isFinite(metadata.size) || typeof metadata.default_branch !== 'string') {
    throw new PublicScanError(502, 'invalid_github_response', 'GitHub returned invalid repository information.');
  }
  if (metadata.size > MAX_REPOSITORY_SIZE_KB) {
    throw new PublicScanError(413, 'repository_too_large', 'This repository exceeds the 50 MB scan limit.');
  }
  return metadata;
}

async function scanRepositoryAtRef({
  owner,
  repo,
  branch,
  ref,
  signal,
  deadline,
  token,
  notFoundError = { code: 'commit_not_found', message: `Commit "${ref}" could not be downloaded.` }
}) {
  let workspace;
  try {
    checkDeadline(deadline);
    const archiveResponse = await fetchGitHub(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/zipball/${encodeURIComponent(ref)}`,
      signal,
      notFoundError,
      token
    );
    const archive = await readArchive(archiveResponse, signal);
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'driftwatch-public-scan-'));
    const repositoryPath = path.join(workspace, 'repository');
    await fs.mkdir(repositoryPath);
    const { files: sourcePaths, configFiles } = await extractSourceFiles(archive, repositoryPath, deadline);
    const fileSet = new Set(sourcePaths);
    const files = [];
    const dependencies = new Map();
    const layers = { frontend: 0, backend: 0, services: 0, database: 0, other: 0 };
    const { rules, error: ruleConfigError } = await loadRules(repositoryPath, configFiles);

    for (const filePath of sourcePaths) {
      checkDeadline(deadline);
      const layer = layerForPath(filePath);
      layers[layer] += 1;
      files.push({ path: filePath, layer });
      const source = await fs.readFile(path.join(repositoryPath, ...filePath.split('/')), 'utf8');
      for (const specifier of importsForFile(filePath, source)) {
        const target = resolveRelativeImport(filePath, specifier, fileSet);
        if (target && target !== filePath) {
          const targetLayer = layerForPath(target);
          dependencies.set(`${filePath}\0${target}`, {
            from: filePath,
            to: target,
            fromLayer: layer === 'services' ? 'service' : layer,
            toLayer: targetLayer === 'services' ? 'service' : targetLayer
          });
        }
      }
    }

    const resolvedDependencies = [...dependencies.values()];
    const ruleResults = evaluateRules(resolvedDependencies, rules);
    return {
      repo: `${owner}/${repo}`,
      branch,
      fileCount: files.length,
      files,
      dependencies: resolvedDependencies.map(({ from, to }) => ({ from, to })).sort((left, right) =>
        left.from.localeCompare(right.from) || left.to.localeCompare(right.to)),
      layers,
      ...ruleResults,
      ruleConfigError
    };
  } finally {
    if (workspace) await fs.rm(workspace, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

async function scanPublicRepository(input) {
  const { owner, repo } = parseRepositoryUrl(input.url);
  const requestedBranch = validateBranch(input.branch);
  const signal = AbortSignal.timeout(SCAN_TIMEOUT_MS);
  const deadline = Date.now() + SCAN_TIMEOUT_MS;
  const token = process.env.GITHUB_TOKEN && process.env.GITHUB_TOKEN.trim() || undefined;
  const metadata = await getRepositoryMetadata(owner, repo, signal, token);
  const branch = requestedBranch || metadata.default_branch;
  return scanRepositoryAtRef({
    owner,
    repo,
    branch,
    ref: branch,
    signal,
    deadline,
    token,
    notFoundError: { code: 'branch_not_found', message: `Branch "${branch}" was not found in this repository.` }
  });
}

function validateHistoryLimit(value) {
  if (value === undefined) return 12;
  if (!Number.isInteger(value) || value < 1 || value > 20) {
    throw new PublicScanError(400, 'invalid_limit', 'History limit must be an integer from 1 to 20.');
  }
  return value;
}

function sampleEvenly(items, limit) {
  if (items.length <= limit) return [...items];
  if (limit === 1) return [items[0]];
  return Array.from({ length: limit }, (_, index) =>
    items[Math.round(index * (items.length - 1) / (limit - 1))]
  );
}

function findFirstDriftCommit(points) {
  for (let index = 1; index < points.length; index += 1) {
    if (points[index].healthScore < points[index - 1].healthScore) {
      return {
        sha: points[index].sha,
        message: points[index].message,
        scoreDrop: points[index - 1].healthScore - points[index].healthScore
      };
    }
  }
  return null;
}

function commitDetails(commit) {
  const message = typeof commit.commit?.message === 'string'
    ? commit.commit.message.split(/\r?\n/, 1)[0].trim().slice(0, 200)
    : '';
  return {
    sha: commit.sha,
    message,
    author: commit.author?.login || commit.commit?.author?.name || commit.commit?.committer?.name || 'Unknown author',
    date: commit.commit?.author?.date || commit.commit?.committer?.date || null
  };
}

async function scanPublicHistory(input, token = process.env.GITHUB_TOKEN && process.env.GITHUB_TOKEN.trim() || undefined) {
  const { owner, repo } = parseRepositoryUrl(input.url);
  const requestedBranch = validateBranch(input.branch);
  const limit = validateHistoryLimit(input.limit);
  const deadline = Date.now() + HISTORY_TIMEOUT_MS;
  const signal = AbortSignal.timeout(HISTORY_TIMEOUT_MS);
  const metadata = await getRepositoryMetadata(owner, repo, signal, token);
  const branch = requestedBranch || metadata.default_branch;
  const commits = [];

  for (let page = 1; ; page += 1) {
    checkDeadline(deadline);
    const url = new URL(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits`);
    url.searchParams.set('sha', branch);
    url.searchParams.set('per_page', '100');
    url.searchParams.set('page', String(page));
    const response = await fetchGitHub(
      url,
      signal,
      { code: 'branch_not_found', message: `Branch "${branch}" was not found in this repository.` },
      token
    );
    let pageCommits;
    try {
      pageCommits = await response.json();
    } catch {
      throw new PublicScanError(502, 'invalid_github_response', 'GitHub returned invalid commit history.');
    }
    if (!Array.isArray(pageCommits)) {
      throw new PublicScanError(502, 'invalid_github_response', 'GitHub returned invalid commit history.');
    }
    if (!pageCommits.length && page === 1) {
      throw new PublicScanError(404, 'repository_not_found', 'No commits were found for this repository and branch.');
    }
    commits.push(...pageCommits.map(commitDetails));
    if (pageCommits.length < 100) break;
  }

  const selectedCommits = sampleEvenly(commits, limit);
  const outcomes = [];
  for (let index = 0; index < selectedCommits.length; index += 3) {
    const batch = selectedCommits.slice(index, index + 3);
    const batchOutcomes = await Promise.all(batch.map(async (commit) => {
      try {
        if (signal.aborted) throw new PublicScanError(504, 'history_timeout', 'The overall history scan timed out.');
        const scanSignal = AbortSignal.any([signal, AbortSignal.timeout(SCAN_TIMEOUT_MS)]);
        const analysis = await scanRepositoryAtRef({
          owner,
          repo,
          branch,
          ref: commit.sha,
          signal: scanSignal,
          deadline: Math.min(deadline, Date.now() + SCAN_TIMEOUT_MS),
          token
        });
        return {
          ...commit,
          healthScore: analysis.healthScore,
          fileCount: analysis.fileCount,
          critical: analysis.summary.critical,
          warnings: analysis.summary.warnings
        };
      } catch (error) {
        return {
          skipped: {
            sha: commit.sha,
            message: commit.message,
            reason: error instanceof PublicScanError
              ? error.message
              : 'This commit could not be scanned.'
          }
        };
      }
    }));
    outcomes.push(...batchOutcomes);
  }

  const chronological = outcomes.reverse();
  const points = chronological.filter((outcome) => !outcome.skipped);
  const skipped = chronological.flatMap((outcome) => outcome.skipped ? [outcome.skipped] : []);
  return {
    repo: `${owner}/${repo}`,
    branch,
    points,
    firstDriftCommit: findFirstDriftCommit(points),
    skipped
  };
}

async function scanHistory(input) {
  if (input && input.demo === true) {
    return require('./demo-history.json');
  }
  return scanPublicHistory(input || {});
}

async function scanDemoRepository() {
  const repositoryPath = path.join(__dirname, 'demo-repo');
  const analysis = await analyzeRepository(repositoryPath);
  const layers = { frontend: 0, backend: 0, services: 0, database: 0, other: 0 };
  const files = analysis.files.map((filePath) => {
    const layer = layerForPath(filePath);
    layers[layer] += 1;
    return { path: filePath, layer };
  });
  return {
    repo: 'demo-repo',
    branch: 'local',
    fileCount: analysis.fileCount,
    files,
    dependencies: analysis.dependencies.map(({ fromFile, toFile }) => ({ from: fromFile, to: toFile })),
    layers,
    violations: analysis.violations,
    healthScore: analysis.healthScore,
    summary: analysis.summary,
    ruleConfigError: analysis.ruleConfigError
  };
}

module.exports = {
  PublicScanError,
  importsForFile,
  findFirstDriftCommit,
  layerForPath,
  parseRepositoryUrl,
  sampleEvenly,
  scanDemoRepository,
  scanHistory,
  scanPublicRepository
};
