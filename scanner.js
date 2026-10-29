const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const runFile = promisify(execFile);
const MAX_FILES = 15000;
const MAX_SOURCE_SIZE = 128 * 1024;
const MAX_TOTAL_SOURCE_SIZE = 4 * 1024 * 1024;
const IGNORED_DIRECTORIES = new Set([
  '.git', '.hg', '.svn', '.next', '.nuxt', '.turbo', '.venv', 'venv', 'env',
  'node_modules', 'vendor', 'dist', 'build', 'coverage', '__pycache__',
  '.cache', 'target', 'Pods', 'bin', 'obj'
]);
const SOURCE_EXTENSIONS = new Set([
  '.c', '.cc', '.cpp', '.cs', '.css', '.dart', '.ex', '.exs', '.go', '.h',
  '.hpp', '.html', '.java', '.js', '.jsx', '.kt', '.kts', '.m', '.mm',
  '.php', '.py', '.rb', '.rs', '.scala', '.scss', '.sh', '.sql', '.swift',
  '.ts', '.tsx', '.vue', '.xml'
]);
const EXTENSION_LANGUAGES = {
  '.c': 'C', '.cc': 'C++', '.cpp': 'C++', '.cs': 'C#', '.css': 'CSS',
  '.dart': 'Dart', '.ex': 'Elixir', '.exs': 'Elixir', '.go': 'Go', '.h': 'C/C++',
  '.hpp': 'C++', '.html': 'HTML', '.java': 'Java', '.js': 'JavaScript',
  '.jsx': 'JavaScript', '.json': 'JSON', '.kt': 'Kotlin', '.kts': 'Kotlin',
  '.m': 'Objective-C', '.mm': 'Objective-C++', '.php': 'PHP', '.py': 'Python',
  '.rb': 'Ruby', '.rs': 'Rust', '.scala': 'Scala', '.scss': 'SCSS',
  '.sh': 'Shell', '.sql': 'SQL', '.swift': 'Swift', '.ts': 'TypeScript',
  '.tsx': 'TypeScript', '.vue': 'Vue', '.xml': 'XML', '.yaml': 'YAML',
  '.yml': 'YAML'
};
const MANIFEST_NAMES = new Set([
  'package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock',
  'pnpm-lock.yaml', 'bun.lock', 'bun.lockb', 'requirements.txt',
  'pyproject.toml', 'Pipfile', 'Pipfile.lock', 'poetry.lock', 'go.mod',
  'go.sum', 'Cargo.toml', 'Cargo.lock', 'composer.json', 'composer.lock',
  'pom.xml', 'build.gradle', 'build.gradle.kts', 'settings.gradle',
  'settings.gradle.kts', 'Gemfile', 'Gemfile.lock', 'mix.exs',
  'pubspec.yaml', 'Package.swift', 'Dockerfile'
]);
const LAYER_RULES = [
  ['database', /\b(database|db|data|schema|schemas|migration|migrations|repository|repositories|model|models|prisma)\b/i],
  ['service', /\b(service|services|domain|worker|workers|job|jobs|function|functions|lib|libs|library|libraries|util|utils|helper|helpers)\b/i],
  ['frontend', /\b(frontend|front-end|client|web|ui|view|views|component|components|pages|app)\b/i],
  ['backend', /\b(backend|back-end|server|api|controller|controllers|handler|handlers|route|routes)\b/i],
  ['shared', /\b(shared|common|lib|libs|library|libraries|util|utils|types|config|configuration)\b/i]
];
const LANGUAGE_BY_MANIFEST = [
  [['package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lock', 'bun.lockb'], 'JavaScript'],
  [['requirements.txt', 'pyproject.toml', 'Pipfile', 'Pipfile.lock', 'poetry.lock'], 'Python'],
  [['go.mod', 'go.sum'], 'Go'],
  [['Cargo.toml', 'Cargo.lock'], 'Rust'],
  [['composer.json', 'composer.lock'], 'PHP'],
  [['pom.xml', 'build.gradle', 'build.gradle.kts'], 'Java'],
  [['Gemfile', 'Gemfile.lock'], 'Ruby'],
  [['mix.exs'], 'Elixir'],
  [['pubspec.yaml'], 'Dart'],
  [['Package.swift'], 'Swift']
];
const IMPORT_PATTERN = /\b(?:import\s+(?:[^"'`]*?\s+from\s+)?|export\s+[^"'`]*?\s+from\s+|require\s*\(\s*)["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
const PYTHON_IMPORT_PATTERN = /^\s*(?:from\s+([\w.]+)\s+import\b|import\s+([\w.]+))/gm;
const GO_IMPORT_PATTERN = /^\s*import\s+(?:\([^)]*\)|"(.*?)"|[\w.]+\s+"(.*?)")/gms;
const DEFAULT_RULES = [
  {
    id: 'RULE-001',
    from: 'frontend',
    to: 'database',
    severity: 'critical',
    message: 'Frontend must not import database files.'
  },
  {
    id: 'RULE-002',
    from: 'frontend',
    to: 'backend',
    severity: 'critical',
    message: 'Frontend must not import backend files directly.'
  },
  {
    id: 'RULE-003',
    from: 'database',
    to: ['frontend', 'backend'],
    severity: 'critical',
    message: 'Database must not import frontend or backend files.'
  },
  {
    id: 'RULE-004',
    from: 'service',
    to: 'frontend',
    severity: 'warning',
    message: 'Services must not import frontend files.'
  }
];

const VALID_LAYERS = new Set(['frontend', 'backend', 'database', 'service', 'services', 'shared']);

function inferLayer(value) {
  return classifyLayer(value) || 'service';
}

function classifyLayer(value) {
  for (const [layer, pattern] of LAYER_RULES) {
    if (pattern.test(value)) return layer;
  }
  return null;
}

function sourceExtension(filePath) {
  const basename = path.posix.basename(filePath);
  if (basename === 'Dockerfile') return 'Dockerfile';
  return path.posix.extname(filePath).toLowerCase();
}

function languageForFile(filePath) {
  const extension = sourceExtension(filePath);
  return EXTENSION_LANGUAGES[extension] || (extension === 'Dockerfile' ? 'Dockerfile' : null);
}

function manifestDependencies(filePath, source) {
  const filename = path.posix.basename(filePath);
  if (filename === 'package.json') {
    try {
      const manifest = JSON.parse(source);
      return ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']
        .reduce((total, key) => total + Object.keys(manifest[key] || {}).length, 0);
    } catch {
      return null;
    }
  }
  if (filename === 'requirements.txt') {
    return source.split(/\r?\n/).filter((line) => line.trim() && !line.trim().startsWith('#')).length;
  }
  if (filename === 'go.mod') {
    return [...source.matchAll(/^\s*([\w.-]+(?:\/[\w.-]+)+)\s+v[\w.+-]+/gm)].length;
  }
  if (filename === 'Cargo.toml') {
    const sectionMatches = source.match(/^\[(?:dev-dependencies|build-dependencies|dependencies)(?:\.[^\]]+)?\]\s*$/gm) || [];
    return sectionMatches.length
      ? source.split(/\r?\n/).filter((line) => /^\s*[\w.-]+\s*=/.test(line)).length
      : 0;
  }
  if (filename === 'pyproject.toml') {
    const matches = source.match(/^\s*["']?[A-Za-z0-9_.-]+\s*(?:[<>=!~]|\s*=)/gm);
    return matches ? matches.length : 0;
  }
  if (filename === 'composer.json') {
    try {
      const manifest = JSON.parse(source);
      return Object.keys(manifest.require || {}).length + Object.keys(manifest['require-dev'] || {}).length;
    } catch {
      return null;
    }
  }
  return null;
}

function inferManifestLanguage(filename, languages) {
  for (const [files, language] of LANGUAGE_BY_MANIFEST) {
    if (files.includes(filename) && !languages.some((entry) => entry.name === language)) return language;
  }
  return null;
}

function moduleForPath(filePath, topLevelFolders) {
  const firstPart = filePath.split('/')[0];
  return topLevelFolders.has(firstPart) ? firstPart : '.';
}

function resolveRelativeImport(fromPath, specifier, fileSet) {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromPath), specifier));
  if (base === '..' || base.startsWith('../') || path.posix.isAbsolute(base)) return null;
  const candidates = [
    base,
    ...[...SOURCE_EXTENSIONS].map((extension) => `${base}${extension}`),
    ...[...SOURCE_EXTENSIONS].map((extension) => `${base}/index${extension}`)
  ];
  return candidates.find((candidate) => fileSet.has(candidate)) || null;
}

