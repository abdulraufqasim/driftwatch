require('dotenv').config();

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const express = require('express');
const session = require('express-session');
const Database = require('better-sqlite3');
const { analyzeRepository, readRecentCommits } = require('./scanner');
const { callAiProvider, isProviderConfigured } = require('./ai-provider');
const { createChatHandler } = require('./chat-service');
const {
  PublicScanError,
  scanDemoRepository,
  scanHistory,
  scanPublicRepository
} = require('./public-scanner');

const runFile = promisify(execFile);
const PORT = Number(process.env.PORT || 3000);
const APP_BASE_URL = process.env.APP_BASE_URL || `http://localhost:${PORT}`;
const configuredOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const ALLOWED_ORIGINS = new Set(configuredOrigins.length ? configuredOrigins : ['http://localhost:3000']);
const SESSION_SECRET = process.env.SESSION_SECRET;
const TOKEN_ENCRYPTION_KEY = process.env.TOKEN_ENCRYPTION_KEY;
const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID;
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
const SESSION_DB_PATH = path.resolve(process.env.SESSION_DB_PATH || 'data/driftwatch.sqlite');
const PUBLIC_DIR = __dirname;
const SESSION_MAX_AGE = 30 * 24 * 60 * 60 * 1000;
const MAX_REPOSITORY_SIZE_KB = 204800;
const MAX_ACTIVE_SCANS = 2;
const MAX_ACTIVE_PUBLIC_SCANS = 2;
const SCAN_JOB_MAX_AGE = 30 * 60 * 1000;
const configuredAiDailyLimit = (process.env.AI_DAILY_LIMIT || '').trim();
const AI_DAILY_LIMIT = configuredAiDailyLimit ? Number(configuredAiDailyLimit) : 500;
const scanJobs = new Map();
let activeScanCount = 0;
let activePublicScanCount = 0;
const PUBLIC_ASSETS = new Set([
  'app.js',
  'assets/dr-drift.png',
  'assets/dr-drift-avatar-64.png',
  'assets/dr-drift-avatar-128.png',
  'csv.js',
  'config.js',
  'drift-icon.png',
  'drift-icon@2x.png',
  'drift-logo-dark.png',
  'drift-logo-dark@2x.png',
  'drift-logo.png',
  'favicon.ico',
  'favicon.png',
  'overrides.css',
  'styles.css'
]);

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error('PORT must be a valid TCP port.');
}
if (!Number.isSafeInteger(AI_DAILY_LIMIT) || AI_DAILY_LIMIT < 1) {
  throw new Error('AI_DAILY_LIMIT must be a positive whole number.');
}
if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
  throw new Error('Set SESSION_SECRET to a random value of at least 32 characters.');
}
if (!TOKEN_ENCRYPTION_KEY || !/^[\da-f]{64}$/i.test(TOKEN_ENCRYPTION_KEY)) {
  throw new Error('Set TOKEN_ENCRYPTION_KEY to exactly 64 hexadecimal characters.');
}

const appBase = new URL(APP_BASE_URL);
if (!['http:', 'https:'].includes(appBase.protocol) || appBase.pathname !== '/' || appBase.search || appBase.hash) {
  throw new Error('APP_BASE_URL must be the public origin only, such as https://driftwatch.example.com.');
}
if (process.env.NODE_ENV === 'production' && appBase.protocol !== 'https:') {
  throw new Error('APP_BASE_URL must use HTTPS in production.');
}
const OAUTH_CALLBACK_URL = new URL('/auth/github/callback', appBase).toString();
const tokenEncryptionKey = Buffer.from(TOKEN_ENCRYPTION_KEY, 'hex');

fs.mkdirSync(path.dirname(SESSION_DB_PATH), { recursive: true });
const database = new Database(SESSION_DB_PATH);
database.pragma('journal_mode = WAL');
database.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY,
    sess TEXT NOT NULL,
    expires INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions (expires);
