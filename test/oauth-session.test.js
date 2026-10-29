const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { mkdtempSync, rmSync } = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const crypto = require('node:crypto');

const projectRoot = path.resolve(__dirname, '..');

async function availablePort() {
  const listener = net.createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const { port } = listener.address();
  await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function startServer(environment) {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: projectRoot,
    env: environment,
    stdio: 'ignore'
  });
  const healthUrl = `${environment.APP_BASE_URL}/api/health`;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Test server exited with code ${child.exitCode}.`);
    try {
      const response = await fetch(healthUrl, { signal: AbortSignal.timeout(500) });
      if (response.ok) return child;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  child.kill();
  throw new Error('Test server did not start.');
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  child.kill();
  await once(child, 'exit');
}

test('GitHub OAuth session persists across restarts and rejects invalid requests', async (t) => {
  const port = await availablePort();
  const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), 'driftwatch-oauth-test-'));
  const environment = {
    ...process.env,
    PORT: String(port),
    APP_BASE_URL: `http://127.0.0.1:${port}`,
    SESSION_SECRET: crypto.randomBytes(48).toString('base64url'),
    TOKEN_ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex'),
    SESSION_DB_PATH: path.join(temporaryDirectory, 'sessions.sqlite'),
    GITHUB_CLIENT_ID: 'oauth-test-client',
    GITHUB_CLIENT_SECRET: 'oauth-test-secret',
    NODE_ENV: 'test'
  };
  let child;
  t.after(async () => {
    if (child) await stopServer(child);
    rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  child = await startServer(environment);
  const baseUrl = environment.APP_BASE_URL;
  const initialStatus = await fetch(`${baseUrl}/api/github/status`).then((response) => response.json());
  assert.equal(initialStatus.connected, false);

  const demoScanResponse = await fetch(`${baseUrl}/api/scan`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ demo: true })
  });
  assert.equal(demoScanResponse.status, 200);
  const demoScan = await demoScanResponse.json();
  assert.equal(demoScan.healthScore, 87);
  assert.deepEqual(demoScan.summary, { healthy: 4, warnings: 1, critical: 1 });
  assert.deepEqual(demoScan.violations.map(({ ruleId }) => ruleId), ['RULE-001', 'RULE-004']);

  const demoHistoryResponse = await fetch(`${baseUrl}/api/history`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ demo: true })
  });
  assert.equal(demoHistoryResponse.status, 200);
  const demoHistory = await demoHistoryResponse.json();
  assert.equal(demoHistory.repo, 'demo-repo');
  assert.equal(demoHistory.points.length, 10);
  assert.equal(demoHistory.points.at(-1).healthScore, 87);

  const invalidPublicScanResponse = await fetch(`${baseUrl}/api/scan`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: 'https://example.com/owner/repo' })
  });
  assert.equal(invalidPublicScanResponse.status, 400);

  const connectResponse = await fetch(`${baseUrl}/api/github/connect`);
  assert.equal(connectResponse.status, 200);
  const cookieHeader = connectResponse.headers.get('set-cookie');
  assert.ok(cookieHeader);
  assert.match(cookieHeader, /HttpOnly/i);
  assert.match(cookieHeader, /SameSite=Lax/i);
  const cookie = cookieHeader.split(';', 1)[0];
  const connect = await connectResponse.json();
  const authorizeUrl = new URL(connect.url);
  assert.equal(authorizeUrl.origin, 'https://github.com');
  assert.equal(authorizeUrl.pathname, '/login/oauth/authorize');
  assert.equal(authorizeUrl.searchParams.get('scope'), 'read:user public_repo');
  assert.equal(authorizeUrl.searchParams.get('redirect_uri'), `${baseUrl}/auth/github/callback`);

  await stopServer(child);
  child = await startServer(environment);
  const callbackUrl = new URL('/auth/github/callback', baseUrl);
  callbackUrl.searchParams.set('error', 'access_denied');
  callbackUrl.searchParams.set('state', authorizeUrl.searchParams.get('state'));
  const deniedResponse = await fetch(callbackUrl, {
    headers: { cookie },
    redirect: 'manual'
  });
  assert.equal(deniedResponse.status, 302);

  const deniedStatusResponse = await fetch(`${baseUrl}/api/github/status`, { headers: { cookie } });
  const deniedStatus = await deniedStatusResponse.json();
  assert.equal(deniedStatus.connected, false);
  assert.match(deniedStatus.error, /cancelled/i);

  const reposResponse = await fetch(`${baseUrl}/api/github/repos`, { headers: { cookie } });
  assert.equal(reposResponse.status, 401);
  const invalidRepositoryResponse = await fetch(`${baseUrl}/api/github/public-repository?owner=invalid%2Fowner&repo=repo`);
  assert.equal(invalidRepositoryResponse.status, 400);
  const csrfResponse = await fetch(`${baseUrl}/api/github/disconnect`, {
    method: 'POST',
    headers: { cookie, origin: 'https://invalid.example' }
  });
  assert.equal(csrfResponse.status, 403);
  const sourceResponse = await fetch(`${baseUrl}/server.js`);
  assert.equal(sourceResponse.status, 404);
});