function importsFromSource(filePath, source, goModulePath) {
  const extension = sourceExtension(filePath);
  const imports = [];
  if (['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.vue'].includes(extension)) {
    for (const match of source.matchAll(IMPORT_PATTERN)) imports.push(match[1] || match[2]);
  } else if (extension === '.py') {
    for (const match of source.matchAll(PYTHON_IMPORT_PATTERN)) imports.push(match[1] || match[2]);
  } else if (extension === '.go') {
    const blocks = [...source.matchAll(/^\s*import\s*\(([\s\S]*?)\)/gm)].map((match) => match[1]);
    const singles = [...source.matchAll(/^\s*import\s+(?:[\w.]+\s+)?["']([^"']+)["']/gm)].map((match) => match[1]);
    for (const block of blocks) {
      for (const match of block.matchAll(/["']([^"']+)["']/g)) imports.push(match[1]);
    }
    for (const specifier of singles) imports.push(specifier);
    for (const match of source.matchAll(GO_IMPORT_PATTERN)) {
      for (const specifier of [match[1], match[2]]) {
        if (specifier && !imports.includes(specifier)) imports.push(specifier);
      }
    }
  }

  return imports.map((specifier) => {
    if (goModulePath && specifier.startsWith(`${goModulePath}/`)) {
      return `/${specifier.slice(goModulePath.length + 1)}`;
    }
    return specifier;
  });
}

