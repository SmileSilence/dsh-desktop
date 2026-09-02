'use strict';

// 仅由 smoke-startup.cjs 装入临时安装包，正式分发仍使用 main.js。
const { app, session, webContents } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { redactOutput } = require('./main/dsh-runtime');

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
      page = webContents.getAllWebContents().find(contents => contents.getURL().startsWith(base));
      return page && !page.isLoading() && await page.executeJavaScript('document.body.innerText.length > 20');
    });
    const startupMs = Date.now() - began;
    assert.equal(new URL(page.getURL()).searchParams.has('token'), false);
    const cookies = await session.defaultSession.cookies.get({ url: base });
    assert.ok(cookies.some(cookie => cookie.name.startsWith('dsh-auth-')));
    const response = await session.defaultSession.fetch(base, { credentials: 'include' });
    assert.equal(response.status, 200);
    await response.body.cancel();
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
      pageLoaded: true, authenticatedCookie: true, httpStatus: 200, restart: true, credentialsRedacted: true };
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
