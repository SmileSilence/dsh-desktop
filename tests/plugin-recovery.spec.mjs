import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  BUILTIN_BUNDLES, detectSuspectPlugins, failureLogName,
  disableBundles, disableAllThirdParty, readBundles, writeBundles
} = require('../main/plugin-recovery.js');

const BUNDLES = [
  '@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app',
  'dsh-workspace-enhancer', 'dshmarket', 'dsh-rewind-plugin', 'dsh-drop-in'
];

test('detectSuspectPlugins 识别日志中的第三方插件', () => {
  const log = "[error] Loading bundle \"dshmarket\" failed\n  at ... dsh-rewind-plugin ...";
  const suspects = detectSuspectPlugins(log, BUNDLES);
  assert.deepEqual(suspects, ['dshmarket', 'dsh-rewind-plugin']);
});

test('detectSuspectPlugins 忽略内置 bundle 与日志未出现的插件', () => {
  const log = "@deepseek-ai/dsh-base loaded";
  assert.deepEqual(detectSuspectPlugins(log, BUNDLES), []);
});

test('detectSuspectPlugins 支持作用域包短名匹配', () => {
  const log = "Cannot find module 'modlens'";
  const bundles = ['@liustack/modlens'];
  assert.deepEqual(detectSuspectPlugins(log, bundles), ['@liustack/modlens']);
});

test('detectSuspectPlugins 空日志 / 空 bundles 安全', () => {
  assert.deepEqual(detectSuspectPlugins(null, BUNDLES), []);
  assert.deepEqual(detectSuspectPlugins('', [1, 2]), []);
});

test('failureLogName 带时间戳', () => {
  const name = failureLogName(new Date('2026-09-06T05:04:03'));
  assert.equal(name, 'startup-failed-20260906-050403.log');
});

test('disableBundles 移除指定插件并保留其余', () => {
  const r = disableBundles(BUNDLES, ['dshmarket', 'dsh-drop-in']);
  assert.deepEqual(r.removed, ['dshmarket', 'dsh-drop-in']);
  assert.ok(!r.bundles.includes('dshmarket'));
  assert.ok(!r.bundles.includes('dsh-drop-in'));
  assert.ok(r.bundles.includes('dsh-workspace-enhancer'));
});

test('disableAllThirdParty 仅保留内置 bundle', () => {
  const r = disableAllThirdParty(BUNDLES);
  assert.deepEqual(r.bundles, BUILTIN_BUNDLES);
  assert.equal(r.removed.length, 4);
});

test('readBundles / writeBundles 往返', () => {
  const fsMem = {
    readFileSync: () => JSON.stringify({
      name: 'dsh-profile-web', dsh: { profile: { bundles: BUNDLES, patchReload: 'live' } }
    }),
    writeFileSync: function (p, data) { this.written = data; }
  };
  const bundles = readBundles('/x/package.json', fsMem);
  assert.deepEqual(bundles, BUNDLES);
  assert.equal(writeBundles('/x/package.json', ['@deepseek-ai/dsh-base'], fsMem), true);
  const written = JSON.parse(fsMem.written);
  assert.deepEqual(written.dsh.profile.bundles, ['@deepseek-ai/dsh-base']);
  assert.equal(written.dsh.profile.patchReload, 'live'); // 其余字段保留
});

test('readBundles 损坏文件返回空数组', () => {
  assert.deepEqual(readBundles('/x', { readFileSync: () => { throw new Error('enoent'); } }), []);
});