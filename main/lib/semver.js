'use strict';

/**
 * 极简 semver 比较（X4 · P0.4 提前实现，零依赖）。
 * 仅比较主/次/修订三段数字；预发布/构建元数据不参与排序。
 * 版本异常（不可解析）时返回 null，由调用方标记 unknown 提示人工确认，而非硬判。
 *
 * @param {string} a 版本字符串，如 "0.1.1-rc.2" / "v1.2.3"
 * @param {string} b 版本字符串
 * @returns {number|null} -1 | 0 | 1，任一不可解析返回 null
 */
function parseVersion(v) {
  if (typeof v !== 'string') return null;
  const m = v.trim().match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function compareSemver(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

module.exports = { compareSemver, parseVersion };
