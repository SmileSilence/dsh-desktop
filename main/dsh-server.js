'use strict';

const path = require('path');
const os = require('os');
const { redactOutput, createLineReader, parseLaunchUrl, createSessionProbe, terminateProcessTree } = require('./dsh-runtime');

/**
 * DSH 后端探测/启动/停止/重启（C1 / B5 / §15.4）。
 * - resolveLaunch(dsh, facts) 为纯函数：不碰 fs/exec/electron，输入探测事实输出启动命令；
 * - createDshServer(deps) 工厂：所有副作用（spawn/net/http/fs/exec）由 deps 注入。
 */

/**
 * 解析 DSH 启动命令（纯函数，P0.3）。
 * @param {{ path:string, port:number, profile:string, proxy:string, env:object }} dsh config.dsh 段
 * @param {{ repoPaths:string[], hasGlobalCli:boolean, npmGlobalPath:string|null, hasSystemNode:boolean }} facts 探测事实
 * @returns {{ cmd:string, args:string[], cwd:string|null, source:string }}
 */
function resolveLaunch(dsh, facts) {
  dsh = { ...dsh, path: facts.configuredPath ?? dsh.path };
  const port = dsh.port || 3080;
  const baseArgs = dsh.profile
    ? ['--profile', dsh.profile, '--no-open']
    : ['web', '--no-open'];
  if (port !== 3080) baseArgs.push('--port', String(port));
  if (dsh.proxy) baseArgs.push('--proxy', dsh.proxy);

  // 1) 配置指定路径且存在 package.json
  if (dsh.path && facts.repoPaths.includes(dsh.path)) {
    return { cmd: 'pnpm', args: ['dsh', ...baseArgs], cwd: dsh.path, source: 'config-path' };
  }

  // 2) 本地仓库候选（已按优先级过滤存在 package.json 的路径）
  const localRepo = (facts.repoPaths || []).find((p) => p !== dsh.path);
  if (localRepo) {
    return { cmd: 'pnpm', args: ['dsh', ...baseArgs], cwd: localRepo, source: 'local-repo' };
  }

  // 3) 全局 CLI
  if (facts.hasGlobalCli) {
    return { cmd: 'dsh', args: baseArgs, cwd: null, source: 'global-cli' };
  }

  // 4) npm 全局包
  if (facts.npmGlobalPath) {
    return { cmd: 'npx', args: ['@deepseek-ai/dsh', ...baseArgs], cwd: null, source: 'npm-global' };
  }

  // 5) npx 兜底
  return { cmd: 'npx', args: ['@deepseek-ai/dsh', ...baseArgs], cwd: null, source: 'npx' };
}

/**
 * 管理一次启动的探测、认证、等待和进程所有权。
 * probeUrl(url, {signal, timeoutMs}) 必须使用页面会话并在认证后返回 boolean。
 * terminateProcess、clock 和系统依赖可注入；停止时取消本轮全部异步工作。
 */
