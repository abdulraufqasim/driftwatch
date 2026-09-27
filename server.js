require('dotenv').config();

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const session = require('express-session');
const Database = require('better-sqlite3');

const PORT = Number(process.env.PORT || 3000);
const APP_BASE_URL = process.env.APP_BASE_URL || `http://localhost:${PORT}`;
const SESSION_SECRET = process.env.SESSION_SECRET;
const TOKEN_ENCRYPTION_KEY = process.env.TOKEN_ENCRYPTION_KEY;
const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID;
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
const SESSION_DB_PATH = path.resolve(process.env.SESSION_DB_PATH || 'data/driftwatch.sqlite');
const PUBLIC_DIR = __dirname;
const SESSION_MAX_AGE = 30 * 24 * 60 * 60 * 1000;
const PUBLIC_ASSETS = new Set([
  'app.js',
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
app.disable('x-powered-by');
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
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

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Driftwatch server listening at ${APP_BASE_URL}`);
});
