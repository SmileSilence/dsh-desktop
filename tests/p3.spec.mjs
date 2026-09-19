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

test('checkForUpdate: 手动强制检查绕过节流', async () => {
  let fetched = false;
  const r = await checkForUpdate({
    getCurrentVersion: () => '1.0.0',
    getRepository: () => ({ owner: 'x', repo: 'y' }),
    getLastChecked: () => Date.now(),
    setLastChecked: () => {},
    compare: compareSemver,
    force: true,
    fetch: async () => { fetched = true; return { version: 'v1.1.0', url: 'https://github.com/x/y/releases/tag/v1.1.0' }; }
  });
  assert.equal(fetched, true);
  assert.equal(r.hasUpdate, true);
});

test('checkForUpdate: GitHub 失败不写成功检查时间', async () => {
  let saved = false;
  const r = await checkForUpdate({
    getCurrentVersion: () => '1.0.0',
    getRepository: () => ({ owner: 'x', repo: 'y' }),
    getLastChecked: () => null,
    setLastChecked: () => { saved = true; },
    compare: compareSemver,
    fetch: async () => ({ version: null, url: null, error: 'HTTP 403', errorCode: 'RATE_LIMITED' })
  });
  assert.equal(saved, false);
  assert.equal(r.errorCode, 'RATE_LIMITED');
  assert.equal(r.hasUpdate, false);
});

