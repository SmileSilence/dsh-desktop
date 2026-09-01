'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');
const { execFile } = require('child_process');

/**
 * 本地 DSH 更新（G1 / P3.4 / architecture §16）。
 * 探测当前实际使用的 dsh 来源与版本 → 对比 npm registry / git 远程 → 手动触发更新（双重确认）。
 * 更新成功自动重启后端（由调用方接管）。
 *
 * 纯函数 + deps 注入：探测事实由 createDshUpdate 从 dsh-server 的 resolveLaunch 结论获取。
 */

/**
 * 解析来源类型（纯函数）。
 * @param {{ source:string }} launch resolveLaunch 返回 { source: 'config-path'|'local-repo'|'global-cli'|'npm-global'|'npx' }
 * @returns {'local-repo'|'global-cli'|'npm-global'|'npx'}
 */
function sourceKind(launch) {
  switch (launch.source) {
    case 'config-path':
    case 'local-repo': return 'local-repo';
    case 'global-cli': return 'global-cli';
    case 'npm-global': return 'npm-global';
    default: return 'npx';
  }
}

/**
 * 读取本地仓库 package.json 的 version（纯函数 + fs 注入）。
 * @param {string|null} cwd
 * @param {object} fsMod
 * @returns {string|null}
 */
function localRepoVersion(cwd, fsMod) {
  if (!cwd) return null;
  try {
    const pkg = JSON.parse(fsMod.readFileSync(path.join(cwd, 'package.json'), 'utf-8'));
    return typeof pkg.version === 'string' ? pkg.version : null;
  } catch (e) {
    return null;
  }
}

/**
 * 创建本地 DSH 更新服务。
 * @param {{
 *   getLaunch:()=>{source:string, cmd:string, args:string[], cwd:string|null},
 *   getDshConfig:()=>object,
 *   getNpmViewVersion?:(pkg:string, timeoutMs?:number)=>Promise<string|null>,
 *   execFileP?:Function,
 *   fs?:object,
 *   logger?:{log?:Function, logError?:Function},
 *   now?:()=>number,
 *   throttleMs?:number
 * }} deps
 */
