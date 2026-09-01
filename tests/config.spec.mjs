import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { DEFAULTS, mergeConfig, validateConfig, migrateLegacy, createConfigStore } = require('../main/config.js');

test('DEFAULTS 形状符合 §15.5 schema', () => {
  assert.equal(DEFAULTS.window.width, 1200);
  assert.equal(DEFAULTS.window.height, 800);
  assert.equal(DEFAULTS.theme.mode, 'system');
  assert.equal(DEFAULTS.tray.closeToTray, true);
  assert.equal(DEFAULTS.hotkey, 'CommandOrControl+Shift+D');
  assert.equal(DEFAULTS.hotkeySettings, 'CommandOrControl+,');
  assert.equal(DEFAULTS.hotkeyAbout, 'F1');
  assert.equal(DEFAULTS.hotkeyRestartBackend, 'CommandOrControl+Shift+R');
  assert.equal(DEFAULTS.hotkeyNewTab, 'CommandOrControl+T');
  assert.equal(DEFAULTS.dsh.port, 3080);
  assert.equal(DEFAULTS.dsh.checkOnStartup, false);
  assert.equal(DEFAULTS.bridge.token, '');
  assert.equal(DEFAULTS.updater.channel, 'stable');
  assert.equal(DEFAULTS.language, 'zh-CN');
});

test('集成模式固定为共享 web，不需要插件镜像', () => {
  assert.equal(DEFAULTS.integration.mode, 'shared-web');
  assert.equal('desktopProfile' in DEFAULTS.integration, false);
  assert.equal('autoInstallPlugin' in DEFAULTS.integration, false);
});

test('mergeConfig 合并默认值 + 用户值', () => {
  const merged = mergeConfig(DEFAULTS, { tray: { topMost: true }, language: 'en-US' }, {});
  assert.equal(merged.tray.topMost, true);
  assert.equal(merged.tray.closeToTray, true); // 默认保留
  assert.equal(merged.language, 'en-US');
  assert.equal(merged.window.width, 1200);
});

test('mergeConfig 丢弃未知字段', () => {
  const merged = mergeConfig(DEFAULTS, { evil: 'x', tray: { nope: 1, topMost: true } }, {});
  assert.equal(merged.evil, undefined);
  assert.equal(merged.tray.nope, undefined);
  assert.equal(merged.tray.topMost, true);
});

test('mergeConfig 环境变量 DSH_REPO_ROOT 覆盖 dsh.path', () => {
  const merged = mergeConfig(DEFAULTS, { dsh: { path: 'C:/a' } }, { DSH_REPO_ROOT: 'C:/b' });
  assert.equal(merged.dsh.path, 'C:/b');
  const merged2 = mergeConfig(DEFAULTS, { dsh: { path: 'C:/a' } }, { DSH_REPO_ROOT: '  ' });
  assert.equal(merged2.dsh.path, 'C:/a'); // 空白 env 不覆盖
});

test('migrateLegacy 旧扁平配置 → 嵌套 schema', () => {
  const migrated = migrateLegacy({
    autoLaunch: true,
    closeToTray: false,
    topMost: true,
    darkMode: true,
    hotkey: 'Ctrl+Shift+X',
    language: 'en-US',
    dshPath: 'C:/repo'
  });
  assert.equal(migrated.tray.autoLaunch, true);
  assert.equal(migrated.tray.closeToTray, false);
  assert.equal(migrated.tray.topMost, true);
  assert.equal(migrated.theme.mode, 'dark');
  assert.equal(migrated.hotkey, 'Ctrl+Shift+X');
  assert.equal(migrated.language, 'en-US');
  assert.equal(migrated.dsh.path, 'C:/repo');
  // 未提供的旧字段不产生嵌套键
  assert.equal(migrated.tray.showInTaskbar, undefined);
});

test('migrateLegacy darkMode=false → theme.mode light', () => {
  const migrated = migrateLegacy({ darkMode: false });
  assert.equal(migrated.theme.mode, 'light');
});

test('validateConfig 合法配置 ok=true', () => {
  const { ok, errors } = validateConfig(mergeConfig(DEFAULTS, {}, {}));
  assert.equal(ok, true, JSON.stringify(errors));
});

test('validateConfig 非法字段报错', () => {
  const bad = {
    ...DEFAULTS,
    language: 'xx-XX',
    window: { x: null, y: null, width: 100, height: 800, maximized: 'yes' },
    theme: { mode: 'blue' },
    dsh: { ...DEFAULTS.dsh, port: 99999 },
    bridge: { ...DEFAULTS.bridge, token: 42 }
  };
  const { ok, errors } = validateConfig(bad);
  assert.equal(ok, false);
  const paths = errors.map((e) => e.path);
  for (const p of ['language', 'window.width', 'window.maximized', 'theme.mode', 'dsh.port', 'bridge.token']) {
    assert.ok(paths.includes(p), `应报错 ${p}，实际: ${paths.join(',')}`);
  }
});

test('createConfigStore 原子写 + 重新加载', () => {
  const fsMod = require('fs');
  const os = require('os');
  const path = require('path');
  const dir = fsMod.mkdtempSync(path.join(os.tmpdir(), 'dsh-config-'));
  const store = createConfigStore({ userDataPath: dir, fs: fsMod, logger: {} });
  const cfg = store.load();
  assert.equal(cfg.dsh.port, 3080);

  store.set({ tray: { closeToTray: false }, language: 'en-US' });
  // 确认落盘为原子文件（无 .tmp 残留）且内容正确
  const files = fsMod.readdirSync(dir);
  assert.ok(!files.includes('config.json.tmp'), `不应残留 tmp 文件: ${files}`);
  const onDisk = JSON.parse(fsMod.readFileSync(path.join(dir, 'config.json'), 'utf-8'));
  assert.equal(onDisk.tray.closeToTray, false);
  assert.equal(onDisk.language, 'en-US');

  // 重新加载（新 store）能读到
  const store2 = createConfigStore({ userDataPath: dir, fs: fsMod, logger: {} });
  const cfg2 = store2.load();
  assert.equal(cfg2.tray.closeToTray, false);
  assert.equal(cfg2.language, 'en-US');

  // 非法 set 抛错且不写盘
  assert.throws(() => store.set({ dsh: { port: 0 } }));
  fsMod.rmSync(dir, { recursive: true, force: true });
});
