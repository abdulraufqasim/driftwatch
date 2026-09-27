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
  delete environment.GITHUB_CLIENT_ID;
  delete environment.GITHUB_CLIENT_SECRET;
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
