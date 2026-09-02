'use strict';

/** 构建隔离安装副本，验证真实 Electron 认证、重启和退出，不覆盖 dist 或现有安装。 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const assert = require('node:assert/strict');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { terminateProcessTree } = require('../main/dsh-runtime');
const exec = promisify(execFile);
const project = path.resolve(__dirname, '..');
const backend = process.argv[2] || process.env.DSH_REPO_ROOT;

async function waitUntil(check, timeout = 150000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('隔离验证超时');
}
async function freePort() {
  const socket = net.createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  return port;
}
async function portOpen(port) {
  return new Promise(resolve => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
  });
}
async function descendants(pid) {
  const { stdout } = await exec('powershell.exe', ['-NoProfile', '-Command',
    'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId | ConvertTo-Json -Compress'], { windowsHide: true, timeout: 15000 });
  const rows = JSON.parse(stdout);
  const owned = new Set([pid]);
  let size;
  do {
    size = owned.size;
    for (const row of rows) if (owned.has(row.ParentProcessId)) owned.add(row.ProcessId);
  } while (size !== owned.size);
  return [...owned];
}
function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

async function main() {
  assert.equal(process.platform, 'win32', '当前安装包冒烟脚本针对 Windows');
  assert.ok(backend, '用法：npm run test:startup -- <已构建的 deepseek-harness 仓库>');
  const backendRoot = path.resolve(backend);
  assert.ok(fs.existsSync(path.join(backendRoot, 'apps/web/dist/index.html')), '请先完成后端仓库构建');
  const tempParent = path.join(os.homedir(), 'Downloads', 'anget-tmp');
  fs.mkdirSync(tempParent, { recursive: true });
  const temporary = fs.mkdtempSync(path.join(tempParent, 'dsh-startup-smoke-'));
  let child;
  try {
    const appDir = path.join(temporary, 'app');
    const stage = path.join(temporary, 'stage');
    const userData = path.join(temporary, 'user-data');
    for (const dir of [stage, userData]) fs.mkdirSync(dir, { recursive: true });
    fs.cpSync(path.join(project, 'node_modules/electron/dist'), appDir, { recursive: true });
    const executable = path.join(appDir, 'DeepSeek Startup Smoke.exe');
    fs.renameSync(path.join(appDir, 'electron.exe'), executable);
    for (const item of ['main', 'main.js', 'preload.js', 'assets']) {
      fs.cpSync(path.join(project, item), path.join(stage, item), { recursive: true });
    }
    const pkg = JSON.parse(fs.readFileSync(path.join(project, 'package.json'), 'utf8'));
    pkg.main = 'startup-smoke-entry.cjs';
    fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify(pkg));
    fs.copyFileSync(path.join(__dirname, 'startup-smoke-entry.cjs'), path.join(stage, pkg.main));
    const asar = await import('@electron/asar');
    await asar.createPackage(stage, path.join(appDir, 'resources', 'app.asar'));
    fs.rmSync(path.join(appDir, 'resources', 'default_app.asar'), { force: true });
    const port = await freePort();
    const { DEFAULTS } = require('../main/config');
    const cfg = structuredClone(DEFAULTS);
    cfg.dsh.path = backendRoot;
    cfg.dsh.port = port;
    for (const key of Object.keys(cfg)) if (key.startsWith('hotkey')) cfg[key] = '';
    fs.writeFileSync(path.join(userData, 'config.json'), JSON.stringify(cfg));
    const reportFile = path.join(temporary, 'report.json');
    const quitFile = path.join(temporary, 'quit');
    const env = { ...process.env, DSH_REPO_ROOT: '', DSH_HOME: path.join(temporary, 'dsh-home'),
      DSH_SMOKE_USER_DATA: userData, DSH_SMOKE_PORT: String(port), DSH_SMOKE_REPORT: reportFile, DSH_SMOKE_QUIT: quitFile };
    delete env.ELECTRON_RUN_AS_NODE;
    child = spawn(executable, [], { cwd: appDir, windowsHide: true, env, stdio: 'ignore' });
    let launchError;
    child.once('error', error => { launchError = error; });
    await waitUntil(() => {
      if (launchError) throw launchError;
      if (child.exitCode !== null) throw new Error(`安装副本提前退出：${child.exitCode}`);
      return fs.existsSync(reportFile);
    });
    const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
    if (!report.ok) console.error(report.message);
    else console.log('安装副本已通过页面、Cookie 和重启验证，开始验证退出清理。');
    const owned = await descendants(child.pid);
    fs.writeFileSync(quitFile, 'quit');
    await waitUntil(() => child.exitCode !== null, 20000).catch(() => { throw new Error('桌面主进程未按时退出'); });
    await waitUntil(() => owned.every(pid => !alive(pid)), 10000).catch(() => { throw new Error(`退出后仍有子进程：${owned.filter(alive).join(', ')}`); });
    assert.equal(await portOpen(port), false, '退出后后端端口必须释放');
    assert.equal(report.ok, true, report.message);
    console.log(JSON.stringify({ ...report, processesStopped: owned.length, portReleased: true, exitCode: child.exitCode }));
  } finally {
    if (child?.pid && child.exitCode === null) await terminateProcessTree(child);
    const resolved = path.resolve(temporary);
    assert.equal(path.dirname(resolved), path.resolve(tempParent));
    assert.ok(path.basename(resolved).startsWith('dsh-startup-smoke-'));
    await fs.promises.rm(resolved, { recursive: true, force: true, maxRetries: 20, retryDelay: 300 });
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
