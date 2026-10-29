const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  importsForFile,
  findFirstDriftCommit,
  layerForPath,
  parseRepositoryUrl,
  sampleEvenly,
  scanDemoRepository,
  scanHistory,
  scanPublicRepository
} = require('../public-scanner');

test('accepts canonical public GitHub repository URLs', () => {
  assert.deepEqual(
    parseRepositoryUrl('https://github.com/sindresorhus/escape-string-regexp.git/'),
    { owner: 'sindresorhus', repo: 'escape-string-regexp' }
  );
});

test('rejects non-GitHub and non-repository URLs', () => {
  for (const url of [
    'http://github.com/owner/repo',
    'https://github.com.evil.example/owner/repo',
    'https://github.com/owner/repo/tree/main',
    'https://user@github.com/owner/repo'
  ]) {
    assert.throws(() => parseRepositoryUrl(url), { code: 'invalid_repository_url', status: 400 });
  }
});

test('rejects invalid branch names before contacting GitHub', async () => {
  await assert.rejects(
    scanPublicRepository({ url: 'https://github.com/owner/repo', branch: 'main\ninvalid' }),
    { code: 'invalid_branch', status: 400 }
  );
});

test('parses static imports, require calls, and dynamic imports', () => {
  const specifiers = importsForFile('src/view.tsx', `
    import type { Model } from './model';
    const common = require('./common');
    const lazy = import('./lazy');
    export const View = () => <div />;
  `);

  assert.deepEqual(new Set(specifiers), new Set(['./model', './common', './lazy']));
  assert.deepEqual(importsForFile('src/widget.js', 'export default () => <div />;'), []);
});

test('classifies model and schema paths as database before backend folders', () => {
  for (const filePath of [
    'server/models/ClientModel.js',
    'src/server/model/user.model.ts',
    'server/routes/user.schema.js',
    'src/prisma/schema.ts',
    'server/migrations/001.js'
  ]) {
    assert.equal(layerForPath(filePath), 'database', filePath);
  }
});

test('classifies nested service utility folders as services before backend folders', () => {
  for (const filePath of [
    'server/services/email.js',
    'src/server/service/worker.ts',
    'server/lib/logger.js',
    'server/controllers/utils/format.js',
    'src/api/helpers/response.ts'
  ]) {
    assert.equal(layerForPath(filePath), 'services', filePath);
  }
});

test('uses the shared layer priorities for nested files', () => {
  const expectedLayers = new Map([
    ['backend/models/user.model.ts', 'database'],
    ['src/server/utils/helper.js', 'services'],
    ['src/components/button.tsx', 'frontend'],
    ['src/controllers/routes/user.ts', 'backend']
  ]);
  for (const [filePath, expectedLayer] of expectedLayers) {
    assert.equal(layerForPath(filePath), expectedLayer, filePath);
  }
});

test('scans the local demo with the shared Phase 2 rules', async () => {
  const result = await scanDemoRepository();
  assert.equal(result.repo, 'demo-repo');
  assert.equal(result.fileCount, 8);
  assert.equal(result.healthScore, 87);
  assert.deepEqual(result.summary, { healthy: 4, warnings: 1, critical: 1 });
  assert.deepEqual(
    result.violations.map(({ ruleId, severity }) => ({ ruleId, severity })),
    [
      { ruleId: 'RULE-001', severity: 'critical' },
      { ruleId: 'RULE-004', severity: 'warning' }
    ]
  );
});

test('samples commit lists evenly and always includes the newest commit', () => {
  const commits = Array.from({ length: 10 }, (_, index) => ({ sha: `commit-${index}` }));
  assert.deepEqual(sampleEvenly(commits, 4), [
    { sha: 'commit-0' },
    { sha: 'commit-3' },
    { sha: 'commit-6' },
    { sha: 'commit-9' }
  ]);
  assert.deepEqual(sampleEvenly(commits, 1), [{ sha: 'commit-0' }]);
});

test('finds the first score drop compared with the previous timeline point', () => {
  const points = [
    { sha: 'a', message: 'baseline', healthScore: 100 },
    { sha: 'b', message: 'no change', healthScore: 100 },
    { sha: 'c', message: 'first regression', healthScore: 97 },
    { sha: 'd', message: 'later regression', healthScore: 87 }
  ];
  assert.deepEqual(findFirstDriftCommit(points), {
    sha: 'c',
    message: 'first regression',
    scoreDrop: 3
  });
  assert.equal(findFirstDriftCommit(points.slice(0, 2)), null);
});

test('returns the bundled offline demo history', async () => {
  const history = await scanHistory({ demo: true });
  assert.equal(history.repo, 'demo-repo');
  assert.equal(history.points.length, 10);
  assert.equal(history.points[0].healthScore, 100);
  assert.equal(history.points.at(-1).healthScore, 87);
  assert.deepEqual(history.firstDriftCommit, {
    sha: 'e751461bec42908fd56a0c1745bd92e6f80ac453',
    message: 'Connect the frontend to user data',
    scoreDrop: 3
  });
});
