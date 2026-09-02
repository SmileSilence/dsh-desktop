'use strict';

// 仅由 smoke-startup.cjs 装入临时安装包，正式分发仍使用 main.js。
const { app, BrowserWindow, session, webContents } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { redactOutput } = require('./main/dsh-runtime');
let fatalError = null;

process.on('uncaughtException', error => { fatalError ||= error; });
process.on('unhandledRejection', reason => {
  fatalError ||= reason instanceof Error ? reason : new Error(String(reason));
});

app.setPath('userData', process.env.DSH_SMOKE_USER_DATA);
app.disableHardwareAcceleration();
app.on('browser-window-created', (_event, window) => {
  window.on('show', () => window.hide());
  window.hide();
});

require('./main.js');

async function until(check, timeout = 100000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('隔离安装包验证等待超时');
}

app.whenReady().then(async () => {
  const began = Date.now();
  const base = `http://127.0.0.1:${process.env.DSH_SMOKE_PORT}`;
  const configPath = path.join(app.getPath('userData'), 'config.json');
  let report;
  try {
    assert.equal(app.isPackaged, true);
    let page;
    await until(async () => {
      if (fatalError) throw fatalError;
      page = webContents.getAllWebContents().find(contents => contents.getURL().startsWith(base));
      return page && !page.isLoading() && await page.executeJavaScript('document.body.innerText.length > 20');
    });
    await new Promise(resolve => setTimeout(resolve, 200));
    if (fatalError) throw fatalError;
    const startupMs = Date.now() - began;
    const brandTitle = process.env.DSH_SMOKE_BRAND_TITLE;
    await until(() => page.executeJavaScript(`document.body.innerText.includes(${JSON.stringify(brandTitle)})`));
    assert.equal(new URL(page.getURL()).searchParams.has('token'), false);
    const cookies = await session.defaultSession.cookies.get({ url: base });
    assert.ok(cookies.some(cookie => cookie.name.startsWith('dsh-auth-')));
    const response = await session.defaultSession.fetch(base, { credentials: 'include' });
    assert.equal(response.status, 200);
    await response.body.cancel();
    const aboutWindow = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false
      }
    });
    await aboutWindow.loadFile(path.join(__dirname, 'main', 'internal.html'), { query: { view: 'about' } });
    await aboutWindow.webContents.executeJavaScript('document.getElementById("appUpdateCheck").click()');
    await until(async () => aboutWindow.webContents.executeJavaScript(`(() => {
      const button = document.getElementById('appUpdateCheck');
      const text = document.getElementById('appUpdateStatus').textContent;
      return !button.disabled && text.includes(${JSON.stringify(app.getVersion())}) && /v?\\d+\\.\\d+\\.\\d+/.test(text);
    })()`));
    const appUpdateStatus = await aboutWindow.webContents.executeJavaScript('document.getElementById("appUpdateStatus").textContent');
    aboutWindow.destroy();
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const bridge = `http://127.0.0.1:${cfg.bridge.port}`;
    const headers = { authorization: `Bearer ${cfg.bridge.token}`, 'content-type': 'application/json' };
    const restarted = await fetch(`${bridge}/api/backend/restart`, { method: 'POST', headers, body: '{}' });
    const result = await restarted.json();
    assert.equal(result.ok, true);
    assert.equal(result.data.started, true);
    const afterRestart = await session.defaultSession.fetch(base, { credentials: 'include' });
    assert.equal(afterRestart.status, 200);
    await afterRestart.body.cancel();
    const log = fs.readFileSync(path.join(app.getPath('userData'), 'logs', 'dsh-desktop.log'), 'utf8');
    assert.ok(!/[?&]token=[A-Za-z0-9_-]+/.test(log));
    report = { ok: true, packaged: true, startupMs, port: Number(process.env.DSH_SMOKE_PORT),
      pageLoaded: true, brandTitleApplied: true, appUpdateChecked: true, appUpdateStatus,
      authenticatedCookie: true, httpStatus: 200, restart: true, credentialsRedacted: true };
  } catch (error) {
    const logPath = path.join(app.getPath('userData'), 'logs', 'dsh-desktop.log');
    const logTail = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8').slice(-6000) : '日志未创建';
    report = { ok: false, message: redactOutput(`${error.stack || error.message}\n${logTail}`) };
  }
  fs.writeFileSync(process.env.DSH_SMOKE_REPORT, JSON.stringify(report));
  // 主控先记录进程树，再允许退出，验证实际清理而非只验证端口关闭。
  await until(() => fs.existsSync(process.env.DSH_SMOKE_QUIT), 15000).catch(() => {});
  app.quit();
});