function throwIfAborted(signal) {
  if (signal && signal.aborted) {
    const error = new Error('The repository scan was cancelled.');
    error.code = 'SCAN_CANCELLED';
    throw error;
  }
}

async function walkRepository(rootPath, onProgress = () => {}, signal, maxFiles = MAX_FILES) {
  const files = [];
  const folders = new Set();
  const pending = [''];

  while (pending.length) {
    throwIfAborted(signal);
    const relativeDirectory = pending.pop();
    const absoluteDirectory = path.join(rootPath, relativeDirectory);
    const entries = await fs.readdir(absoluteDirectory, { withFileTypes: true });

    for (const entry of entries) {
      throwIfAborted(signal);
      if (entry.name === '.git') continue;
      const relativePath = path.posix.join(relativeDirectory.split(path.sep).join('/'), entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name)) continue;
        folders.add(relativePath);
        pending.push(relativePath);
      } else if (entry.isFile() && !entry.isSymbolicLink()) {
        files.push(relativePath);
        if (files.length > maxFiles) {
          const error = new Error(`This repository contains more than ${maxFiles.toLocaleString()} files, which exceeds the scan limit.`);
          error.code = 'REPOSITORY_TOO_LARGE';
          throw error;
        }
        if (files.length % 100 === 0) onProgress(files.length);
      }
    }
  }

  files.sort();
  return { files, folders: [...folders].sort() };
}

function buildModules(files, folders) {
  const topLevelFolders = new Set(folders.map((folder) => folder.split('/')[0]));
  const moduleFiles = new Map([['.', []]]);
  for (const folder of topLevelFolders) moduleFiles.set(folder, []);
  for (const file of files) {
    const moduleName = moduleForPath(file, topLevelFolders);
    if (!moduleFiles.has(moduleName)) moduleFiles.set(moduleName, []);
    moduleFiles.get(moduleName).push(file);
  }

  const moduleEntries = [...moduleFiles.entries()]
    .filter(([name, moduleFilesList]) => moduleFilesList.length || name === '.')
    .sort(([left], [right]) => left === '.' ? -1 : right === '.' ? 1 : left.localeCompare(right))
    .slice(0, 40);
  const modules = moduleEntries.map(([name, moduleFilesList]) => ({
    id: name,
    name: name === '.' ? 'Root' : name,
    path: name === '.' ? '/' : `${name}/`,
    layer: inferLayer(name === '.' ? 'root' : name),
    fileCount: moduleFilesList.length
  }));
  const ids = new Set(modules.map((module) => module.id));
  return { modules, topLevelFolders, ids };
}