function createDshUpdate(deps) {
  const {
    getLaunch, getDshConfig, getNpmViewVersion,
    execFileP = defaultExecFileP, fs: fsMod = fs,
    logger = {}, now = () => Date.now(), throttleMs = 60 * 1000
  } = deps;

  let lastCheckedAt = 0;

  /**
   * 读取当前版本（按来源，§16.2）。
   * @returns {Promise<{source:string, kind:string, currentVersion:string|null}>}
   */
  async function detectCurrent() {
    const launch = getLaunch();
    const kind = sourceKind(launch);
    let currentVersion = null;
    if (kind === 'local-repo') {
      currentVersion = localRepoVersion(launch.cwd, fsMod);
    } else if (kind === 'global-cli' || kind === 'npm-global') {
      try {
        const out = await execFileP('dsh', ['--version'], { timeoutMs: 15000 });
        const m = /(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/.exec(out);
        currentVersion = m ? m[1] : null;
      } catch (e) {
        currentVersion = null;
      }
    } else {
      // npx：--no-install 只读已缓存版本；失败标记 unknown
      try {
        const out = await execFileP('npx', ['--no-install', '@deepseek-ai/dsh', '--version'], { timeoutMs: 15000 });
        const m = /(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/.exec(out);
        currentVersion = m ? m[1] : null;
      } catch (e) {
        currentVersion = null;
      }
    }
    return { source: launch.source, kind, currentVersion };
  }

  /**
   * 获取 npm registry 最新版本（可注入，测试用）。
   * @returns {Promise<string|null>}
   */
  async function latestFromNpm() {
    if (getNpmViewVersion) return getNpmViewVersion('@deepseek-ai/dsh', 30000);
    try {
      const out = await execFileP('npm', ['view', '@deepseek-ai/dsh', 'version'], { timeoutMs: 30000 });
      return out.trim() || null;
    } catch (e) {
      return null;
    }
  }

  /**
   * 检查更新（幂等，60s 节流）。
   * @returns {Promise<{source:string, currentVersion:string|null, latestVersion:string|null, hasUpdate:boolean, throttled?:boolean}>}
   */
  async function checkUpdate(force = false) {
    if (!force && now() - lastCheckedAt < throttleMs) {
      const cur = await detectCurrent();
      return { ...cur, latestVersion: null, hasUpdate: false, throttled: true };
    }
    const cur = await detectCurrent();
    const latest = await latestFromNpm();
    lastCheckedAt = now();

    let hasUpdate = false;
    if (cur.currentVersion !== null && latest !== null) {
      const cmp = compareSimple(cur.currentVersion, latest);
      hasUpdate = cmp < 0;
    } else if (cur.currentVersion === null && latest !== null) {
      hasUpdate = true; // 当前版本未知但存在新版 → 提示人工确认
    }
    return { ...cur, latestVersion: latest, hasUpdate };
  }

  /**
   * 执行更新（需 confirm；§16.3 按来源）。
   * @param {boolean} confirm
   * @returns {Promise<{ok:boolean, log:string[], restartRequired:boolean}>}
   */
  async function update(confirm) {
    if (confirm !== true) {
      const e = new Error('更新需要 confirm:true（双重确认防线）');
      e.code = 'CONFIRM_REQUIRED';
      throw e;
    }
    const cur = await detectCurrent();
    const log = [`来源: ${cur.source} (${cur.kind})`, `当前版本: ${cur.currentVersion ?? 'unknown'}`];

    switch (cur.kind) {
      case 'npm-global':
      case 'global-cli': {
        log.push('执行: npm install -g @deepseek-ai/dsh@latest');
        try {
          await execFileP('npm', ['install', '-g', '@deepseek-ai/dsh@latest'], { timeoutMs: 300000 });
          log.push('完成: npm 全局安装成功');
        } catch (e) {
          log.push(`失败: ${e.message}`);
          throw new Error(`npm 全局安装失败（可能需要管理员权限）：${e.message}`);
        }
        break;
      }
      case 'local-repo': {
        const cwd = getLaunch().cwd;
        if (!cwd) throw new Error('本地仓库路径未知，无法更新');
        // 工作区干净校验
        try {
          const status = await execFileP('git', ['status', '--porcelain'], { cwd, timeoutMs: 15000 });
          if (status.trim().length > 0) {
            throw new Error('本地仓库工作区有未提交改动，请先提交或清理后再更新');
          }
        } catch (e) {
          if (e.message.includes('未提交改动')) throw e;
          throw new Error(`git 校验失败：${e.message}`);
        }
        log.push('工作区干净，执行 git pull --ff-only + corepack pnpm install');
        try {
          await execFileP('git', ['pull', '--ff-only'], { cwd, timeoutMs: 180000 });
          await execFileP('corepack', ['pnpm', 'install'], { cwd, timeoutMs: 300000 });
          log.push('完成: 本地仓库已更新');
        } catch (e) {
          log.push(`失败: ${e.message}`);
          throw new Error(`本地仓库更新失败：${e.message}`);
        }
        break;
      }
      case 'npx': {
        log.push('npx 来源无需更新（每次运行拉取最新）。如需固定版本请执行: npm install -g @deepseek-ai/dsh');
        return { ok: true, log, restartRequired: false };
      }
      default:
        throw new Error(`未知来源类型: ${cur.kind}`);
    }

    return { ok: true, log, restartRequired: true };
  }

  return { checkUpdate, update, detectCurrent, sourceKind };
}

/** 极简版本比较（与 lib/semver 对齐；仅数值比较三段） */
function compareSimple(a, b) {
  const pa = String(a).match(/(\d+)\.(\d+)\.(\d+)/);
  const pb = String(b).match(/(\d+)\.(\d+)\.(\d+)/);
  if (!pa || !pb) return 0;
  for (let i = 1; i <= 3; i++) {
    const na = Number(pa[i]);
    const nb = Number(pb[i]);
    if (na !== nb) return na < nb ? -1 : 1;
  }
  return 0;
}

/** execFile 的 Promise 封装（argv 数组，不拼 shell 字符串，§16.5） */
function defaultExecFileP(cmd, args, opts = {}) {
  const { timeoutMs = 30000, cwd } = opts;
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd, timeout: timeoutMs, windowsHide: true, encoding: 'utf-8' }, (err, stdout, stderr) => {
      if (err) {
        err.stderr = stderr;
        reject(err);
        return;
      }
      resolve(stdout || '');
    });
  });
}

module.exports = { createDshUpdate, sourceKind, localRepoVersion, compareSimple };
