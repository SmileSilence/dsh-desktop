'use strict';

const path = require('path');
const os = require('os');

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
 * DSH 服务管理工厂。
 * @param {{
 *   projectRoot:string,
 *   getDshConfig:()=>object,
 *   logger?:{log?:Function,logError?:Function},
 *   spawn?:Function, execSync?:Function, net?:object, http?:object, fs?:object, os?:object
 * }} deps
 */
function createDshServer(deps) {
  const { projectRoot, getDshConfig, logger = {} } = deps;
  const spawn = deps.spawn || require('child_process').spawn;
  const execSync = deps.execSync || require('child_process').execSync;
  const net = deps.net || require('net');
  const http = deps.http || require('http');
  const fs = deps.fs || require('fs');
  const osMod = deps.os || os;

  let proc = null;
  let ready = false;
  let lastStdout = '';
  let lastStderr = '';

  function dshConfig() { return getDshConfig().dsh || {}; }
  function dshUrl() {
    const port = dshConfig().port || 3080;
    return `http://127.0.0.1:${port}`;
  }

  /** 通过 TCP 端口检测 DSH Web 服务是否已在运行 */
  function isPortInUse(port) {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(2000);
      socket.on('connect', () => { socket.destroy(); resolve(true); });
      socket.on('timeout', () => { socket.destroy(); resolve(false); });
      socket.on('error', () => { resolve(false); });
      socket.connect(port, '127.0.0.1');
    });
  }

  /** HTTP 健康检查（端口通了之后再确认 HTTP 响应） */
  function isServerReady() {
    return new Promise((resolve) => {
      const req = http.get(dshUrl(), { timeout: 3000 }, (res) => {
        res.resume();
        resolve(res.statusCode < 500);
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
    });
  }

  /** 轮询等待 DSH Web 服务就绪 */
  function waitForServer(timeoutMs = 90000, intervalMs = 2000) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const check = async () => {
        if (await isServerReady()) {
          ready = true;
          return resolve();
        }
        if (Date.now() - start > timeoutMs) {
          return reject(new Error('DSH Web 服务启动超时（90秒）'));
        }
        setTimeout(check, intervalMs);
      };
      check();
    });
  }

  /** 检测系统是否安装了 Node.js（PATH 中是否有 node） */
  function isSystemNodeAvailable() {
    try {
      const out = execSync('where node', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
      return typeof out === 'string' && out.trim().length > 0;
    } catch (e) {
      return false;
    }
  }

  /**
   * 探测事实（纯 resolveLaunch 的输入）。candidates 顺序与原版一致。
   * @returns {{ repoPaths:string[], hasGlobalCli:boolean, npmGlobalPath:string|null, hasSystemNode:boolean }}
   */
  function detectFacts() {
    const candidates = [
      process.env.DSH_REPO_ROOT,
      path.join(projectRoot, '..', 'deepseek-harness'),
      path.join(projectRoot, 'deepseek-harness'),
      path.join(osMod.homedir(), 'deepseek-harness'),
      path.join(osMod.homedir(), 'Desktop', 'deepseek-harness'),
      path.join(osMod.homedir(), 'Documents', 'deepseek-harness')
    ].filter(Boolean);

    const repoPaths = candidates.filter((p) => fs.existsSync(path.join(p, 'package.json')));

    let hasGlobalCli = false;
    try {
      execSync('dsh --version', { stdio: 'ignore' });
      hasGlobalCli = true;
    } catch (e) { /* 未全局安装 */ }

    let npmGlobalPath = null;
    try {
      const npmGlobalRoot = execSync('npm root -g', { encoding: 'utf-8' }).trim();
      const dshGlobalPath = path.join(npmGlobalRoot, '@deepseek-ai', 'dsh');
      if (fs.existsSync(dshGlobalPath)) npmGlobalPath = dshGlobalPath;
    } catch (e) { /* npm 全局路径获取失败 */ }

    return {
      repoPaths,
      hasGlobalCli,
      npmGlobalPath,
      hasSystemNode: isSystemNodeAvailable()
    };
  }

  /**
   * 启动 DSH Web 服务（无终端窗口）。
   * 返回 { source, cmd, args, cwd }；桌面专用后端禁止复用任何已有端口。
   */
  async function start() {
    const port = dshConfig().port || 3080;

    if (await isPortInUse(port)) {
      if (dshConfig().dedicated === true) {
        throw new Error(`桌面专用端口 ${port} 已被占用，拒绝复用其他 DSH 实例`);
      }
      logger.log?.(`端口 ${port} 已被占用，检查服务是否正常...`);
      if (await isServerReady()) {
        logger.log?.('DSH Web 服务已在运行');
        ready = true;
        return { reused: true, port };
      }
      logger.log?.('端口被占用但服务响应异常，尝试启动新服务...');
    }

    logger.log?.('正在启动 DSH Web 服务...');
    const facts = detectFacts();
    const launch = resolveLaunch(dshConfig(), facts);
    logger.log?.(`启动命令: ${launch.cmd} ${launch.args.join(' ')}`);

    // 打包分发场景：依赖系统 Node 但系统无 Node → 提前明确报错
    if (['npx', 'pnpm', 'dsh'].includes(launch.cmd) && !facts.hasSystemNode) {
      throw new Error(
        '未检测到 Node.js 环境。\n\n' +
        '当前电脑没有可用的 Node.js，无法自动拉起 DSH 后端服务。\n\n' +
        '解决方法（任选其一）：\n' +
        '1. 安装 Node.js（>= 22）：https://nodejs.org\n' +
        '2. 在已安装 DeepSeek Harness（dsh）环境的电脑上运行本程序\n' +
        '3. 确保 127.0.0.1:3080 已有 DSH Web 服务在运行'
      );
    }

    let stdoutBuf = '';
    let stderrBuf = '';

    const options = {
      cwd: launch.cwd,
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env, ...(dshConfig().env || {}) },
      shell: true
    };

    try {
      proc = spawn(launch.cmd, launch.args, options);

      if (proc.stdout) {
        proc.stdout.on('data', (data) => {
          const text = data.toString();
          stdoutBuf += text;
          if (stdoutBuf.length > 2048) stdoutBuf = stdoutBuf.slice(-2048);
        });
      }
      if (proc.stderr) {
        proc.stderr.on('data', (data) => {
          const text = data.toString();
          stderrBuf += text;
          if (stderrBuf.length > 2048) stderrBuf = stderrBuf.slice(-2048);
          logger.log?.(`[stderr] ${text.trim()}`);
        });
      }

      proc.on('error', (err) => {
        logger.logError?.(`启动失败: ${err.message}`);
        proc = null;
      });

      proc.on('exit', (code, signal) => {
        logger.log?.(`服务已退出 (code=${code}, signal=${signal})`);
        if (stdoutBuf.trim()) logger.log?.(`[stdout] ${stdoutBuf.trim().slice(-500)}`);
        if (stderrBuf.trim()) logger.log?.(`[stderr] ${stderrBuf.trim().slice(-500)}`);
        lastStdout = stdoutBuf;
        lastStderr = stderrBuf;
        proc = null;
        ready = false;
      });

      logger.log?.(`服务进程已启动 (PID: ${proc.pid})`);
      await waitForServer();
      logger.log?.('DSH Web 服务已就绪 ✓');
      return { reused: false, source: launch.source, port };
    } catch (err) {
      logger.logError?.(`启动异常: ${err.message}`);
      throw err;
    }
  }

  /** 停止 DSH Web 服务 */
  function stop() {
    const stopping = proc;
    if (stopping) {
      logger.log?.('正在停止 DSH Web 服务...');
      try { stopping.kill(); } catch (e) { /* ignore */ }
      proc = null;
    }
    ready = false;
    if (!stopping || stopping.exitCode !== null) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, 5000);
      stopping.once('exit', () => { clearTimeout(timer); resolve(); });
    });
  }

  /** 重启后端（B4 / G1 更新成功后自动重启） */
  async function restart() {
    await stop();
    return start();
  }

  /** 运行状态（诊断/桥使用） */
  function status() {
    return {
      running: proc !== null,
      ready,
      port: dshConfig().port || 3080,
      url: dshUrl(),
      lastStdout: lastStdout.slice(-500),
      lastStderr: lastStderr.slice(-500)
    };
  }

  return {
    start,
    stop,
    restart,
    isPortInUse,
    isServerReady,
    waitForServer,
    detectFacts,
    resolveLaunch,
    status,
    dshUrl
  };
}

module.exports = { resolveLaunch, createDshServer };