function buildEdges(sourceImports, modules, topLevelFolders, fileSet) {
  const dependencies = buildDependencies(sourceImports, modules, topLevelFolders, fileSet);
  const edgeCounts = new Map();
  for (const dependency of dependencies) {
    if (dependency.from === dependency.to) continue;
    const key = `${dependency.from}\u0000${dependency.to}`;
    edgeCounts.set(key, (edgeCounts.get(key) || 0) + 1);
  }
  return [...edgeCounts.entries()]
    .map(([key, count]) => {
      const [from, to] = key.split('\u0000');
      return { from, to, count };
    })
    .sort((left, right) => right.count - left.count || left.from.localeCompare(right.from));
}

function buildDependencies(sourceImports, modules, topLevelFolders, fileSet) {
  const dependencies = [];
  for (const [filePath, imports] of sourceImports) {
    const from = moduleForPath(filePath, topLevelFolders);
    if (!modules.has(from)) continue;

    for (const specifier of imports) {
      let targetPath = null;
      if (specifier.startsWith('.')) {
        targetPath = resolveRelativeImport(filePath, specifier, fileSet);
      } else if (specifier.startsWith('/')) {
        const modulePath = specifier.slice(1);
        const candidates = [
          modulePath,
          ...[...SOURCE_EXTENSIONS].map((extension) => `${modulePath}${extension}`),
          ...[...SOURCE_EXTENSIONS].map((extension) => `${modulePath}/index${extension}`)
        ];
        targetPath = candidates.find((candidate) => fileSet.has(candidate))
          || ([...fileSet].some((candidate) => candidate.startsWith(`${modulePath}/`)) ? `${modulePath}/` : null);
      } else {
        const pythonModule = specifier.split('.')[0];
        const goPrefix = [...modules].find((module) => specifier === module || specifier.startsWith(`${module}/`));
        if (goPrefix) targetPath = `${goPrefix}/${specifier.slice(goPrefix.length + 1)}`;
        else if (topLevelFolders.has(pythonModule)) targetPath = `${pythonModule}/`;
      }
      if (!targetPath) continue;

      const to = moduleForPath(targetPath, topLevelFolders);
      if (!modules.has(to)) continue;
      dependencies.push({
        from,
        to,
        fromFile: filePath,
        toFile: targetPath,
        fromLayer: layerForDependency(filePath, from),
        toLayer: layerForDependency(targetPath, to)
      });
    }
  }
  return dependencies;
}

function normalizeLayer(layer) {
  return layer === 'services' ? 'service' : layer;
}

function layerForDependency(filePath, moduleName) {
  return normalizeLayer(classifyLayer(filePath) || inferLayer(moduleName === '.' ? 'root' : moduleName));
}

function parseYamlRuleConfig(source) {
  const lines = source.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
  if (lines.shift() !== 'rules:') throw new Error('Expected a top-level "rules:" list.');
  const rules = [];
  let currentRule = null;
  for (const line of lines) {
    if (line.startsWith('- ')) {
      currentRule = {};
      rules.push(currentRule);
      const firstField = line.slice(2);
      if (firstField) addYamlRuleField(currentRule, firstField);
      continue;
    }
    if (!currentRule) throw new Error('Expected each rule to start with "- id:".');
    addYamlRuleField(currentRule, line);
  }
  return { rules };
}

