'use strict';

/**
 * 插件启动故障恢复（需求M6）。
 * - 从后端启动日志识别疑似故障插件（只匹配 bundles 里出现的第三方插件名）；
 * - 归档启动失败完整日志到指定目录（文件名带时间戳）；
 * - 从 ~/.dsh/profiles/<profile>/package.json 的 dsh.profile.bundles 移除插件（保留依赖，不卸载）。
 * 纯函数 + deps 注入，无副作用，便于 node --test 覆盖。
 */

// 内置 bundle：清理「所有第三方插件」时始终保留。
const BUILTIN_BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'];

/**
 * 从日志文本识别疑似故障插件。
 * @param {string|null} logText 后端完整启动日志（已脱敏）
 * @param {string[]} bundles dsh.profile.bundles 列表
 * @returns {string[]} 出现在日志中的第三方插件名（按 bundles 顺序）
 */
function detectSuspectPlugins(logText, bundles) {
  if (!logText || !Array.isArray(bundles)) return [];
  const text = String(logText);
  return bundles.filter((name) => {
    if (typeof name !== 'string' || BUILTIN_BUNDLES.includes(name)) return false;
    if (text.includes(name)) return true;
    const short = name.startsWith('@') ? name.split('/').pop() : '';
    return !!short && short !== name && text.includes(short);
  });
}

/**
 * 归档启动失败日志的文件名（带时间戳）。
 * @param {Date} [now] 可注入的当前时间
 * @returns {string}
 */
function failureLogName(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `startup-failed-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}` +
    `-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}.log`;
}

/**
 * 从 bundles 中移除指定插件（不卸载依赖）。
 * @param {string[]} bundles
 * @param {string[]} names 要移除的插件名
 * @returns {{ bundles: string[], removed: string[] }}
 */
function disableBundles(bundles, names) {
  const remove = new Set(names || []);
  const list = bundles || [];
  return {
    bundles: list.filter((b) => !remove.has(b)),
    removed: list.filter((b) => remove.has(b))
  };
}

/**
 * 移除所有第三方插件，仅保留内置 bundle。
 * @param {string[]} bundles
 * @returns {{ bundles: string[], removed: string[] }}
 */
function disableAllThirdParty(bundles) {
  const list = bundles || [];
  return {
    bundles: list.filter((b) => BUILTIN_BUNDLES.includes(b)),
    removed: list.filter((b) => !BUILTIN_BUNDLES.includes(b))
  };
}

/**
 * 从 DSH profile 包目录读取 bundles。
 * @param {string} packageJsonPath ~/.dsh/profiles/<profile>/package.json 绝对路径
 * @param {object} fs fs 模块
 * @returns {string[]} bundles（读取失败返回 []）
 */
function readBundles(packageJsonPath, fs) {
  try {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    const bundles = pkg?.dsh?.profile?.bundles;
    return Array.isArray(bundles) ? bundles : [];
  } catch (e) {
    return [];
  }
}

/**
 * 写回 bundles（保留文件其余内容不变）。
 * @param {string} packageJsonPath
 * @param {string[]} bundles
 * @param {object} fs
 * @returns {boolean} 成功 true
 */
function writeBundles(packageJsonPath, bundles, fs) {
  try {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    if (!pkg.dsh) pkg.dsh = {};
    if (!pkg.dsh.profile) pkg.dsh.profile = {};
    pkg.dsh.profile.bundles = bundles;
    fs.writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
    return true;
  } catch (e) {
    return false;
  }
}

module.exports = {
  BUILTIN_BUNDLES,
  detectSuspectPlugins,
  failureLogName,
  disableBundles,
  disableAllThirdParty,
  readBundles,
  writeBundles
};