import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { contentBounds, normalizeTabTitle, createTabManager } = require('../main/tab-manager.js');

test('顶部页签仅为页签栏预留空间（原生标题栏在内容区外）', () => {
  assert.deepEqual(contentBounds({ width: 1200, height: 800 }, 'top'), { x: 0, y: 44, width: 1200, height: 756 });
});

test('单页签隐藏页签栏并占满内容区', () => {
  assert.deepEqual(contentBounds({ width: 1200, height: 800 }, 'top', false), { x: 0, y: 0, width: 1200, height: 800 });
  assert.deepEqual(contentBounds({ width: 1200, height: 800 }, 'left', false), { x: 0, y: 0, width: 1200, height: 800 });
});

test('左右页签布局不会产生纵向页面溢出', () => {
  assert.deepEqual(contentBounds({ width: 1200, height: 800 }, 'left'), { x: 184, y: 0, width: 1016, height: 800 });
  assert.deepEqual(contentBounds({ width: 1200, height: 800 }, 'right'), { x: 0, y: 0, width: 1016, height: 800 });
});

test('页签名称规范化并限制 40 字符', () => {
  assert.equal(normalizeTabTitle('  我的   工作页  '), '我的 工作页');
  assert.equal(normalizeTabTitle('x'.repeat(50)), 'x'.repeat(40));
  assert.equal(normalizeTabTitle('   '), null);
  assert.equal(normalizeTabTitle(null), null);
});

test('内部页签按 key 复用且可静默刷新', () => {
  class MockWebContents {
    constructor() { this.urls = []; }
    on() {}
    setWindowOpenHandler() {}
    loadURL(url) { this.urls.push(url); }
    close() {}
    isDestroyed() { return false; }
  }
  class MockView {
    constructor() { this.webContents = new MockWebContents(); }
    setBounds() {}
  }
  const children = [];
  const window = {
    isDestroyed: () => false,
    webContents: { send: () => undefined },
    contentView: {
      addChildView: (view) => children.push(view),
      removeChildView: (view) => { const i = children.indexOf(view); if (i >= 0) children.splice(i, 1); }
    },
    getContentBounds: () => ({ width: 1200, height: 800 }),
    on: () => undefined
  };
  const manager = createTabManager({
    window, WebContentsView: MockView, getUrl: () => 'http://127.0.0.1:3080',
    getPosition: () => 'top', injector: { attachContent: () => undefined }, preload: 'preload.js'
  });
  const first = manager.openInternal('settings', '设置', 'data:text/html,one');
  const second = manager.openInternal('settings', '设置', 'data:text/html,two', false);
  assert.equal(first, second);
  assert.equal(manager.state().tabs.length, 1);
  assert.equal(manager.has('settings'), true);
  assert.equal(children.length, 1);
});

test('关闭非活动页签后重排内容区（页签栏隐藏时内容占满）', () => {
  const boundsCalls = [];
  class MockWebContents {
    constructor() { this.urls = []; }
    on() {}
    setWindowOpenHandler() {}
    loadURL(url) { this.urls.push(url); }
    close() {}
    isDestroyed() { return false; }
  }
  class MockView {
    constructor() { this.webContents = new MockWebContents(); }
    setBounds(b) { boundsCalls.push(b); }
  }
  const children = [];
  const window = {
    isDestroyed: () => false,
    webContents: { send: () => undefined },
    contentView: {
      addChildView: (view) => children.push(view),
      removeChildView: (view) => { const i = children.indexOf(view); if (i >= 0) children.splice(i, 1); }
    },
    getContentBounds: () => ({ width: 1200, height: 800 }),
    on: () => undefined
  };
  const manager = createTabManager({
    window, WebContentsView: MockView, getUrl: () => 'http://127.0.0.1:3080',
    getPosition: () => 'top', injector: { attachContent: () => undefined }, preload: 'preload.js'
  });
  const a = manager.add({ title: 'A' });
  const b = manager.add({ title: 'B' });
  manager.activate(a); // 使 A 成为活动页签
  boundsCalls.length = 0;
  manager.close(b); // 关闭非活动页签 B → 只剩 1 个页签，页签栏应隐藏且内容区重排占满
  assert.equal(manager.state().tabs.length, 1);
  assert.equal(manager.state().showTabbar, false);
  assert.ok(boundsCalls.length > 0, 'close 后应触发 layout() 重排');
  assert.deepEqual(boundsCalls[boundsCalls.length - 1], { x: 0, y: 0, width: 1200, height: 800 });
});
