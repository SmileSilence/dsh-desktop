import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { resolveLaunch } = require('../main/dsh-server.js');

test('resolveLaunch: 配置路径优先（source=config-path）', () => {
  const r = resolveLaunch({ path: 'C:/repo', port: 3080, profile: '', proxy: '', env: {} }, {
    repoPaths: ['C:/repo'],
    hasGlobalCli: false,
    npmGlobalPath: null,
    hasSystemNode: true
  });
  assert.equal(r.source, 'config-path');
  assert.equal(r.cmd, 'pnpm');
  assert.deepEqual(r.args, ['dsh', 'web', '--no-open']);
  assert.equal(r.cwd, 'C:/repo');
});

test('resolveLaunch: 本地仓库探测', () => {
  const r = resolveLaunch({ path: '', port: 3080, profile: '', proxy: '', env: {} }, {
    repoPaths: ['D:/proj/deepseek-harness'],
    hasGlobalCli: false,
    npmGlobalPath: null,
    hasSystemNode: true
  });
  assert.equal(r.source, 'local-repo');
  assert.equal(r.cmd, 'pnpm');
  assert.equal(r.cwd, 'D:/proj/deepseek-harness');
});

test('resolveLaunch: 全局 CLI', () => {
  const r = resolveLaunch({ path: '', port: 3080, profile: '', proxy: '', env: {} }, {
    repoPaths: [],
    hasGlobalCli: true,
    npmGlobalPath: null,
    hasSystemNode: true
  });
  assert.equal(r.source, 'global-cli');
  assert.equal(r.cmd, 'dsh');
  assert.deepEqual(r.args, ['web', '--no-open']);
  assert.equal(r.cwd, null);
});

test('resolveLaunch: npm 全局包', () => {
  const r = resolveLaunch({ path: '', port: 3080, profile: '', proxy: '', env: {} }, {
    repoPaths: [],
    hasGlobalCli: false,
    npmGlobalPath: 'C:/npm/node_modules/@deepseek-ai/dsh',
    hasSystemNode: true
  });
  assert.equal(r.source, 'npm-global');
  assert.equal(r.cmd, 'npx');
  assert.deepEqual(r.args, ['@deepseek-ai/dsh', 'web', '--no-open']);
});

test('resolveLaunch: npx 兜底', () => {
  const r = resolveLaunch({ path: '', port: 3080, profile: '', proxy: '', env: {} }, {
    repoPaths: [],
    hasGlobalCli: false,
    npmGlobalPath: null,
    hasSystemNode: true
  });
  assert.equal(r.source, 'npx');
  assert.equal(r.cmd, 'npx');
});

test('resolveLaunch: 非默认端口/profile 追加参数', () => {
  const r = resolveLaunch({ path: '', port: 3090, profile: 'dev', proxy: '', env: {} }, {
    repoPaths: [],
    hasGlobalCli: true,
    npmGlobalPath: null,
    hasSystemNode: true
  });
  assert.deepEqual(r.args, ['--profile', 'dev', '--no-open', '--port', '3090']);
});

test('resolveLaunch: web profile 使用 3080 且不附加其他端口', () => {
  const r = resolveLaunch({ path: '', port: 3080, profile: 'web', proxy: '', env: {} }, {
    repoPaths: [], hasGlobalCli: true, npmGlobalPath: null, hasSystemNode: true
  });
  assert.deepEqual(r.args, ['--profile', 'web', '--no-open']);
});

test('resolveLaunch: 配置路径与候选重复时仍取 config-path', () => {
  const r = resolveLaunch({ path: 'C:/a', port: 3080, profile: '', proxy: '', env: {} }, {
    repoPaths: ['C:/a', 'D:/b'],
    hasGlobalCli: false,
    npmGlobalPath: null,
    hasSystemNode: true
  });
  assert.equal(r.source, 'config-path');
  assert.equal(r.cwd, 'C:/a');
});