test('checkForUpdate: 无正式 Release 与非法版本分别报告原因', async () => {
  const base = {
    getCurrentVersion: () => '1.0.0', getRepository: () => ({ owner: 'x', repo: 'y' }),
    getLastChecked: () => null, setLastChecked: () => {}, compare: compareSemver
  };
  const none = await checkForUpdate({ ...base, fetch: async () => ({ version: null, url: null, error: 'HTTP 404', errorCode: 'NO_RELEASE' }) });
  assert.equal(none.errorCode, 'NO_RELEASE');
  const invalid = await checkForUpdate({ ...base, fetch: async () => ({ version: 'latest', url: 'https://github.com/x/y/releases/latest' }) });
  assert.equal(invalid.errorCode, 'INVALID_VERSION');
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
    execFileP: async (cmd, args) => (cmd === 'npm' && args[0] === 'view') ? '0.1.1-rc.2\n' : '0.1.0-rc.8\n',
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

test('createDshUpdate.checkUpdate: local-repo 按 Git 上游落后提交判断', async () => {
  const updater = createDshUpdate({
    getLaunch: () => ({ source: 'local-repo', cmd: 'pnpm', args: [], cwd: 'C:/repo' }),
    getDshConfig: () => ({}),
    fs: { readFileSync: () => JSON.stringify({ version: '0.1.0' }) },
    execFileP: async (cmd, args) => {
      if (cmd === 'git' && args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return 'origin/main\n';
      if (cmd === 'git' && args[0] === 'fetch') return '';
      if (cmd === 'git' && args[0] === 'rev-parse' && args[1] === 'HEAD') return 'abc123\n';
      if (cmd === 'git' && args[0] === 'rev-list') return '3\n';
      return '';
    },
    now: () => 100000,
    throttleMs: 60 * 1000,
    logger: {}
  });
  const r = await updater.checkUpdate(false);
  assert.equal(r.kind, 'local-repo');
  assert.equal(r.behind, 3);
  assert.equal(r.hasUpdate, true);
});

test('createDshUpdate.checkUpdate: local-repo 按最新发布 tag 判断', async () => {
  const updater = createDshUpdate({
    getLaunch: () => ({ source: 'local-repo', cmd: 'pnpm', args: [], cwd: 'C:/repo' }),
    getDshConfig: () => ({}),
    fs: { readFileSync: () => JSON.stringify({ version: '0.1.5-rc.2' }) },
    execFileP: async (cmd, args) => {
      if (cmd === 'git' && args[0] === 'remote') return 'origin\n';
      if (cmd === 'git' && args[0] === 'fetch') return '';
      if (cmd === 'git' && args[0] === 'tag') return 'dsh-v0.1.5-rc.1\ndsh-v0.1.5-rc.2\ndsh-v0.1.6-alpha.1\n';
      return '';
    },
    now: () => 100000,
    throttleMs: 60 * 1000,
    logger: {}
  });
  const r = await updater.checkUpdate(false);
  assert.equal(r.kind, 'local-repo');
  assert.equal(r.latestVersion, 'dsh-v0.1.6-alpha.1');
  assert.equal(r.hasUpdate, true);
  assert.equal(r.error, null);
});

test('createDshUpdate.checkUpdate: 当前已等于最新 tag → 无更新', async () => {
  const updater = createDshUpdate({
    getLaunch: () => ({ source: 'local-repo', cmd: 'pnpm', args: [], cwd: 'C:/repo' }),
    getDshConfig: () => ({}),
    fs: { readFileSync: () => JSON.stringify({ version: '0.1.6-alpha.1' }) },
    execFileP: async (cmd, args) => {
      if (cmd === 'git' && args[0] === 'remote') return 'origin\n';
      if (cmd === 'git' && args[0] === 'fetch') return '';
      if (cmd === 'git' && args[0] === 'tag') return 'dsh-v0.1.5-rc.2\ndsh-v0.1.6-alpha.1\n';
      return '';
    },
    now: () => 100000,
    throttleMs: 60 * 1000,
    logger: {}
  });
  const r = await updater.checkUpdate(false);
  assert.equal(r.hasUpdate, false);
  assert.equal(r.latestVersion, 'dsh-v0.1.6-alpha.1');
});

test('createDshUpdate.checkUpdate: git fetch 失败 → error 透出而非静默', async () => {
  const updater = createDshUpdate({
    getLaunch: () => ({ source: 'local-repo', cmd: 'pnpm', args: [], cwd: 'C:/repo' }),
    getDshConfig: () => ({}),
    fs: { readFileSync: () => JSON.stringify({ version: '0.1.5-rc.2' }) },
    execFileP: async (cmd, args) => {
      if (cmd === 'git' && args[0] === 'remote') return 'origin\n';
      if (cmd === 'git' && args[0] === 'fetch') throw new Error('network unreachable');
      return '';
    },
    now: () => 100000,
    throttleMs: 60 * 1000,
    logger: {}
  });
  const r = await updater.checkUpdate(false);
  assert.equal(r.hasUpdate, false);
  assert.match(r.error, /git fetch 失败/);
});

test('createDshUpdate.checkUpdate: 无 tag 回退上游分支比较', async () => {
  const updater = createDshUpdate({
    getLaunch: () => ({ source: 'local-repo', cmd: 'pnpm', args: [], cwd: 'C:/repo' }),
    getDshConfig: () => ({}),
    fs: { readFileSync: () => JSON.stringify({ version: '0.1.0' }) },
    execFileP: async (cmd, args) => {
      if (cmd === 'git' && args[0] === 'remote') return 'origin\n';
      if (cmd === 'git' && args[0] === 'fetch') return '';
      if (cmd === 'git' && args[0] === 'tag') return '\n';
      if (cmd === 'git' && args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return 'origin/master\n';
      if (cmd === 'git' && args[0] === 'rev-parse' && args[1] === 'HEAD') return 'abc123\n';
      if (cmd === 'git' && args[0] === 'rev-list') return '3\n';
      return '';
    },
    now: () => 100000,
    throttleMs: 60 * 1000,
    logger: {}
  });
  const r = await updater.checkUpdate(false);
  assert.equal(r.behind, 3);
  assert.equal(r.hasUpdate, true);
});

test('createDshUpdate.update: local-repo checkout 最新 tag + install + build', async () => {
  const calls = [];
  const updater = createDshUpdate({
    getLaunch: () => ({ source: 'local-repo', cmd: 'pnpm', args: [], cwd: 'C:/repo' }),
    getDshConfig: () => ({}),
    fs: { readFileSync: () => JSON.stringify({ version: '0.1.6-alpha.2' }) },
    execFileP: async (cmd, args) => {
      calls.push([cmd, ...args]);
      if (cmd === 'git' && args[0] === 'status') return '';
      if (cmd === 'git' && args[0] === 'tag') return 'dsh-v0.1.6-alpha.1\ndsh-v0.1.6-alpha.2\n';
      return '';
    },
    logger: {}
  });
  const r = await updater.update(true);
  assert.equal(r.ok, true);
  assert.equal(r.restartRequired, true);
  const flat = calls.map((c) => c.join(' '));
  assert.ok(flat.includes('git fetch --tags --force origin'), flat.join('\n'));
  assert.ok(flat.includes('git checkout dsh-v0.1.6-alpha.2'));
  assert.ok(flat.includes('corepack pnpm install'));
  assert.ok(flat.includes('corepack pnpm run build'));
  assert.ok(r.log.join('\n').includes('0.1.6-alpha.2'));
});

test('createDshUpdate.update: 无 tag 回退 git pull --ff-only', async () => {
  const calls = [];
  const updater = createDshUpdate({
    getLaunch: () => ({ source: 'local-repo', cmd: 'pnpm', args: [], cwd: 'C:/repo' }),
    getDshConfig: () => ({}),
    fs: { readFileSync: () => JSON.stringify({ version: '0.1.0' }) },
    execFileP: async (cmd, args) => {
      calls.push([cmd, ...args]);
      if (cmd === 'git' && args[0] === 'status') return '';
      if (cmd === 'git' && args[0] === 'tag') return '\n';
      return '';
    },
    logger: {}
  });
  const r = await updater.update(true);
  assert.equal(r.ok, true);
  const flat = calls.map((c) => c.join(' '));
  assert.ok(flat.includes('git pull --ff-only'));
  assert.ok(flat.includes('corepack pnpm run build'));
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

test('compareSimple 比较（兼容旧导出；预发布参与排序）', () => {
  assert.equal(compareSimple('0.1.0', '0.1.1'), -1);
  assert.equal(compareSimple('1.0.0', '0.9.9'), 1);
  assert.equal(compareSimple('0.1.1-rc.2', '0.1.1'), -1);
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