function addYamlRuleField(rule, field) {
  const separator = field.indexOf(':');
  if (separator < 1) throw new Error(`Invalid rule field "${field}".`);
  const key = field.slice(0, separator).trim();
  const rawValue = field.slice(separator + 1).trim();
  if (!['id', 'from', 'to', 'severity', 'message'].includes(key) || Object.hasOwn(rule, key)) {
    throw new Error(`Unknown or duplicate rule field "${key}".`);
  }
  let value = rawValue;
  if (rawValue.startsWith('"')) {
    try {
      value = JSON.parse(rawValue);
    } catch {
      throw new Error(`Invalid quoted value for "${key}".`);
    }
  } else if (rawValue.startsWith("'")) {
    if (!rawValue.endsWith("'") || rawValue.length < 2) {
      throw new Error(`Invalid quoted value for "${key}".`);
    }
    value = rawValue.slice(1, -1).replace(/''/g, "'");
  } else if (!rawValue || /(^|\s)#/.test(rawValue)) {
    value = rawValue.split(/\s+#/, 1)[0].trim();
  }
  if (typeof value !== 'string' || !value) throw new Error(`Rule field "${key}" must have a value.`);
  rule[key] = value;
}

function validateCustomRules(config) {
  if (!config || typeof config !== 'object' || !Array.isArray(config.rules)) {
    throw new Error('Expected a "rules" array.');
  }
  const ids = new Set();
  return config.rules.map((rule, index) => {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
      throw new Error(`Rule ${index + 1} must be an object.`);
    }
    const { id, from, to, severity, message } = rule;
    if (typeof id !== 'string' || !/^RULE-[A-Z0-9-]+$/.test(id)) {
      throw new Error(`Rule ${index + 1} has an invalid id.`);
    }
    if (ids.has(id)) throw new Error(`Rule id "${id}" is duplicated.`);
    ids.add(id);
    if (typeof from !== 'string' || !VALID_LAYERS.has(from)
        || typeof to !== 'string' || !VALID_LAYERS.has(to)) {
      throw new Error(`Rule "${id}" must use valid from/to layers.`);
    }
    if (!['critical', 'warning'].includes(severity)) {
      throw new Error(`Rule "${id}" must use "critical" or "warning" severity.`);
    }
    if (typeof message !== 'string' || !message.trim()) {
      throw new Error(`Rule "${id}" must have a message.`);
    }
    return { id, from: normalizeLayer(from), to: normalizeLayer(to), severity, message };
  });
}

async function loadRules(repositoryPath, files) {
  const configPath = ['driftwatch.yml', 'driftwatch.json'].find((name) => files.includes(name));
  if (!configPath) return { rules: DEFAULT_RULES, error: null };
  try {
    const absolutePath = path.join(repositoryPath, configPath);
    const info = await fs.stat(absolutePath);
    if (info.size > MAX_SOURCE_SIZE) throw new Error('Rule configuration exceeds the 128 KiB scan limit.');
    const source = await fs.readFile(absolutePath, 'utf8');
    const config = configPath.endsWith('.json') ? JSON.parse(source) : parseYamlRuleConfig(source);
    const customRules = validateCustomRules(config);
    const rulesById = new Map(DEFAULT_RULES.map((rule) => [rule.id, rule]));
    for (const rule of customRules) rulesById.set(rule.id, rule);
    return { rules: [...rulesById.values()], error: null };
  } catch (error) {
    return {
      rules: DEFAULT_RULES,
      error: `Could not load ${configPath}: ${error.message} Using the default rules.`
    };
  }
}

function evaluateRules(dependencies, rules) {
  const violations = [];
  const violatingDependencies = new Set();
  for (const dependency of dependencies) {
    for (const rule of rules) {
      const targetLayers = Array.isArray(rule.to) ? rule.to : [rule.to];
      if (dependency.fromLayer !== rule.from || !targetLayers.includes(dependency.toLayer)) continue;
      violations.push({
        ruleId: rule.id,
        severity: rule.severity,
        message: rule.message,
        fromFile: dependency.fromFile,
        toFile: dependency.toFile,
        fromLayer: dependency.fromLayer,
        toLayer: dependency.toLayer
      });
      violatingDependencies.add(dependency);
    }
  }
  const critical = violations.filter((violation) => violation.severity === 'critical').length;
  const warnings = violations.filter((violation) => violation.severity === 'warning').length;
  return {
    violations,
    healthScore: Math.max(0, 100 - critical * 10 - warnings * 3),
    summary: {
      healthy: dependencies.length - violatingDependencies.size,
      warnings,
      critical
    }
  };
}

async function readRecentCommits(repositoryPath, signal) {
  throwIfAborted(signal);
  try {
    const { stdout } = await runFile('git', [
      '-C', repositoryPath, 'log', '--max-count=12',
      '--format=%H%x1f%h%x1f%aI%x1f%s'
    ], {
      timeout: 10000,
      maxBuffer: 256 * 1024,
      windowsHide: true,
      signal
    });
    throwIfAborted(signal);
    return stdout.split(/\r?\n/).filter(Boolean).map((line) => {
      const [sha, shortSha, date, ...messageParts] = line.split('\x1f');
      return { sha, shortSha, date, message: messageParts.join('\x1f') };
    }).filter((commit) => commit.sha && commit.shortSha && commit.date);
  } catch (cause) {
    throwIfAborted(signal);
    const error = new Error('Could not read the repository commit history.', { cause });
    error.code = 'GIT_HISTORY_UNAVAILABLE';
    throw error;
  }
}

