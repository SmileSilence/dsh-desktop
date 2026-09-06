'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');
const { execFile } = require('child_process');

/**
 * 本地 DSH 更新（G1 / P3.4 / architecture §16）。
 * 探测当前实际使用的 dsh 来源与版本 → 按来源对比（源码仓库比 Git 上游，其余比 npm）→ 手动触发更新（双重确认）。
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
 *   execFileP?:Function,
 *   fs?:object,
 *   logger?:{log?:Function, logError?:Function},
 *   now?:()=>number,
 *   throttleMs?:number
 * }} deps
 */
function createDshUpdate(deps) {
  const {
    getLaunch, getDshConfig,
    execFileP = defaultExecFileP, fs: fsMod = fs,
    logger = {}, now = () => Date.now(), throttleMs = 60 * 1000
  } = deps;

  let lastCheckedAt = 0;

  /**
   * 读取当前版本（按来源，§16.2）：
   * - local-repo：读本地 package.json 版本（与启动的实际源码一致）；
   * - global-cli：执行全局 `dsh --version`（即实际启动的全局二进制）；
   * - npm-global：读 npm 全局包目录的 package.json（避免 `dsh` 指向别的程序）；
   * - npx：`npx --no-install` 只读已缓存版本，失败标记 unknown。
   */
  async function detectCurrent() {
    const launch = getLaunch();
    const kind = sourceKind(launch);
    if (kind === 'local-repo') {
      return { source: launch.source, kind, currentVersion: localRepoVersion(launch.cwd, fsMod) };
    }
    if (kind === 'global-cli') {
      try {
        const out = await execFileP('dsh', ['--version'], { timeoutMs: 15000 });
        return { source: launch.source, kind, currentVersion: parseVersion(out) };
      } catch (e) {
        return { source: launch.source, kind, currentVersion: null };
      }
    }
    if (kind === 'npm-global') {
      try {
        const root = (await execFileP('npm', ['root', '-g'], { timeoutMs: 15000 })).trim();
        const pkgPath = path.join(root, '@deepseek-ai', 'dsh', 'package.json');
        const pkg = JSON.parse(fsMod.readFileSync(pkgPath, 'utf-8'));
        return { source: launch.source, kind, currentVersion: typeof pkg.version === 'string' ? pkg.version : null };
      } catch (e) {
        return { source: launch.source, kind, currentVersion: null };
      }
    }
    // npx：--no-install 只读已缓存版本；失败标记 unknown
    try {
      const out = await execFileP('npx', ['--no-install', '@deepseek-ai/dsh', '--version'], { timeoutMs: 15000 });
      return { source: launch.source, kind, currentVersion: parseVersion(out) };
    } catch (e) {
      return { source: launch.source, kind, currentVersion: null };
    }
  }

  /**
   * 按来源取「最新」：
   * - local-repo：与 Git 上游分支比较，返回落后提交数是否 > 0（比 npm 版本更能反映源码仓库）。
   * - 其余：npm registry 最新版。
   */
  async function latestFor(kind, cwd) {
    if (kind === 'local-repo' && cwd) {
      return latestFromGit(cwd);
    }
    return { latestVersion: await latestFromNpm() };
  }

  /** npm registry 最新版本 */
  async function latestFromNpm() {
    try {
      const out = await execFileP('npm', ['view', '@deepseek-ai/dsh', 'version'], { timeoutMs: 30000 });
      return out.trim() || null;
    } catch (e) {
      return null;
    }
  }

  /**
   * 检查本地源码仓库的 Git 上游更新（fetch 只更新远程跟踪分支，不触碰工作区）。
   * @returns {Promise<{latestVersion:string|null, behind:number, hasGitUpdate:boolean}>}
   */
  async function latestFromGit(cwd) {
    const self = { latestVersion: null, behind: 0, hasGitUpdate: false };
    try {
      // 先取得当前分支的上游（默认 origin/main）
      let upstream = 'origin/main';
      try {
        const revParse = await execFileP('git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], { cwd, timeoutMs: 15000 });
        upstream = revParse.trim() || upstream;
      } catch { /* 无上游分支时用默认 */ }
      await execFileP('git', ['fetch', upstream.split('/')[0]], { cwd, timeoutMs: 60000 }).catch(() => {});
      const head = (await execFileP('git', ['rev-parse', 'HEAD'], { cwd, timeoutMs: 15000 })).trim();
      let behind = 0;
      try {
        const out = await execFileP('git', ['rev-list', '--count', `HEAD..${upstream}`], { cwd, timeoutMs: 15000 });
        behind = parseInt(out.trim() || '0', 10);
      } catch { /* 上游不可达按 0 处理 */ }
      self.latestVersion = `${upstream}@${head.slice(0, 7)}`;
      self.behind = Number.isFinite(behind) ? behind : 0;
      self.hasGitUpdate = self.behind > 0;
      return self;
    } catch (e) {
      logger.log?.(`Git 上游检查失败（${kindSafe(cwd)}）: ${e.message}`);
      return self;
    }
  }

  /**
   * 检查更新（幂等，60s 节流）。
   * @returns {Promise<{source:string, kind:string, currentVersion:string|null, latestVersion:string|null, hasUpdate:boolean, behind?:number, throttled?:boolean}>}
   */
  async function checkUpdate(force = false) {
    if (!force && now() - lastCheckedAt < throttleMs) {
      const cur = await detectCurrent();
      return { ...cur, latestVersion: null, hasUpdate: false, throttled: true };
    }
    const cur = await detectCurrent();
    const launch = getLaunch();
    const latest = await latestFor(cur.kind, cur.kind === 'local-repo' ? launch.cwd : null);
    lastCheckedAt = now();

    let hasUpdate = false;
    if (cur.kind === 'local-repo' && typeof latest.behind === 'number') {
      hasUpdate = latest.behind > 0;
      return { ...cur, latestVersion: latest.latestVersion, behind: latest.behind, hasUpdate };
    }
    if (cur.currentVersion !== null && latest.latestVersion !== null) {
      hasUpdate = compareSimple(cur.currentVersion, latest.latestVersion) < 0;
    } else if (cur.currentVersion === null && latest.latestVersion !== null) {
      hasUpdate = true; // 当前版本未知但存在新版 → 提示人工确认
    }
    return { ...cur, latestVersion: latest.latestVersion, hasUpdate };
  }

  /**
   * 执行更新（需 confirm；§16.3 按来源）。
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

/** 从 `--version` 输出里提取 semver（纯函数）。 */
function parseVersion(out) {
  const m = String(out).match(/(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/);
  return m ? m[1] : null;
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

function kindSafe(cwd) {
  return cwd || 'unknown-cwd';
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

module.exports = { createDshUpdate, sourceKind, localRepoVersion, compareSimple, parseVersion, defaultExecFileP };