`);

class SQLiteSessionStore extends session.Store {
  constructor(db) {
    super();
    this.db = db;
    this.getStatement = db.prepare('SELECT sess, expires FROM sessions WHERE sid = ?');
    this.setStatement = db.prepare(`
      INSERT INTO sessions (sid, sess, expires) VALUES (?, ?, ?)
      ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expires = excluded.expires
    `);
    this.deleteStatement = db.prepare('DELETE FROM sessions WHERE sid = ?');
    this.cleanupStatement = db.prepare('DELETE FROM sessions WHERE expires <= ?');
  }

  expiration(sessionData) {
    const expiry = sessionData.cookie && sessionData.cookie.expires
      ? Date.parse(sessionData.cookie.expires)
      : Date.now() + SESSION_MAX_AGE;
    return Number.isFinite(expiry) ? expiry : Date.now() + SESSION_MAX_AGE;
  }

  get(sid, callback) {
    try {
      const row = this.getStatement.get(sid);
      if (!row || row.expires <= Date.now()) {
        if (row) this.deleteStatement.run(sid);
        callback(null, null);
        return;
      }
      callback(null, JSON.parse(row.sess));
    } catch (error) {
      callback(error);
    }
  }

  set(sid, sessionData, callback = () => {}) {
    try {
      this.setStatement.run(sid, JSON.stringify(sessionData), this.expiration(sessionData));
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  touch(sid, sessionData, callback = () => {}) {
    try {
      const result = this.db.prepare('UPDATE sessions SET expires = ? WHERE sid = ?')
        .run(this.expiration(sessionData), sid);
      if (result.changes === 0) {
        this.set(sid, sessionData, callback);
        return;
      }
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  destroy(sid, callback = () => {}) {
    try {
      this.deleteStatement.run(sid);
      callback(null);
    } catch (error) {
      callback(error);
    }
  }
}

const sessionStore = new SQLiteSessionStore(database);
const cleanupTimer = setInterval(() => {
  sessionStore.cleanupStatement.run(Date.now());
}, 60 * 60 * 1000);
cleanupTimer.unref();

class GitHubApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function encryptToken(token) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', tokenEncryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString('base64url')).join('.');
}

function decryptToken(encryptedToken) {
  const [ivPart, tagPart, ciphertextPart] = encryptedToken.split('.');
  if (!ivPart || !tagPart || !ciphertextPart) throw new Error('Stored GitHub token is malformed.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', tokenEncryptionKey, Buffer.from(ivPart, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextPart, 'base64url')),
    decipher.final()
  ]).toString('utf8');
}

function sameValue(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function safeErrorMessage(error) {
  if (error instanceof GitHubApiError) return error.message;
  if (error && error.name === 'TimeoutError') return 'GitHub did not respond in time. Please try again.';
  return 'Could not reach GitHub. Check your connection and try again.';
}

async function parseGitHubResponse(response) {
  if (response.status === 429 || (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0')) {
    const reset = Number(response.headers.get('x-ratelimit-reset'));
    const resetText = Number.isFinite(reset) && reset > 0
      ? ` Try again after ${new Date(reset * 1000).toLocaleTimeString()}.`
      : ' Please try again later.';
    throw new GitHubApiError(429, `GitHub API rate limit reached.${resetText}`);
  }
  if (!response.ok) {
    if (response.status === 401) throw new GitHubApiError(401, 'GitHub authorization expired. Reconnect your account.');
    if (response.status === 403) throw new GitHubApiError(403, 'GitHub denied this request. Check the app permissions.');
    if (response.status === 404) throw new GitHubApiError(404, 'Repository not found or it is not public.');
    throw new GitHubApiError(502, 'GitHub could not complete the request. Please try again.');
  }
  return response.json();
}

async function githubApi(url, token) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    signal: AbortSignal.timeout(12000)
  });
  return parseGitHubResponse(response);
}

function ensureOAuthConfigured() {
  if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET) {
    throw new GitHubApiError(503, 'GitHub sign-in is not configured yet. Add the OAuth App credentials to the server.');
  }
}

function clearGitHubConnection(req) {
  delete req.session.github;
  delete req.session.oauthState;
  delete req.session.githubError;
}

function apiError(res, error) {
  if (error instanceof GitHubApiError) {
    res.status(error.status).json({ error: error.message, code: error.status === 401 ? 'reconnect_required' : undefined });
    return;
  }
  console.error('GitHub connection request failed:', error.message);
  res.status(502).json({ error: safeErrorMessage(error) });
}

function saveSession(req) {
  return new Promise((resolve, reject) => {
    req.session.save((error) => error ? reject(error) : resolve());
  });
}

function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => error ? reject(error) : resolve());
  });
}

const app = express();
const handleChat = createChatHandler({
  provider: callAiProvider,
  isAvailable: isProviderConfigured,
  dailyLimit: AI_DAILY_LIMIT
});
app.disable('x-powered-by');
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
app.use((req, res, next) => {
  const origin = req.get('origin');
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    res.status(403).json({ error: 'This origin is not allowed.' });
    return;
  }
  if (origin) {
    res.vary('Origin');
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '600');
  }
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  if (req.path.startsWith('/api/') || req.path.startsWith('/auth/')) {
    res.setHeader('Cache-Control', 'no-store');
  }
  next();
});
app.use(session({
  name: 'driftwatch.sid',
  secret: SESSION_SECRET,
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: appBase.protocol === 'https:' || process.env.NODE_ENV === 'production',
    maxAge: SESSION_MAX_AGE
  }
}));
app.use('/api/chat', express.json({ limit: '110kb', strict: true }));
app.use(express.json({ limit: '16kb', strict: true }));
app.use((req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/auth/')
      || req.path === '/' || PUBLIC_ASSETS.has(req.path.slice(1))) {
    next();
    return;
  }
  res.sendStatus(404);
});
app.use(express.static(PUBLIC_DIR, { index: 'index.html', dotfiles: 'ignore' }));

app.get('/api/github/connect', async (req, res) => {
  try {
    ensureOAuthConfigured();
    const state = crypto.randomBytes(32).toString('base64url');
    req.session.oauthState = state;
    await saveSession(req);
    const authorizeUrl = new URL('https://github.com/login/oauth/authorize');
    authorizeUrl.searchParams.set('client_id', GITHUB_CLIENT_ID);
    authorizeUrl.searchParams.set('redirect_uri', OAUTH_CALLBACK_URL);
    authorizeUrl.searchParams.set('scope', 'read:user public_repo');
    authorizeUrl.searchParams.set('state', state);
    authorizeUrl.searchParams.set('allow_signup', 'true');
    res.json({ url: authorizeUrl.toString() });
  } catch (error) {
    apiError(res, error);
  }
});

app.get('/auth/github/callback', async (req, res) => {
  try {
    ensureOAuthConfigured();
    const state = req.query.state;
    const expectedState = req.session.oauthState;
    delete req.session.oauthState;
    if (!sameValue(state, expectedState)) {
      req.session.githubError = 'The GitHub sign-in request expired or could not be verified. Please try again.';
      await saveSession(req);
      res.redirect('/');
      return;
    }
    if (req.query.error) {
      req.session.githubError = req.query.error === 'access_denied'
        ? 'GitHub access was cancelled. You can connect whenever you are ready.'
        : 'GitHub could not authorize this connection. Please try again.';
      await saveSession(req);
      res.redirect('/');
      return;
    }
    if (typeof req.query.code !== 'string' || req.query.code.length > 2048) {
      req.session.githubError = 'GitHub did not return an authorization code. Please try again.';
      await saveSession(req);
      res.redirect('/');
      return;
    }

    const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        client_secret: GITHUB_CLIENT_SECRET,
        code: req.query.code,
        redirect_uri: OAUTH_CALLBACK_URL
      }),
      signal: AbortSignal.timeout(12000)
    });
    const tokenData = await tokenResponse.json();
    if (!tokenResponse.ok || tokenData.error || typeof tokenData.access_token !== 'string') {
      req.session.githubError = tokenData.error === 'incorrect_client_credentials'
        ? 'GitHub sign-in is misconfigured. Check the OAuth App credentials.'
        : 'GitHub could not complete authorization. Please reconnect and try again.';
      await saveSession(req);
      res.redirect('/');
      return;
    }

    const scopes = String(tokenData.scope || '').split(/[,\s]+/).filter(Boolean);
    if (!scopes.includes('read:user') || !scopes.includes('public_repo') || scopes.includes('repo')) {
      req.session.githubError = 'GitHub did not grant the requested profile and public-repository permissions.';
      await saveSession(req);
      res.redirect('/');
      return;
    }

    const user = await githubApi('https://api.github.com/user', tokenData.access_token);
    if (typeof user.login !== 'string' || !Number.isInteger(user.id)) {
      throw new GitHubApiError(502, 'GitHub returned an invalid account profile.');
    }
    await regenerateSession(req);
    req.session.github = {
      id: user.id,
      login: user.login,
      encryptedAccessToken: encryptToken(tokenData.access_token)
    };
    delete req.session.githubError;
    await saveSession(req);
    res.redirect('/');
  } catch (error) {
    console.error('GitHub OAuth callback failed:', error.message);
    req.session.githubError = safeErrorMessage(error);
    try {
      await saveSession(req);
      res.redirect('/');
    } catch (saveError) {
      console.error('Could not save GitHub OAuth error state:', saveError.message);
      res.status(500).send('Could not finish GitHub sign-in. Return to Driftwatch and try again.');
    }
  }
});

app.get('/api/github/status', (req, res) => {
  const error = req.session.githubError;
  delete req.session.githubError;
  res.json({
    connected: Boolean(req.session.github),
    login: req.session.github ? req.session.github.login : null,
    error: error || null
  });
});

app.get('/api/github/repos', async (req, res) => {
  if (!req.session.github) {
    res.status(401).json({ error: 'Connect your GitHub account to view repositories.', code: 'reconnect_required' });
    return;
  }
  try {
    const token = decryptToken(req.session.github.encryptedAccessToken);
    const repos = [];
    for (let page = 1; page <= 10; page += 1) {
      const url = new URL('https://api.github.com/user/repos');
      url.searchParams.set('visibility', 'public');
      url.searchParams.set('affiliation', 'owner,collaborator,organization');
      url.searchParams.set('sort', 'updated');
      url.searchParams.set('per_page', '100');
      url.searchParams.set('page', String(page));
      const pageRepos = await githubApi(url, token);
      if (!Array.isArray(pageRepos)) throw new GitHubApiError(502, 'GitHub returned an invalid repository list.');
      repos.push(...pageRepos.filter((repo) => !repo.private).map((repo) => ({
        id: repo.id,
        name: repo.name,
        full_name: repo.full_name,
        private: false,
        updated_at: repo.updated_at,
        html_url: repo.html_url
      })));
      if (pageRepos.length < 100) break;
    }
    res.json({ repositories: repos });
  } catch (error) {
    if (error instanceof GitHubApiError && error.status === 401) clearGitHubConnection(req);
    apiError(res, error);
  }
});

app.get('/api/github/public-repository', async (req, res) => {
  const owner = req.query.owner;
  const name = req.query.repo;
  if (typeof owner !== 'string' || typeof name !== 'string'
      || !/^[A-Za-z0-9-]{1,100}$/.test(owner)
      || !/^[A-Za-z0-9._-]{1,100}$/.test(name)) {
    res.status(400).json({ error: 'Enter a valid github.com/owner/repository URL.' });
    return;
  }
  try {
    const repo = await githubApi(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`);
    if (repo.private) {
      res.status(403).json({ error: 'Manual URLs are only supported for public repositories. Connect GitHub to browse accessible public repositories.' });
      return;
    }
    res.json({
      repository: {
        id: repo.id,
        name: repo.name,
        full_name: repo.full_name,
        private: false,
        updated_at: repo.updated_at,
        html_url: repo.html_url
      }
    });
  } catch (error) {
    apiError(res, error);
  }
});

