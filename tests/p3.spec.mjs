import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { checkForUpdate, THROTTLE_MS } = require('../main/updater.js');
const { createDshUpdate, sourceKind, localRepoVersion, compareSimple } = require('../main/dsh-update.js');
const { buildDiagnostics, maskDiagnosticConfig } = require('../main/diagnostics.js');
const { compareSemver } = require('../main/lib/semver.js');

// ============ updater（P3.2） ============
test('checkForUpdate: 有新版 → hasUpdate:true', async () => {
  const r = await checkForUpdate({
    getCurrentVersion: () => '1.0.0',
    getRepository: () => ({ owner: 'dsh-community', repo: 'dsh-desktop' }),
    getLastChecked: () => null,
    setLastChecked: () => {},
    compare: compareSemver,
    fetch: async () => ({ version: 'v1.1.0', url: 'https://github.com/x/y/releases/v1.1.0' }),
    logger: {}
  });
  assert.equal(r.hasUpdate, true);
  assert.equal(r.latest, 'v1.1.0');
  assert.equal(r.current, '1.0.0');
});

test('checkForUpdate: 已是最新 → hasUpdate:false', async () => {
  const r = await checkForUpdate({
    getCurrentVersion: () => '1.1.0',
    getRepository: () => ({ owner: 'dsh-community', repo: 'dsh-desktop' }),
    getLastChecked: () => null,
    setLastChecked: () => {},
    compare: compareSemver,
    fetch: async () => ({ version: 'v1.1.0', url: null }),
    logger: {}
  });
  assert.equal(r.hasUpdate, false);
});

test('checkForUpdate: 节流生效', async () => {
  let fetched = false;
  const r = await checkForUpdate({
    getCurrentVersion: () => '1.0.0',
    getRepository: () => ({ owner: 'x', repo: 'y' }),
    getLastChecked: () => Date.now(), // 刚检查过
    setLastChecked: () => {},
    compare: compareSemver,
    fetch: async () => { fetched = true; return { version: 'v9.9.9', url: null }; },
    logger: {}
  });
  assert.equal(r.throttled, true);
  assert.equal(fetched, false);
});

test('checkForUpdate: 无 compare 时兜底比较', async () => {
  const r = await checkForUpdate({
    getCurrentVersion: () => '1.0.0',
    getRepository: () => ({ owner: 'x', repo: 'y' }),
    getLastChecked: () => null,
    setLastChecked: () => {},
    fetch: async () => ({ version: 'v2.0.0', url: null }),
    logger: {}
  });
  assert.equal(r.hasUpdate, true);
});

// ============ dsh-update（P3.4 / G1） ============
test('sourceKind 映射', () => {
  assert.equal(sourceKind({ source: 'config-path' }), 'local-repo');
  assert.equal(sourceKind({ source: 'local-repo' }), 'local-repo');
  assert.equal(sourceKind({ source: 'global-cli' }), 'global-cli');
  assert.equal(sourceKind({ source: 'npm-global' }), 'npm-global');
  assert.equal(sourceKind({ source: 'npx' }), 'npx');
});

test('localRepoVersion 读取仓库版本', () => {
  const fsMod = {
    readFileSync: () => JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.1.1-rc.2' })
  };
  assert.equal(localRepoVersion('C:/repo', fsMod), '0.1.1-rc.2');
  assert.equal(localRepoVersion(null, fsMod), null);
  assert.equal(localRepoVersion('C:/nope', { readFileSync: () => { throw new Error('enoent'); } }), null);
});

test('createDshUpdate.checkUpdate: npx 来源 + npm 最新版', async () => {
  const updater = createDshUpdate({
    getLaunch: () => ({ source: 'npx', cmd: 'npx', args: [], cwd: null }),
    getDshConfig: () => ({ dsh: {} }),
    getNpmViewVersion: async () => '0.1.1-rc.2',
    execFileP: async () => '0.1.0-rc.8\n',
    now: () => 100000, // 首次调用时远离节流窗口
    throttleMs: 60 * 1000,
    logger: {}
  });
  const r = await updater.checkUpdate(false);
  assert.equal(r.kind, 'npx');
  assert.equal(r.currentVersion, '0.1.0-rc.8');
  assert.equal(r.latestVersion, '0.1.1-rc.2');
  assert.equal(r.hasUpdate, true);
});

test('createDshUpdate.update: 缺 confirm 抛错', async () => {
  const updater = createDshUpdate({
    getLaunch: () => ({ source: 'npx', cmd: 'npx', args: [], cwd: null }),
    getDshConfig: () => ({}),
    execFileP: async () => '',
    logger: {}
  });
  await assert.rejects(() => updater.update(false), (e) => e.code === 'CONFIRM_REQUIRED');
});

test('createDshUpdate.update: npx 来源无需更新', async () => {
  const updater = createDshUpdate({
    getLaunch: () => ({ source: 'npx', cmd: 'npx', args: [], cwd: null }),
    getDshConfig: () => ({}),
    execFileP: async () => '0.1.1-rc.2\n',
    logger: {}
  });
  const r = await updater.update(true);
  assert.equal(r.ok, true);
  assert.equal(r.restartRequired, false);
});

test('createDshUpdate.update: 本地仓库脏工作区中止', async () => {
  const updater = createDshUpdate({
    getLaunch: () => ({ source: 'local-repo', cmd: 'pnpm', args: [], cwd: 'C:/repo' }),
    getDshConfig: () => ({}),
    fs: { readFileSync: () => JSON.stringify({ version: '0.1.0' }) },
    execFileP: async (cmd, args) => {
      if (cmd === 'git' && args[0] === 'status') return ' M main.js\n'; // 脏
      return '';
    },
    logger: {}
  });
  await assert.rejects(() => updater.update(true), /未提交改动/);
});

test('compareSimple 比较', () => {
  assert.equal(compareSimple('0.1.0', '0.1.1'), -1);
  assert.equal(compareSimple('1.0.0', '0.9.9'), 1);
  assert.equal(compareSimple('0.1.1-rc.2', '0.1.1'), 0);
});

// ============ diagnostics（P3.3） ============
test('buildDiagnostics 含核心字段', () => {
  const text = buildDiagnostics({
    appVersion: '1.0.0', platform: 'win32', arch: 'x64',
    electronVersion: '35', chromeVersion: '130', nodeVersion: '22',
    logDir: 'C:/logs', logTail: () => 'tail-line',
    backend: { running: true, port: 3080 },
    config: { language: 'zh-CN', bridge: { token: 'secret' }, dsh: { env: { KEY: 'sk-xxx' } } }
  });
  assert.ok(text.includes('DSH Desktop 诊断导出'));
  assert.ok(text.includes('App 版本: 1.0.0'));
  assert.ok(text.includes('win32 / x64'));
  assert.ok(text.includes('backendRunning') || text.includes('running'));
  assert.ok(text.includes('tail-line'));
  assert.ok(!text.includes('secret'), 'bridge.token 不应出现在诊断');
  assert.ok(text.includes('***'), 'dsh.env 值应脱敏');
});

test('maskDiagnosticConfig 脱敏', () => {
  const masked = maskDiagnosticConfig({ bridge: { token: 'x' }, dsh: { env: { A: 'b' }, proxy: 'http://u:p@h' } });
  assert.ok(!masked.includes('"token"'));
  assert.ok(masked.includes('"***"'));
  assert.ok(masked.includes('u:***@h'));
});
