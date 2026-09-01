'use strict';

const { app, BrowserWindow, WebContentsView } = require('electron');
const path = require('path');
const { createTabManager } = require('../main/tab-manager');

app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, width: 1200, height: 800, frame: false, webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true, sandbox: true } });
  const manager = createTabManager({
    window, WebContentsView, getUrl: () => 'data:text/html,<title>Probe</title><main>ok</main>', getPosition: () => 'top',
    injector: { attachContent: () => {} }, preload: path.join(__dirname, '..', 'preload.js')
  });
  await window.loadFile(path.join(__dirname, '..', 'main', 'shell.html'));
  const first = manager.add();
  const singleRenameBlocked = manager.rename(first, '单页签禁止改名') === false;
  const second = manager.add();
  const multipleRenameAllowed = manager.rename(first, '工作页') === true;
  manager.activate(first);
  const state = manager.state();
  const active = state.tabs.find((tab) => tab.id === state.activeId);
  process.stdout.write(`${JSON.stringify({ tabCount: state.tabs.length, active: active?.id, activeTitle: active?.title, singleRenameBlocked, multipleRenameAllowed, position: state.position, childViews: window.contentView.children.length })}\n`);
  manager.destroy();
  window.destroy();
  app.quit();
});