function createDshServer(deps) {
  const { projectRoot, getDshConfig, logger = {} } = deps;
  const spawn = deps.spawn || require('node:child_process').spawn;
  const execSync = deps.execSync || require('node:child_process').execSync;
  const net = deps.net || require('node:net');
  const fs = deps.fs || require('node:fs');
  const osMod = deps.os || os;
  const environment = deps.env || process.env;
  const platform = deps.platform || process.platform;
  const pathMod = platform === 'win32' ? path.win32 : path;
  const executablePath = deps.executablePath || process.execPath;
  const clock = deps.clock || { setTimeout, clearTimeout };
  const terminate = deps.terminateProcess || terminateProcessTree;
  const probeUrl = deps.probeUrl || createSessionProbe(() => ({ fetch }));
  let active = null;
  let starting = null;
  let stopping = null;
  let restarting = null;
  let ready = false;
  let lastStdout = '';
  let lastStderr = '';

  //#region 配置和探测
  function dshConfig() {
    const cfg = { ...(getDshConfig().dsh || {}) };
    if (environment.DSH_REPO_ROOT?.trim()) cfg.path = environment.DSH_REPO_ROOT.trim();
    if (cfg.path) cfg.path = pathMod.resolve(cfg.path.trim());
    return cfg;
  }
  function dshUrl() { return `http://127.0.0.1:${dshConfig().port || 3080}`; }
  function error(code, message) { return Object.assign(new Error(redactOutput(message)), { code }); }
  function commandAvailable(command, env) {
    try {
      execSync(`${command} --version`, { env, stdio: 'ignore', windowsHide: true, timeout: 5000 });
      return true;
    } catch { return false; }
  }
  function isRepository(root) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pathMod.join(root, 'package.json'), 'utf8'));
      return typeof pkg.scripts?.dsh === 'string';
    } catch { return false; }
  }
  function detectFacts() {
    const cfg = dshConfig();
    if (cfg.path && !isRepository(cfg.path)) {
      throw error('INVALID_REPO', `指定的 DSH 仓库不可用：${cfg.path}\n请选择含 package.json 和 dsh 启动脚本的仓库，或清除无效的 DSH_REPO_ROOT / 路径设置。`);
    }
    const candidates = [cfg.path,
      pathMod.join(pathMod.dirname(executablePath), '..', 'deepseek-harness'),
      pathMod.join(pathMod.dirname(executablePath), 'deepseek-harness'),
      pathMod.join(projectRoot, '..', 'deepseek-harness'),
      pathMod.join(projectRoot, 'deepseek-harness'),
      pathMod.join(osMod.homedir(), 'deepseek-harness'),
      pathMod.join(osMod.homedir(), 'Desktop', 'deepseek-harness'),
      pathMod.join(osMod.homedir(), 'Documents', 'deepseek-harness')].filter(Boolean);
    const seen = new Set();
    const repoPaths = candidates.map(p => pathMod.resolve(p)).filter(p => {
      const key = platform === 'win32' ? p.toLowerCase() : p;
      if (seen.has(key)) return false;
      seen.add(key);
      return isRepository(p);
    });
    const env = { ...environment, ...(cfg.env || {}) };
    const hasSystemNode = commandAvailable('node', env);
    // 本地源码已找到时，不运行无关的全局工具探测。
    const hasGlobalCli = repoPaths.length === 0 && commandAvailable('dsh', env);
    let npmGlobalPath = null;
    if (repoPaths.length === 0 && !hasGlobalCli) {
      try {
        const root = execSync('npm root -g', { env, encoding: 'utf8', windowsHide: true, timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
        const candidate = pathMod.join(root, '@deepseek-ai', 'dsh');
        if (fs.existsSync(pathMod.join(candidate, 'package.json'))) npmGlobalPath = candidate;
      } catch { /* npm 不可用时，由所选启动方式的检查输出操作指引。 */ }
    }
    return { repoPaths, hasGlobalCli, npmGlobalPath, hasSystemNode, configuredPath: cfg.path || '' };
  }
  function preflight(launch, facts, cfg) {
    if (!facts.hasSystemNode) throw error('MISSING_NODE', '未找到可用的 Node.js。请安装满足 DSH 仓库 engines 要求的 Node.js，并重新启动桌面端。');
    const env = { ...environment, ...(cfg.env || {}) };
    for (const command of launch.cmd === 'npx' ? ['npm', 'npx'] : [launch.cmd]) {
      if (!commandAvailable(command, env)) throw error('MISSING_TOOL', `未找到可用的 ${command}。请安装该工具并确认 PATH 配置后重新启动桌面端。`);
    }
    if (!launch.cwd) return;
    const root = launch.cwd;
    const inRepo = relative => fs.existsSync(pathMod.join(root, relative));
    const hint = `仓库：${root}\n请在此目录打开 PowerShell，运行：`;
    if (!inRepo('apps/cli/src/bin.ts')) throw error('MISSING_ENTRY', `DSH 源码启动入口缺失。\n${hint}\ngit status\n请恢复完整的 deepseek-harness 源码。`);
    if (!inRepo('node_modules/tsx/package.json')) throw error('MISSING_DEPENDENCIES', `DSH 源码依赖尚未安装。\n${hint}\npnpm install --frozen-lockfile\npnpm run build`);
    if (!inRepo('apps/cli/lib/bin.js') || !inRepo('apps/web/dist/index.html')) {
      throw error('MISSING_BUILD', `DSH 构建产物缺失。\n${hint}\npnpm run build`);
    }
  }
  function isPortInUse(port) {
    if (deps.isPortInUse) return deps.isPortInUse(port);
    return new Promise(resolve => {
      const socket = new net.Socket();
      const finish = value => { socket.destroy(); resolve(value); };
      socket.setTimeout(2000);
      socket.once('connect', () => finish(true));
      socket.once('timeout', () => finish(false));
      socket.once('error', () => finish(false));
      socket.connect(port, '127.0.0.1');
    });
  }
  async function isServerReady() { return probeUrl(dshUrl(), { timeoutMs: 3000 }); }
  //#endregion

  //#region 单次启动和输出
  function assertActive(attempt) {
    if (active !== attempt || attempt.controller.signal.aborted) throw error('START_CANCELLED', 'DSH 后端启动已取消。');
  }
  function recordLine(attempt, channel, line) {
    const safe = redactOutput(line);
    attempt[channel] = (attempt[channel] + safe + '\n').slice(-2048);
    if (active !== attempt) return;
    // stdout / stderr 都按完整行脱敏，截断诊断内容不会留下半截 token。
    const url = parseLaunchUrl(line, attempt.port);
    if (url) attempt.loginUrl = url;
    if (safe.trim()) logger.log?.(`[${channel}] ${safe.trim()}`);
    lastStdout = attempt.stdout;
    lastStderr = attempt.stderr;
  }
  function attachChild(attempt, child) {
    attempt.child = child;
    for (const channel of ['stdout', 'stderr']) {
      const reader = createLineReader(line => recordLine(attempt, channel, line));
      child[channel]?.on('data', chunk => reader.write(chunk));
      child[channel]?.once('end', () => reader.end());
      child.once('exit', () => reader.end());
      child.once('close', () => reader.end());
    }
    child.once('error', cause => attempt.fail(error('SPAWN_FAILED', `无法启动 DSH 后端：${cause.message}`)));
    child.once('exit', (code, signal) => {
      if (active !== attempt) return;
      ready = false;
      attempt.loginUrl = null;
      logger.log?.(`DSH 后端已退出（退出码 ${code}，信号 ${signal || '无'}）。`);
      attempt.fail(error('PROCESS_EXITED', `DSH 后端提前退出（退出码 ${code}，信号 ${signal || '无'}）。`));
    });
  }
  function pause(attempt, ms) {
    return new Promise(resolve => {
      const finish = () => {
        clock.clearTimeout(timer);
        attempt.controller.signal.removeEventListener('abort', finish);
        resolve();
      };
      const timer = clock.setTimeout(finish, ms);
      attempt.controller.signal.addEventListener('abort', finish, { once: true });
    });
  }
  async function waitForServer(timeoutMs = 90000, intervalMs = 2000, attempt = active) {
    if (!attempt) throw error('NOT_STARTING', '没有正在启动的 DSH 后端。');
    const timer = clock.setTimeout(() => attempt.fail(error('START_TIMEOUT',
      `DSH Web 服务启动超时（${Math.round(timeoutMs / 1000)}秒）。\n${attempt.launch?.cmd === 'npx'
        ? '首次 npx 安装可能超过等待期限，请先在终端运行 npm install -g @deepseek-ai/dsh，完成后重试。'
        : '请查看下方后端日志，检查依赖、构建产物和端口。'}`)), timeoutMs);
    try {
      while (true) {
        assertActive(attempt);
        const loginUrl = attempt.loginUrl;
        const ok = await Promise.race([
          probeUrl(loginUrl || attempt.url, { signal: attempt.controller.signal, timeoutMs: 3000 }),
          attempt.failure
        ]);
        assertActive(attempt);
        if (ok) { attempt.loginUrl = null; return; }
        await Promise.race([pause(attempt, intervalMs), attempt.failure]);
      }
    } finally { clock.clearTimeout(timer); }
  }
  async function launchAttempt(attempt) {
    const occupied = await isPortInUse(attempt.port);
    assertActive(attempt);
    if (occupied) {
      if (!attempt.cfg.dedicated && await probeUrl(attempt.url, { signal: attempt.controller.signal, timeoutMs: 3000 })) {
        assertActive(attempt);
        ready = true;
        return { reused: true, port: attempt.port };
      }
      assertActive(attempt);
      throw error('PORT_UNAVAILABLE', `端口 ${attempt.port} 已被占用，当前桌面会话无法访问该服务。请在原服务中完成登录，或关闭该服务后重试。`);
    }
    const facts = detectFacts();
    const launch = resolveLaunch(attempt.cfg, facts);
    attempt.launch = launch;
    preflight(launch, facts, attempt.cfg);
    assertActive(attempt);
    lastStdout = '';
    lastStderr = '';
    logger.log?.(`启动来源：${launch.source}；工作目录：${launch.cwd || '默认'}；命令：${redactOutput(`${launch.cmd} ${launch.args.join(' ')}`)}`);
    const child = spawn(launch.cmd, launch.args, {
      cwd: launch.cwd, detached: false, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
      env: { ...environment, ...(attempt.cfg.env || {}) }, shell: true
    });
    attachChild(attempt, child);
    await waitForServer(90000, 2000, attempt);
    assertActive(attempt);
    ready = true;
    logger.log?.('DSH Web 服务已就绪，浏览器会话认证完成。');
    return { reused: false, source: launch.source, port: attempt.port };
  }
  //#endregion

  //#region 启动、取消与进程所有权
  function cleanup(attempt) {
    if (!attempt.cleanup) {
      attempt.cleanup = Promise.resolve().then(() => attempt.child ? terminate(attempt.child) : undefined).then(() => {
        attempt.child = null;
      }).catch(cause => { attempt.cleanup = null; throw cause; });
    }
    return attempt.cleanup;
  }
  function start() {
    if (stopping) return stopping.then(() => start());
    if (starting) return starting;
    if (ready && active) return Promise.resolve(active.result);
    if (active?.child && active.child.exitCode === null && !active.child.signalCode) {
      return Promise.reject(error('STOP_REQUIRED', '上次后端尚未结束，请先停止后重试。'));
    }
    let cfg;
    try { cfg = dshConfig(); } catch (cause) { return Promise.reject(cause); }
    const controller = new AbortController();
    let fail;
    const failure = new Promise((resolve, reject) => { fail = reject; });
    // 服务就绪后的退出仍记录状态；没有等待者时也不会产生未处理的拒绝。
    failure.catch(() => {});
    const attempt = { cfg, port: cfg.port || 3080, url: dshUrl(), controller, failure, fail,
      child: null, loginUrl: null, stdout: '', stderr: '', cleanup: null, result: null };
    active = attempt;
    const work = Promise.race([launchAttempt(attempt), failure]).then(result => {
      attempt.result = result;
      return result;
    }).catch(async cause => {
      controller.abort();
      attempt.loginUrl = null;
      let cleanupMessage = '';
      try { await cleanup(attempt); } catch (cleanupError) { cleanupMessage = `\n清理失败：${cleanupError.message}`; }
      if (active === attempt) {
        ready = false;
        if (!attempt.child) active = null;
      }
      const tail = [attempt.stderr.trim(), attempt.stdout.trim()].filter(Boolean).join('\n').slice(-1500);
      const detail = error(cause.code || 'START_FAILED', `${cause.message}${cleanupMessage}${tail ? `\n后端日志：\n${tail}` : ''}`);
      logger.logError?.(detail.message);
      throw detail;
    }).finally(() => { if (starting === work) starting = null; });
    starting = work;
    return work;
  }
  function stop() {
    if (stopping) return stopping;
    const attempt = active;
    ready = false;
    if (!attempt) return Promise.resolve();
    attempt.controller.abort();
    attempt.loginUrl = null;
    attempt.fail(error('START_CANCELLED', 'DSH 后端启动已取消。'));
    const pending = starting;
    const work = cleanup(attempt).then(async () => {
      if (pending) await pending.catch(() => {});
      if (active === attempt) active = null;
    }).finally(() => { if (stopping === work) stopping = null; });
    stopping = work;
    return work;
  }
  function restart() {
    if (restarting) return restarting;
    const work = stop().then(() => start()).finally(() => { if (restarting === work) restarting = null; });
    restarting = work;
    return work;
  }
  function status() {
    const child = active?.child;
    return { running: !!child && child.exitCode === null && !child.signalCode, ready,
      port: dshConfig().port || 3080, url: dshUrl(), lastStdout: lastStdout.slice(-500), lastStderr: lastStderr.slice(-500) };
  }
  //#endregion

  return { start, stop, restart, isPortInUse, isServerReady, waitForServer, detectFacts, resolveLaunch, status, dshUrl };
}

module.exports = { resolveLaunch, createDshServer };
