'use strict';

/**
 * semver 比较（零依赖）。
 * 比较主/次/修订三段数字 + 预发布段（semver 2.0.0 优先级规则）：
 * - 无 prerelease > 有 prerelease（1.2.3 > 1.2.3-alpha.1）；
 * - prerelease 逐段比较：数字段按数值，字母段按 ASCII，数字段 < 字母段；
 * - 段数少者小（1.2.3-alpha < 1.2.3-alpha.1）。
 * 版本异常（不可解析）时返回 null，由调用方标记 unknown 提示人工确认，而非硬判。
 *
 * @param {string} a 版本字符串，如 "0.1.6-alpha.1" / "v1.2.3" / "dsh-v0.1.6-rc.2"
 * @param {string} b 版本字符串
 * @returns {number|null} -1 | 0 | 1，任一不可解析返回 null
 */

// 允许 tag 前缀（如 dsh-v0.1.6-alpha.1 / v1.2.3）
const VERSION_RE = /^(?:dsh-)?v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/;

function parseVersion(v) {
  if (typeof v !== 'string') return null;
  const m = v.trim().match(VERSION_RE);
  if (!m) return null;
  const core = [Number(m[1]), Number(m[2]), Number(m[3])];
  const pre = m[4] ? m[4].split('.') : null;
  return { core, pre };
}

/** 剥离 tag 前缀（dsh-v / v），返回纯版本号；无前缀原样返回。 */
function stripVersionPrefix(tag) {
  const s = String(tag || '').trim();
  const m = s.match(/^(?:dsh-)?v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/);
  return m ? m[1] : s;
}

function comparePrerelease(pa, pb) {
  if (!pa && !pb) return 0;
  if (!pa) return 1;  // 无 prerelease 优先
  if (!pb) return -1;
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const xa = pa[i];
    const xb = pb[i];
    if (xa === undefined) return -1; // 段数少者小
    if (xb === undefined) return 1;
    const na = /^\d+$/.test(xa);
    const nb = /^\d+$/.test(xb);
    if (na && nb) {
      const d = Number(xa) - Number(xb);
      if (d !== 0) return d < 0 ? -1 : 1;
    } else if (na !== nb) {
      return na ? -1 : 1; // 数字段 < 字母段
    } else if (xa !== xb) {
      return xa < xb ? -1 : 1;
    }
  }
  return 0;
}

function compareSemver(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i++) {
    if (pa.core[i] !== pb.core[i]) return pa.core[i] < pb.core[i] ? -1 : 1;
  }
  return comparePrerelease(pa.pre, pb.pre);
}

module.exports = { compareSemver, parseVersion, stripVersionPrefix };
