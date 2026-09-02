'use strict';

const https = require('https');

/**
 * 应用更新检查（B6 / P3.2）。
 * GitHub Releases API + compareSemver；lastChecked 节流；repo 从 package.json#repository 读取（X9）。
 */

const THROTTLE_MS = 60 * 60 * 1000; // 1h

/**
 * 从 GitHub Releases API 取最新稳定版。
 * @param {{ owner:string, repo:string, mirror?:string }} target 仓库；mirror 为 Gitee 镜像时用其 API
 * @param {{ https?:object, timeoutMs?:number }} opts
 * @returns {Promise<{version:string|null, url:string|null, error?:string, errorCode?:string}>}
 */
function fetchLatestRelease(target, opts = {}) {
  const httpMod = opts.https || https;
  const api = target.mirror
    ? `https://${target.mirror}/api/v5/repos/${target.owner}/${target.repo}/releases/latest`
    : `https://api.github.com/repos/${target.owner}/${target.repo}/releases/latest`;

  return new Promise((resolve) => {
    const req = httpMod.get(api, {
      timeout: opts.timeoutMs || 10000,
      headers: {
        'User-Agent': 'dsh-desktop-updater',
        Accept: 'application/vnd.github+json'
      }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          const errorCode = res.statusCode === 403 || res.statusCode === 429
            ? 'RATE_LIMITED'
            : res.statusCode === 404 ? 'NO_RELEASE' : 'HTTP_ERROR';
          resolve({ version: null, url: null, error: `HTTP ${res.statusCode}`, errorCode });
          return;
        }
        try {
          const json = JSON.parse(data);
          resolve({ version: json.tag_name || null, url: json.html_url || null });
        } catch (e) {
          resolve({ version: null, url: null, error: '响应解析失败', errorCode: 'INVALID_RESPONSE' });
        }
      });
    });
    req.on('error', (e) => resolve({ version: null, url: null, error: e.message, errorCode: 'NETWORK_ERROR' }));
    req.on('timeout', () => { req.destroy(); resolve({ version: null, url: null, error: '请求超时', errorCode: 'TIMEOUT' }); });
  });
}

/**
 * 更新检查（含节流）。
 * @param {{
 *   getCurrentVersion:()=>string,
 *   getRepository:()=>{owner:string, repo:string, mirror?:string},
 *   getLastChecked:()=>number|null,
 *   setLastChecked:(ts:number)=>void,
 *   compare?:Function,
 *   fetch?:Function,
 *   force?:boolean,
 *   logger?:{log?:Function}
 * }} deps
 * @returns {Promise<{hasUpdate:boolean, current:string, latest:string|null, url:string|null, throttled?:boolean, note?:string}>}
 */
async function checkForUpdate(deps) {
  const {
    getCurrentVersion, getRepository, getLastChecked, setLastChecked,
    compare = null, fetch = fetchLatestRelease, force = false, logger = {}
  } = deps;

  const last = getLastChecked();
  if (!force && last !== null && Date.now() - last < THROTTLE_MS) {
    logger.log?.('更新检查被节流（距上次检查不足 1 小时）');
    return {
      hasUpdate: false, current: getCurrentVersion(), latest: null, url: null,
      throttled: true, note: '节流：距上次检查不足 1 小时'
    };
  }

  const repo = getRepository();
  const { version: latest, url, error, errorCode } = await fetch(repo);
  logger.log?.(`更新检查完成: latest=${latest ?? 'unknown'}${error ? ` (${error})` : ''}`);

  if (latest === null) {
    return {
      hasUpdate: false, current: getCurrentVersion(), latest: null, url: null,
      error: error || '未获取到版本', errorCode: errorCode || 'NO_VERSION',
      note: error ? `检查失败: ${error}` : '未获取到版本'
    };
  }

  setLastChecked(Date.now());

  const cmp = compare !== null ? compare : null;
  let hasUpdate = false;
  let comparison = null;
  if (cmp !== null) {
    comparison = cmp(latest, getCurrentVersion());
    hasUpdate = comparison !== null && comparison > 0;
  } else {
    // 无 compare 时按完整 major.minor.patch 数值比较（零依赖兜底）
    const nums = (v) => {
      const m = String(v).match(/(\d+)\.(\d+)\.(\d+)/);
      return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
    };
    const a = nums(latest);
    const b = nums(getCurrentVersion());
    if (a !== null && b !== null) {
      for (let i = 0; i < 3; i++) {
        if (a[i] !== b[i]) { hasUpdate = a[i] > b[i]; break; }
      }
    }
  }

  if (compare !== null && comparison === null) {
    return { hasUpdate: false, current: getCurrentVersion(), latest, url, error: '版本格式无法识别', errorCode: 'INVALID_VERSION' };
  }
  return { hasUpdate, current: getCurrentVersion(), latest, url };
}

module.exports = { checkForUpdate, fetchLatestRelease, THROTTLE_MS };