async function analyzeRepository(repositoryPath, onProgress = () => {}, signal, maxFiles = MAX_FILES) {
  const { files, folders } = await walkRepository(repositoryPath, onProgress, signal, maxFiles);
  onProgress(files.length, true);
  const { rules, error: ruleConfigError } = await loadRules(repositoryPath, files);

  const languages = new Map();
  const manifests = [];
  const fileSet = new Set(files);
  const packageNames = new Map();
  let goModulePath = '';
  for (const filePath of files) {
    const language = languageForFile(filePath);
    if (language) languages.set(language, (languages.get(language) || 0) + 1);
  }

  let sourceBytes = 0;
  const sourceImports = new Map();
  for (const filePath of files) {
    throwIfAborted(signal);
    const basename = path.posix.basename(filePath);
    if (!MANIFEST_NAMES.has(basename)) continue;
    let source = '';
    const absolutePath = path.join(repositoryPath, ...filePath.split('/'));
    const fileInfo = await fs.stat(absolutePath);
    if (fileInfo.size <= MAX_SOURCE_SIZE && fileInfo.size + sourceBytes <= MAX_TOTAL_SOURCE_SIZE) {
      source = await fs.readFile(absolutePath, 'utf8');
      sourceBytes += fileInfo.size;
    }
    const dependencyCount = source ? manifestDependencies(filePath, source) : null;
    manifests.push({ name: basename, path: filePath, dependencyCount });
    if (basename === 'go.mod' && source) {
      goModulePath = (source.match(/^\s*module\s+(\S+)/m) || [])[1] || '';
    }
    const manifestLanguage = inferManifestLanguage(basename, [...languages].map(([name, count]) => ({ name, count })));
    if (manifestLanguage && !languages.has(manifestLanguage)
        && !(manifestLanguage === 'JavaScript' && languages.has('TypeScript'))) {
      languages.set(manifestLanguage, 1);
    }
    if (basename === 'package.json' && source) {
      try {
        const manifest = JSON.parse(source);
        if (manifest.name) packageNames.set(moduleForPath(filePath, new Set(folders.map((folder) => folder.split('/')[0]))), manifest.name);
      } catch {
        continue;
      }
    }
  }

  for (const filePath of files) {
    throwIfAborted(signal);
    if (!SOURCE_EXTENSIONS.has(sourceExtension(filePath))) continue;
    const absolutePath = path.join(repositoryPath, ...filePath.split('/'));
    const fileInfo = await fs.stat(absolutePath);
    if (fileInfo.size > MAX_SOURCE_SIZE || fileInfo.size + sourceBytes > MAX_TOTAL_SOURCE_SIZE) continue;
    const source = await fs.readFile(absolutePath, 'utf8');
    sourceBytes += fileInfo.size;
    const imports = importsFromSource(filePath, source, goModulePath);
    if (imports.length) sourceImports.set(filePath, imports);
  }

  const { modules, topLevelFolders, ids } = buildModules(files, folders);
  const dependencies = buildDependencies(sourceImports, ids, topLevelFolders, fileSet);
  const edges = buildEdges(sourceImports, ids, topLevelFolders, fileSet);
  const ruleResults = evaluateRules(dependencies, rules);
  for (const module of modules) {
    if (packageNames.has(module.id)) module.name = packageNames.get(module.id);
  }

  return {
    fileCount: files.length,
    folderCount: folders.length,
    files: files.slice(0, 500),
    truncatedFileList: files.length > 500,
    folders: folders.slice(0, 150),
    languages: [...languages.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name)),
    manifests,
    modules,
    edges,
    dependencies,
    ...ruleResults,
    ruleConfigError
  };
}

module.exports = {
  MAX_FILES,
  analyzeRepository,
  buildEdges,
  buildModules,
  classifyLayer,
  evaluateRules,
  inferLayer,
  loadRules,
  manifestDependencies,
  readRecentCommits,
  walkRepository
};