test('GitHub sign-in reports when OAuth App credentials are missing', async (t) => {
  const port = await availablePort();
  const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), 'driftwatch-oauth-config-test-'));
  const environment = {
    ...process.env,
    PORT: String(port),
    APP_BASE_URL: `http://127.0.0.1:${port}`,
    SESSION_SECRET: crypto.randomBytes(48).toString('base64url'),
    TOKEN_ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex'),
    SESSION_DB_PATH: path.join(temporaryDirectory, 'sessions.sqlite'),
    NODE_ENV: 'test'
  };
  environment.GITHUB_CLIENT_ID = '';
  environment.GITHUB_CLIENT_SECRET = '';
  const child = await startServer(environment);
  t.after(async () => {
    await stopServer(child);
    rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  const response = await fetch(`${environment.APP_BASE_URL}/api/github/connect`);
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.match(body.error, /not configured/i);
});

test('CORS accepts configured origins, blocks other origins, and allows tokenless demo scans', async (t) => {
  const port = await availablePort();
  const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), 'driftwatch-cors-test-'));
  const allowedOrigin = 'https://driftwatch-frontend.example';
  const environment = {
    ...process.env,
    PORT: String(port),
    APP_BASE_URL: `http://127.0.0.1:${port}`,
    SESSION_SECRET: crypto.randomBytes(32).toString('hex'),
    TOKEN_ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex'),
    SESSION_DB_PATH: path.join(temporaryDirectory, 'nested', 'sessions.sqlite'),
    ALLOWED_ORIGINS: ` ${allowedOrigin}, https://preview.example `,
    GITHUB_TOKEN: '',
    NODE_ENV: 'test'
  };
  const child = await startServer(environment);
  t.after(async () => {
    await stopServer(child);
    rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  const baseUrl = environment.APP_BASE_URL;
  const preflight = await fetch(`${baseUrl}/api/scan`, {
    method: 'OPTIONS',
    headers: {
      Origin: allowedOrigin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type'
    }
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), allowedOrigin);
  assert.match(preflight.headers.get('access-control-allow-methods'), /POST/);

  const demoResponse = await fetch(`${baseUrl}/api/scan`, {
    method: 'POST',
    headers: { Origin: allowedOrigin, 'content-type': 'application/json' },
    body: JSON.stringify({ demo: true })
  });
  assert.equal(demoResponse.status, 200);
  assert.equal(demoResponse.headers.get('access-control-allow-origin'), allowedOrigin);
  assert.equal((await demoResponse.json()).healthScore, 87);

  const blockedResponse = await fetch(`${baseUrl}/api/health`, {
    headers: { Origin: 'https://unlisted.example' }
  });
  assert.equal(blockedResponse.status, 403);
  assert.equal(blockedResponse.headers.get('access-control-allow-origin'), null);
});
