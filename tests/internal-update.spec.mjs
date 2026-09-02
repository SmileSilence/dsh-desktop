import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { formatAppUpdate } = require('../main/internal-update.js');
const lang = {
  appUpdateRateLimited: '请求受限', appUpdateNoRelease: '无正式版',
  appUpdateInvalidResponse: '响应错误', appUpdateInvalidVersion: '版本错误',
  appUpdateTimeout: '超时', appUpdateNetworkError: '网络错误', appUpdateFailed: '检查失败',
  versionCurrent: '当前', versionLatest: '最新', versionUnknown: '未知',
  appUpdateAvailable: '发现更新', appUpdateCurrent: '已是最新'
};

test('桌面新版存在时显示版本并允许打开 GitHub 下载页', () => {
  const view = formatAppUpdate({ current: '1.3.1', latest: 'v1.4.0', hasUpdate: true, url: 'https://github.com/x/y/releases/tag/v1.4.0' }, lang);
  assert.match(view.text, /1\.3\.1.*v1\.4\.0.*发现更新/);
  assert.equal(view.canOpen, true);
});

test('已是最新、失败或非 GitHub 地址均不允许打开下载页', () => {
  assert.equal(formatAppUpdate({ current: '1.3.1', latest: 'v1.3.1', hasUpdate: false }, lang).canOpen, false);
  assert.equal(formatAppUpdate({ errorCode: 'RATE_LIMITED' }, lang).text, '请求受限');
  assert.equal(formatAppUpdate({ current: '1.0.0', latest: '2.0.0', hasUpdate: true, url: 'https://evil.example/a' }, lang).canOpen, false);
});