app.post('/api/github/disconnect', async (req, res) => {
  const origin = req.get('origin');
  if (!origin || origin !== appBase.origin) {
    res.status(403).json({ error: 'This request could not be verified. Refresh the page and try again.' });
    return;
  }
  const encryptedAccessToken = req.session.github && req.session.github.encryptedAccessToken;
  let revoked = false;
  let revokeMessage = null;
  if (encryptedAccessToken && GITHUB_CLIENT_ID && GITHUB_CLIENT_SECRET) {
    try {
      const credentials = Buffer.from(`${GITHUB_CLIENT_ID}:${GITHUB_CLIENT_SECRET}`).toString('base64');
      const response = await fetch(`https://api.github.com/applications/${encodeURIComponent(GITHUB_CLIENT_ID)}/grant`, {
        method: 'DELETE',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Basic ${credentials}`,
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2022-11-28'
        },
        body: JSON.stringify({ access_token: decryptToken(encryptedAccessToken) }),
        signal: AbortSignal.timeout(12000)
      });
      revoked = response.ok || response.status === 404;
      if (!revoked) revokeMessage = response.status === 429
        ? 'The local connection was removed, but GitHub could not revoke the grant because of a rate limit. Revoke it in GitHub settings.'
        : 'The local connection was removed, but GitHub could not revoke the grant. Revoke it in GitHub settings.';
    } catch (error) {
      console.error('GitHub token revocation failed:', error.message);
      revokeMessage = 'The local connection was removed, but GitHub could not be reached to revoke the grant. Revoke it in GitHub settings.';
    }
  }
  clearGitHubConnection(req);
  req.session.save((error) => {
    if (error) {
      console.error('Could not save GitHub disconnection:', error.message);
      res.status(500).json({ error: 'Could not clear the server session. Please try again.' });
      return;
    }
    res.json({ disconnected: true, revoked, message: revokeMessage });
  });
});

class ScanError extends Error {
  constructor(status, message, code = 'scan_failed') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function requireSameOrigin(req, res) {
  if (req.get('origin') === appBase.origin) return true;
  res.status(403).json({ error: 'This request could not be verified. Refresh the page and try again.' });
  return false;
}

function parseGitHubRepositoryUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) {
    throw new ScanError(400, 'Enter a valid public GitHub repository URL.', 'invalid_repository_url');
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new ScanError(400, 'Enter a valid public GitHub repository URL.', 'invalid_repository_url');
  }
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com'
      || url.username || url.password || url.port) {
    throw new ScanError(400, 'Use an HTTPS repository URL from github.com.', 'invalid_repository_url');
  }
  let segments;
  try {
    segments = url.pathname.split('/').filter(Boolean).map((segment) => decodeURIComponent(segment));
  } catch {
    throw new ScanError(400, 'Enter a valid public GitHub repository URL.', 'invalid_repository_url');
  }
  if (segments.length < 2 || !/^[A-Za-z0-9-]{1,100}$/.test(segments[0])) {
    throw new ScanError(400, 'Use a repository URL in the form https://github.com/owner/repository.', 'invalid_repository_url');
  }
  const repositoryName = segments[1].replace(/\.git$/i, '');
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(repositoryName)) {
    throw new ScanError(400, 'Use a repository URL in the form https://github.com/owner/repository.', 'invalid_repository_url');
  }
  return { owner: segments[0], repo: repositoryName };
}

async function getScanTarget(body, req) {
  let owner;
  let repoName;
  let requestedId;
  let token;
  if (typeof body.url === 'string') {
    ({ owner, repo: repoName } = parseGitHubRepositoryUrl(body.url));
    if (req.session.github) token = decryptToken(req.session.github.encryptedAccessToken);
  } else if (body.repository && typeof body.repository === 'object') {
    const { id, full_name: fullName } = body.repository;
    if (!Number.isSafeInteger(id) || id < 1 || typeof fullName !== 'string' || fullName.length > 205) {
      throw new ScanError(400, 'Select a repository from your connected GitHub account.', 'invalid_repository');
    }
    const parts = fullName.split('/');
    if (parts.length !== 2 || !/^[A-Za-z0-9-]{1,100}$/.test(parts[0]) || !/^[A-Za-z0-9._-]{1,100}$/.test(parts[1])) {
      throw new ScanError(400, 'Select a valid repository from your connected GitHub account.', 'invalid_repository');
    }
    if (!req.session.github) {
      throw new ScanError(401, 'Reconnect your GitHub account before scanning this repository.', 'reconnect_required');
    }
    ({ owner, repo: repoName } = { owner: parts[0], repo: parts[1] });
    requestedId = id;
    token = decryptToken(req.session.github.encryptedAccessToken);
  } else {
    throw new ScanError(400, 'Enter a GitHub repository URL or select a connected repository.', 'repository_required');
  }

  let metadata;
  try {
    metadata = await githubApi(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repoName)}`, token);
  } catch (error) {
    if (error instanceof GitHubApiError && error.status === 404) {
      throw new ScanError(404, 'Repository not found or is private.', 'repository_not_found');
    }
    if (error instanceof GitHubApiError && error.status === 401) {
      clearGitHubConnection(req);
      throw new ScanError(401, 'GitHub authorization expired. Reconnect your account and try again.', 'reconnect_required');
    }
    throw error;
  }
  if (requestedId && metadata.id !== requestedId) {
    throw new ScanError(404, 'Repository not found or is private.', 'repository_not_found');
  }
  if (metadata.private) {
    throw new ScanError(403, 'Private repositories are not supported by the current public-repository connection.', 'private_repository');
  }
  if (!Number.isSafeInteger(metadata.id) || typeof metadata.full_name !== 'string'
      || !/^[A-Za-z0-9-]{1,100}\/[A-Za-z0-9._-]{1,100}$/.test(metadata.full_name)
      || typeof metadata.clone_url !== 'string' || typeof metadata.html_url !== 'string') {
    throw new ScanError(502, 'GitHub returned invalid repository metadata.', 'invalid_github_response');
  }
  if (Number.isFinite(metadata.size) && metadata.size > MAX_REPOSITORY_SIZE_KB) {
    throw new ScanError(413, `This repository exceeds the ${Math.round(MAX_REPOSITORY_SIZE_KB / 1024)} MB scan limit.`, 'repository_too_large');
  }

  return {
    id: metadata.id,
    full_name: metadata.full_name,
    html_url: metadata.html_url,
    clone_url: metadata.clone_url,
    default_branch: metadata.default_branch || 'unknown',
    updated_at: metadata.updated_at || null,
    token
  };
}

function publicScanJob(job) {
  return {
    id: job.id,
    status: job.status,
    progress: job.progress,
    stage: job.stage,
    repository: job.repository ? {
      id: job.repository.id,
      full_name: job.repository.full_name,
      html_url: job.repository.html_url,
      default_branch: job.repository.default_branch,
      updated_at: job.repository.updated_at
    } : null,
    result: job.result || null,
    error: job.error || null
  };
}

function gitCloneError(error) {
  if (error.code === 'ENOENT') {
    return new ScanError(503, 'Git is not installed on the scan server. Install Git and try again.', 'git_unavailable');
  }
  if (error.killed || error.code === 'ETIMEDOUT' || error.signal === 'SIGTERM') {
    return new ScanError(504, 'Cloning timed out. The repository may be too large or unavailable.', 'clone_timeout');
  }
  const stderr = String(error.stderr || '').toLowerCase();
  if (/repository not found|not found|could not read from remote repository|authentication failed/.test(stderr)) {
    return new ScanError(404, 'Repository not found or is private.', 'repository_not_found');
  }
  if (/could not resolve host|failed to connect|connection timed out|network is unreachable/.test(stderr)) {
    return new ScanError(502, 'The scan server could not connect to GitHub. Try again in a moment.', 'github_unreachable');
  }
  return new ScanError(502, 'Git could not clone this repository. Verify that it is public and try again.', 'clone_failed');
}

async function executeScan(job, request, input) {
  let workspace;
  let scanResult;
  try {
    job.status = 'running';
    job.progress = 4;
    job.stage = 'Checking repository visibility...';
    const repository = await getScanTarget(input, request);
    job.repository = repository;

    workspace = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'driftwatch-scan-'));
    const clonePath = path.join(workspace, 'repository');
    job.progress = 12;
    job.stage = `Cloning ${repository.full_name}...`;
    const gitEnvironment = {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      GCM_INTERACTIVE: 'Never',
      GIT_LFS_SKIP_SMUDGE: '1',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : os.devNull,
      HOME: workspace,
      USERPROFILE: workspace
    };
    try {
      await runFile('git', [
        'clone',
        '--depth', '1',
        '--single-branch',
        '--no-tags',
        '--no-recurse-submodules',
        '--',
        repository.clone_url,
        clonePath
      ], {
        timeout: 120000,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
        env: gitEnvironment,
        signal: job.controller.signal
      });
    } catch (error) {
      if (job.controller.signal.aborted || error.name === 'AbortError') {
        throw new ScanError(499, 'Repository scan cancelled.', 'scan_cancelled');
      }
      console.error('Git clone failed:', error.code || error.signal, String(error.stderr || error.message).slice(0, 2000));
      throw gitCloneError(error);
    }

    job.progress = 35;
    job.stage = 'Analyzing repository files...';
    const analysis = await analyzeRepository(clonePath, (fileCount, complete) => {
      if (complete) {
        job.progress = 76;
        job.stage = `Analyzing ${fileCount.toLocaleString()} files...`;
      } else {
        job.progress = Math.min(70, 35 + Math.floor(fileCount / 100) * 2);
        job.stage = `Analyzing ${fileCount.toLocaleString()} files...`;
      }
    }, job.controller.signal);
    if (job.controller.signal.aborted) {
      throw new ScanError(499, 'Repository scan cancelled.', 'scan_cancelled');
    }
    if (analysis.fileCount === 0) {
      throw new ScanError(422, 'This repository contains no files to analyze.', 'empty_repository');
    }

    job.progress = 84;
    job.stage = 'Building architecture map...';
    await new Promise((resolve) => setTimeout(resolve, 400));
    job.progress = 92;
    job.stage = 'Reading recent Git history...';
    analysis.commits = await readRecentCommits(clonePath, job.controller.signal);
    if (job.controller.signal.aborted) {
      throw new ScanError(499, 'Repository scan cancelled.', 'scan_cancelled');
    }
    scanResult = {
      repository: {
        ...publicScanJob({ repository }).repository,
        source: input.source === 'github' ? 'github' : 'manual'
      },
      analysis
    };
  } catch (error) {
    if (error.code === 'SCAN_CANCELLED') {
      error = new ScanError(499, 'Repository scan cancelled.', 'scan_cancelled');
    }
    job.status = 'failed';
    job.error = error instanceof ScanError
      ? { code: error.code, message: error.message }
      : error instanceof GitHubApiError
        ? { code: 'github_api_error', message: error.message }
        : error.code === 'REPOSITORY_TOO_LARGE'
          ? { code: error.code.toLowerCase(), message: error.message }
          : error.code === 'GIT_HISTORY_UNAVAILABLE'
            ? { code: error.code.toLowerCase(), message: error.message }
            : { code: 'scan_failed', message: safeErrorMessage(error) };
    if (!(error instanceof ScanError || error instanceof GitHubApiError)) {
      console.error('Repository scan failed:', error.message);
    }
  } finally {
    if (workspace) {
      try {
        await fs.promises.rm(workspace, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      } catch (error) {
        console.error('Could not remove temporary repository checkout:', error.message);
        job.status = 'failed';
        job.error = {
          code: 'cleanup_failed',
          message: 'The temporary checkout could not be cleaned up. Contact the server operator.'
        };
      }
    }
    activeScanCount -= 1;
  }

  if (job.status !== 'failed') {
    try {
      request.session.latestScan = {
        repository: scanResult.repository,
        analysis: scanResult.analysis,
        scannedAt: new Date().toISOString()
      };
      await saveSession(request);
      job.result = request.session.latestScan;
      job.progress = 100;
      job.stage = 'Repository analysis complete.';
      job.status = 'complete';
    } catch (error) {
      console.error('Could not save repository scan result:', error.message);
      job.status = 'failed';
      job.error = { code: 'session_save_failed', message: 'The scan completed, but its result could not be saved. Please scan again.' };
    }
  }
  job.finishedAt = Date.now();
}

function purgeExpiredScanJobs() {
  const now = Date.now();
  for (const [id, job] of scanJobs) {
    if (job.finishedAt && now - job.finishedAt > SCAN_JOB_MAX_AGE) scanJobs.delete(id);
  }
}

app.post('/api/scans', async (req, res) => {
  if (!requireSameOrigin(req, res)) return;
  purgeExpiredScanJobs();
  const activeForSession = [...scanJobs.values()].some((job) =>
    job.ownerSessionId === req.sessionID && ['queued', 'running'].includes(job.status));
  if (activeForSession) {
    res.status(409).json({ error: 'A repository scan is already running in this session.', code: 'scan_in_progress' });
    return;
  }
  if (activeScanCount >= MAX_ACTIVE_SCANS) {
    res.status(429).json({ error: 'The scan server is busy. Please try again shortly.', code: 'scan_capacity' });
    return;
  }

  const id = crypto.randomUUID();
  const job = {
    id,
    ownerSessionId: req.sessionID,
    status: 'queued',
    progress: 0,
    stage: 'Waiting to start...',
    controller: new AbortController(),
    createdAt: Date.now(),
    finishedAt: null
  };
  scanJobs.set(id, job);
  activeScanCount += 1;
  req.session.scanStartedAt = Date.now();
  try {
    await saveSession(req);
  } catch (error) {
    activeScanCount -= 1;
    scanJobs.delete(id);
    console.error('Could not create scan session:', error.message);
    res.status(500).json({ error: 'Could not start a server-side scan session.', code: 'session_save_failed' });
    return;
  }
  void executeScan(job, req, req.body || {});
  res.status(202).json({ scanId: id, status: job.status, progress: job.progress, stage: job.stage });
});

app.post('/api/scan', async (req, res) => {
  if (activePublicScanCount >= MAX_ACTIVE_PUBLIC_SCANS) {
    res.status(429).json({ error: 'The scan server is busy. Please try again shortly.', code: 'scan_capacity' });
    return;
  }

  activePublicScanCount += 1;
  try {
    const result = req.body && req.body.demo === true
      ? await scanDemoRepository()
      : await scanPublicRepository(req.body || {});
    res.json(result);
  } catch (error) {
    if (error instanceof PublicScanError) {
      res.status(error.status).json({ error: error.message, code: error.code });
      return;
    }
    console.error('Public repository scan failed:', error.message);
    res.status(500).json({ error: 'The repository scan failed unexpectedly. Please try again.', code: 'scan_failed' });
  } finally {
    activePublicScanCount -= 1;
  }
});

app.post('/api/history', async (req, res) => {
  if (activePublicScanCount >= MAX_ACTIVE_PUBLIC_SCANS) {
    res.status(429).json({ error: 'The scan server is busy. Please try again shortly.', code: 'scan_capacity' });
    return;
  }

  activePublicScanCount += 1;
  try {
    res.json(await scanHistory(req.body || {}));
  } catch (error) {
    if (error instanceof PublicScanError) {
      res.status(error.status).json({ error: error.message, code: error.code });
      return;
    }
    console.error('Repository history scan failed:', error.message);
    res.status(500).json({ error: 'The repository history scan failed unexpectedly. Please try again.', code: 'history_scan_failed' });
  } finally {
    activePublicScanCount -= 1;
  }
});

app.post('/api/chat', async (req, res) => {
  const startedAt = Date.now();
  res.once('finish', () => {
    console.info(JSON.stringify({
      event: 'dr_drift_chat',
      status: res.statusCode,
      durationMs: Date.now() - startedAt,
      requestBytes: Buffer.byteLength(JSON.stringify(req.body || {}), 'utf8'),
      responseBytes: Number(res.getHeader('content-length') || 0)
    }));
  });

  const result = await handleChat({
    body: req.body,
    visitorKey: req.ip || req.socket.remoteAddress || 'unknown'
  });
  res.status(result.status).json(result.body);
});

app.get('/api/scans/latest', (req, res) => {
  res.json(req.session.latestScan || null);
});

app.delete('/api/scans/latest', (req, res) => {
  if (!requireSameOrigin(req, res)) return;
  delete req.session.latestScan;
  req.session.save((error) => {
    if (error) {
      console.error('Could not clear the saved repository scan:', error.message);
      res.status(500).json({ error: 'Could not clear the saved repository scan.' });
      return;
    }
    res.json({ cleared: true });
  });
});

app.get('/api/scans/:scanId', (req, res) => {
  const job = scanJobs.get(req.params.scanId);
  if (!job || job.ownerSessionId !== req.sessionID) {
    res.status(404).json({ error: 'This scan could not be found. Start a new scan.', code: 'scan_not_found' });
    return;
  }
  res.json(publicScanJob(job));
});

app.delete('/api/scans/:scanId', (req, res) => {
  if (!requireSameOrigin(req, res)) return;
  const job = scanJobs.get(req.params.scanId);
  if (!job || job.ownerSessionId !== req.sessionID) {
    res.status(404).json({ error: 'This scan could not be found.', code: 'scan_not_found' });
    return;
  }
  if (job.status === 'queued' || job.status === 'running') {
    job.controller.abort();
    job.stage = 'Cancelling scan and cleaning temporary files...';
  }
  res.json({ cancelled: true });
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

app.use((error, req, res, next) => {
  if (req.path !== '/api/scan' && req.path !== '/api/chat') {
    next(error);
    return;
  }
  const status = error.status === 413 ? 413 : 400;
  const message = req.path === '/api/chat'
    ? status === 413
      ? 'The chat request is too large.'
      : 'The chat request must contain valid JSON.'
    : status === 413
      ? 'The request body is too large.'
      : 'The scan request must contain valid JSON.';
  res.status(status).json({ error: message, code: status === 413 ? 'request_too_large' : 'invalid_json' });
});

app.listen(PORT, () => {
  console.log(`Driftwatch server listening at ${APP_BASE_URL}`);
});
