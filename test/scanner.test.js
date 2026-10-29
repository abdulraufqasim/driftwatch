const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { analyzeRepository } = require('../scanner');

async function createFixture(t, files) {
  const repositoryPath = await fs.mkdtemp(path.join(os.tmpdir(), 'driftwatch-rules-test-'));
  t.after(() => fs.rm(repositoryPath, { recursive: true, force: true }));
  await Promise.all(Object.entries(files).map(async ([relativePath, content]) => {
    const absolutePath = path.join(repositoryPath, ...relativePath.split('/'));
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, content);
  }));
  return repositoryPath;
}

test('analyzes source languages, manifests, module layers, and local imports', async (t) => {
  const repositoryPath = await fs.mkdtemp(path.join(os.tmpdir(), 'driftwatch-analyzer-test-'));
  t.after(() => fs.rm(repositoryPath, { recursive: true, force: true }));
  const files = {
    'frontend/app.ts': "import { serve } from '../backend/server';\n",
    'backend/server.ts': "import { query } from '../database/query';\nexport { query };\n",
    'database/query.ts': 'export function query() { return []; }\n',
    'backend/package.json': JSON.stringify({ name: '@test/api', dependencies: { express: '^5.0.0' } }),
    'root.py': 'import json\n'
  };
  await Promise.all(Object.entries(files).map(async ([relativePath, content]) => {
    const absolutePath = path.join(repositoryPath, ...relativePath.split('/'));
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, content);
  }));
  await fs.mkdir(path.join(repositoryPath, 'node_modules', 'ignored'), { recursive: true });
  await fs.writeFile(path.join(repositoryPath, 'node_modules', 'ignored', 'index.js'), 'module.exports = 1;');
  execFileSync('git', ['init', '--quiet'], { cwd: repositoryPath });
  execFileSync('git', ['config', 'user.name', 'Driftwatch Test'], { cwd: repositoryPath });
  execFileSync('git', ['config', 'user.email', 'driftwatch-test@example.invalid'], { cwd: repositoryPath });
  execFileSync('git', ['add', '.'], { cwd: repositoryPath });
  execFileSync('git', ['commit', '--quiet', '-m', 'Add analyzer fixture'], { cwd: repositoryPath });

  const result = await analyzeRepository(repositoryPath);
  assert.equal(result.fileCount, Object.keys(files).length);
  assert.equal(result.folderCount, 3);
  assert.deepEqual(new Set(result.languages.map((language) => language.name)), new Set(['TypeScript', 'Python', 'JSON']));
  assert.ok(result.manifests.some((manifest) => manifest.name === 'package.json' && manifest.dependencyCount === 1));
  assert.deepEqual(
    result.modules.map((module) => [module.id, module.layer]),
    [['.', 'service'], ['backend', 'backend'], ['database', 'database'], ['frontend', 'frontend']]
  );
  assert.deepEqual(result.edges, [
    { from: 'backend', to: 'database', count: 1 },
    { from: 'frontend', to: 'backend', count: 1 }
  ]);
});

test('reports a critical frontend-to-database violation and reduces health score', async (t) => {
  const repositoryPath = await createFixture(t, {
    'frontend/app.js': "import { query } from '../database/query.js';\n",
    'database/query.js': 'export function query() { return []; }\n'
  });

  const result = await analyzeRepository(repositoryPath);
  assert.deepEqual(result.violations, [{
    ruleId: 'RULE-001',
    severity: 'critical',
    message: 'Frontend must not import database files.',
    fromFile: 'frontend/app.js',
    toFile: 'database/query.js',
    fromLayer: 'frontend',
    toLayer: 'database'
  }]);
  assert.equal(result.healthScore, 90);
  assert.deepEqual(result.summary, { healthy: 0, warnings: 0, critical: 1 });
});

test('does not flag backend imports of database files', async (t) => {
  const repositoryPath = await createFixture(t, {
    'backend/controller.js': "import { query } from '../database/query.js';\n",
    'database/query.js': 'export function query() { return []; }\n'
  });

  const result = await analyzeRepository(repositoryPath);
  assert.deepEqual(result.violations, []);
  assert.equal(result.healthScore, 100);
  assert.deepEqual(result.summary, { healthy: 1, warnings: 0, critical: 0 });
});

test('clean repositories score 100', async (t) => {
  const repositoryPath = await createFixture(t, {
    'frontend/app.js': 'export function render() {}\n'
  });

  const result = await analyzeRepository(repositoryPath);
  assert.equal(result.healthScore, 100);
  assert.deepEqual(result.summary, { healthy: 0, warnings: 0, critical: 0 });
});

test('malformed custom rule configuration reports an error without failing analysis', async (t) => {
  const repositoryPath = await createFixture(t, {
    'frontend/app.js': 'export function render() {}\n',
    'driftwatch.yml': 'rules:\n  - id RULE-010\n    from: frontend\n'
  });

  const result = await analyzeRepository(repositoryPath);
  assert.equal(result.healthScore, 100);
  assert.match(result.ruleConfigError, /Could not load driftwatch\.yml/);
});

test('custom YAML rules replace defaults with the same ID and add violations', async (t) => {
  const repositoryPath = await createFixture(t, {
    'services/report.js': "import { render } from '../frontend/view.js';\n",
    'frontend/view.js': 'export function render() {}\n',
    'driftwatch.yml': [
      'rules:',
      '  - id: RULE-004',
      '    from: service',
      '    to: frontend',
      '    severity: warning',
      '    message: "Services should not render UI directly"'
    ].join('\n')
  });

  const result = await analyzeRepository(repositoryPath);
  assert.deepEqual(result.violations, [{
    ruleId: 'RULE-004',
    severity: 'warning',
    message: 'Services should not render UI directly',
    fromFile: 'services/report.js',
    toFile: 'frontend/view.js',
    fromLayer: 'service',
    toLayer: 'frontend'
  }]);
  assert.equal(result.healthScore, 97);
  assert.equal(result.ruleConfigError, null);
});

test('rejects repository trees beyond the configured file count limit', async (t) => {
  const repositoryPath = await fs.mkdtemp(path.join(os.tmpdir(), 'driftwatch-file-limit-test-'));
  t.after(() => fs.rm(repositoryPath, { recursive: true, force: true }));
  await fs.writeFile(path.join(repositoryPath, 'first.txt'), 'one');
  await fs.writeFile(path.join(repositoryPath, 'second.txt'), 'two');
  await fs.writeFile(path.join(repositoryPath, 'third.txt'), 'three');
  await assert.rejects(analyzeRepository(repositoryPath, () => {}, undefined, 2), {
    code: 'REPOSITORY_TOO_LARGE'
  });
});
