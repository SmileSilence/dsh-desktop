import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { windowConfigFor, chromeColorsFor, restoreWindowBounds } = require('../main/window.js');
const { isSameOrigin } = require('../main/inject/index.js');

// ============ windowConfigFor（§15.3 WCO 分平台） ============
test('win32 → 原生标题栏（空对象），无 WCO overlay', () => {
  const c = windowConfigFor('win32', { bg: '#1a1a2e', fg: '#ffffff' });
  assert.deepEqual(c, {});
  assert.equal(c.titleBarOverlay, undefined);
});

test('darwin → hiddenInset + trafficLightPosition，无 overlay', () => {
  const c = windowConfigFor('darwin', { bg: '#1a1a2e', fg: '#ffffff' });
  assert.equal(c.titleBarStyle, 'hiddenInset');
  assert.deepEqual(c.trafficLightPosition, { x: 15, y: 15 });
  assert.equal(c.titleBarOverlay, undefined);
});

test('其他平台 → 空对象（回退默认标题栏）', () => {
  assert.deepEqual(windowConfigFor('linux', { bg: '#000', fg: '#fff' }), {});
});

// ============ chromeColorsFor（P1.6） ============
test('chromeColorsFor dark/light', () => {
  assert.deepEqual(chromeColorsFor('dark'), { bg: '#151517', fg: '#f9fafb' });
  assert.deepEqual(chromeColorsFor('light'), { bg: '#ffffff', fg: '#0f1115' });
});

// ============ restoreWindowBounds（B2 越界回退） ============
test('restoreWindowBounds 默认值', () => {
  const b = restoreWindowBounds(null, { width: 1200, height: 800 });
  assert.equal(b.width, 1200);
  assert.equal(b.height, 800);
  assert.equal(b.maximized, false);
  assert.equal(b.x, undefined);
});

test('restoreWindowBounds 保留位置', () => {
  const displays = () => [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }];
  const b = restoreWindowBounds({ x: 100, y: 100, width: 1000, height: 700, maximized: true }, { width: 1200, height: 800 }, displays);
  assert.equal(b.width, 1000);
  assert.equal(b.height, 700);
  assert.equal(b.maximized, true);
  assert.equal(b.x, 100);
  assert.equal(b.y, 100);
});

test('restoreWindowBounds 越界时回退默认（不设 x/y）', () => {
  const displays = () => [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }];
  // 窗口完全移出屏幕
  const b = restoreWindowBounds({ x: 5000, y: 5000, width: 1000, height: 700, maximized: false }, { width: 1200, height: 800 }, displays);
  assert.equal(b.x, undefined);
  assert.equal(b.y, undefined);
  assert.equal(b.width, 1000);
});

// ============ isSameOrigin（D2 同源白名单） ============
test('isSameOrigin 同源通过', () => {
  assert.equal(isSameOrigin('http://127.0.0.1:3080/settings', 'http://127.0.0.1:3080'), true);
  assert.equal(isSameOrigin('http://localhost:3080/', 'http://127.0.0.1:3080'), false);
});

test('isSameOrigin 异源/非法拒绝', () => {
  assert.equal(isSameOrigin('https://evil.com/', 'http://127.0.0.1:3080'), false);
  assert.equal(isSameOrigin('not-a-url', 'http://127.0.0.1:3080'), false);
});
