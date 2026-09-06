import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createAppUpdater, pickInstallerAsset, isNewer, backupDirFor } = require('../main/app-updater.js');
const { compareSemver } = require('../main/lib/semver.js');

const ASSETS = [
  { name: 'DeepSeek.Harness-1.4.0-Setup.exe', browser_download_url: 'https://github.com/SmileSilence/dsh-desktop/releases/download/v1.4.0/DeepSeek.Harness-1.4.0-Setup.exe', digest: 'sha256:abcdef1234567890', size: 88310981 },
  { name: 'DeepSeek.Harness-1.4.0-portable.zip', browser_download_url: 'https://github.com/SmileSilence/dsh-desktop/releases/download/v1.4.0/DeepSeek.Harness-1.4.0-portable.zip', digest: 'sha256:zzz', size: 1 }
];

test('pickInstallerAsset 选出 Setup.exe 且解析 digest', () => {
  const a = pickInstallerAsset(ASSETS, '1.4.0');
  assert.ok(a);
  assert.equal(a.name, 'DeepSeek.Harness-1.4.0-Setup.exe');
  assert.equal(a.digest, 'abcdef1234567890');
  assert.equal(a.size, 88310981);
});

test('pickInstallerAsset 拒绝非 GitHub/Gitee 主机', () => {
  const bad = [{ name: 'DeepSeek.Harness-1.4.0-Setup.exe', browser_download_url: 'https://evil.com/a.exe', digest: 'sha256:abc' }];
  assert.equal(pickInstallerAsset(bad, '1.4.0'), null);
});

test('pickInstallerAsset 版本不匹配返回 null', () => {
  assert.equal(pickInstallerAsset(ASSETS, '9.9.9'), null);
});

test('pickInstallerAsset 无 assets 返回 null', () => {
  assert.equal(pickInstallerAsset(undefined, '1.4.0'), null);
  assert.equal(pickInstallerAsset([], '1.4.0'), null);
});

test('isNewer 语义', () => {
  assert.equal(isNewer('1.4.0', '1.3.1', compareSemver), true);
  assert.equal(isNewer('1.3.1', '1.4.0', compareSemver), false);
  assert.equal(isNewer('1.4.0', '1.4.0', compareSemver), false);
  assert.equal(isNewer(null, '1.0.0', compareSemver), false);
});

test('backupDirFor 固定 .backup 后缀', () => {
  assert.equal(backupDirFor('C:/a/DSH_Desktop'), 'C:/a/DSH_Desktop.backup');
});

test('createAppUpdater.check 返回 hasAsset 与 hasUpdate', async () => {
  const updater = createAppUpdater({
    getCurrentVersion: () => '1.3.1',
    getInstallDir: () => 'C:/a/DSH_Desktop',
    fetch: async () => ({ version: 'v1.4.0', url: 'https://github.com/x/y/releases/v1.4.0', assets: ASSETS }),
    compare: compareSemver,
    path: require('path'),
    logger: {}
  });
  const r = await updater.check();
  assert.equal(r.hasUpdate, true);
  assert.equal(r.hasAsset, true);
  assert.equal(r.latest, 'v1.4.0');
});

test('createAppUpdater.downloadAndVerify 校验通过与失败', async () => {
  const base = {
    getCurrentVersion: () => '1.3.1', getInstallDir: () => 'C:/a',
    path: require('path'), logger: {}
  };
  const okUpdater = createAppUpdater({
    ...base,
    downloadFile: async (url, dest) => {},
    sha256File: async () => 'abcdef1234567890'
  });
  const ok = await okUpdater.downloadAndVerify({ url: 'https://github.com/a/b.exe', name: 'a.exe', digest: 'abcdef1234567890' }, 'C:/tmp');
  assert.equal(ok.ok, true);

  const badUpdater = createAppUpdater({
    ...base,
    downloadFile: async () => {},
    sha256File: async () => '0000000000000000'
  });
  await assert.rejects(
    () => badUpdater.downloadAndVerify({ url: 'https://github.com/a/b.exe', name: 'a.exe', digest: 'abcdef1234567890' }, 'C:/tmp'),
    (e) => e.code === 'SHA_MISMATCH'
  );
});

test('createAppUpdater.check 无新版时不提供资产安装', async () => {
  const updater = createAppUpdater({
    getCurrentVersion: () => '2.0.0',
    getInstallDir: () => 'C:/a',
    fetch: async () => ({ version: 'v1.4.0', assets: ASSETS }),
    compare: compareSemver,
    path: require('path'),
    logger: {}
  });
  const r = await updater.check();
  assert.equal(r.hasUpdate, false);
});