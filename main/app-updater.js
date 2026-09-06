'use strict';

/**
 * 桌面端自动覆盖更新（需求：覆盖自动安装）——主进程侧纯逻辑层。
 *
 * 职责边界（关键：Windows 下运行中的 exe 会锁定安装目录，主进程不能 rename 自己的目录）：
 *  - 主进程：检查 → 下载 → SHA-256 校验 → spawn 安装器 /UPDATE → 退出。
 *  - 安装器 /UPDATE：结束主进程 → 备份旧目录到 <install>.backup → 覆盖安装 → 启动新版。
 *  - 安装器 /ROLLBACK：把 <install>.backup 恢复回 <install>，启动旧版。
 *  - 主进程启动后：检测 .backup 存在 → 后端健康则清理备份+安装包；不健康则 spawn 安装器 /ROLLBACK 并退出。
 *
 * 纯函数 + deps 注入，副作用（下载/fs/进程）全部可替换，便于 node --test。
 */

/**
 * 从 Release assets 中选出可安装的 Setup 资产。
 * @param {Array} assets [{name, browser_download_url, digest, size}]
 * @param {string} version 目标版本（如 1.4.0，tag 可能带 v 前缀）
 * @returns {{name,url,digest,size}|null}
 */
function pickInstallerAsset(assets, version) {
  if (!Array.isArray(assets)) return null;
  const v = String(version || '').replace(/^v/, '');
  const plainVersion = v.replace(/[._-]/g, ''); // 1.4.0 → 140，1.4.0 → 也匹配 1-4-0
  const candidates = assets.filter((a) => {
    if (!a || typeof a.browser_download_url !== 'string' || typeof a.name !== 'string') return false;
    if (!/\.exe$/i.test(a.name)) return false;
    if (!/setup/i.test(a.name)) return false;
    let host;
    try { host = new URL(a.browser_download_url).hostname.toLowerCase(); } catch { return false; }
    if (!['github.com', 'gitee.com'].includes(host)) return false;
    const hay = a.name + ' ' + a.browser_download_url;
    // 版本匹配：出现带分隔或去分隔的版本号都算（1.4.0 / 1-4-0 / 140）
    return hay.includes(v) || (plainVersion.length >= 3 && hay.includes(plainVersion));
  });
  if (candidates.length === 0) return null;
  const withDigest = candidates.find((a) => typeof a.digest === 'string' && a.digest.trim());
  const pick = withDigest || candidates[0];
  return {
    name: pick.name,
    url: pick.browser_download_url,
    digest: String(pick.digest || '').trim().replace(/^sha256:/i, '').toLowerCase(),
    size: pick.size || null
  };
}

/**
 * 判断 latest 是否比 current 新。
 */
function isNewer(latest, current, compare) {
  if (!latest || !current || typeof compare !== 'function') return false;
  return compare(latest, current) === 1;
}

/**
 * 备份目录名（固定 <installDir>.backup）。更新是线性流程，一次只会有一个备份。
 */
function backupDirFor(installDir) {
  return `${installDir}.backup`;
}

/**
 * 创建桌面端自动覆盖更新器（主进程侧）。
 * @param {{
 *   getCurrentVersion:()=>string,
 *   getInstallDir:()=>string,
 *   fetch?:Function,                     // 返回 {version, url, assets, error, errorCode}
 *   downloadFile?:Function,              // (url, dest) => Promise<void>
 *   sha256File?:Function,                // (filePath) => Promise<string> 小写 hex
 *   compare?:Function,
 *   logger?:{log?:Function, logError?:Function},
 *   path?:object
 * }} deps
 */
function createAppUpdater(deps) {
  const {
    getCurrentVersion, getInstallDir,
    fetch, downloadFile, sha256File,
    compare, logger = {}, path: pathMod
  } = deps;

  /** 检查更新：返回是否有新版及可安装资产。 */
  async function check() {
    const info = await fetch();
    const current = getCurrentVersion();
    const asset = pickInstallerAsset(info.assets, info.version);
    const hasUpdate = !!info.version && isNewer(info.version, current, compare);
    return {
      hasUpdate, current, latest: info.version, url: info.url,
      asset, hasAsset: !!asset, error: info.error, errorCode: info.errorCode
    };
  }

  /**
   * 下载并校验安装包。
   * @returns {Promise<{ok:boolean, file:string, sha256:string}>}
   */
  async function downloadAndVerify(asset, destDir) {
    if (!asset || !asset.url) throw Object.assign(new Error('安装包下载地址缺失'), { code: 'NO_ASSET_URL' });
    const file = pathMod.join(destDir, 'setup.exe');
    await downloadFile(asset.url, file);
    const sha = await sha256File(file);
    if (!sha) throw Object.assign(new Error('安装包 SHA-256 计算失败'), { code: 'SHA_FAILED' });
    if (asset.digest && sha.toLowerCase() !== asset.digest.toLowerCase()) {
      throw Object.assign(new Error(`安装包校验失败：SHA-256 不匹配（期望 ${asset.digest}，实际 ${sha}）`), { code: 'SHA_MISMATCH' });
    }
    logger.log?.(`安装包校验通过（SHA-256: ${sha}）`);
    return { ok: true, file, sha256: sha };
  }

  return { check, downloadAndVerify, pickAsset: pickInstallerAsset, backupDirFor };
}

module.exports = { createAppUpdater, pickInstallerAsset, isNewer, backupDirFor };