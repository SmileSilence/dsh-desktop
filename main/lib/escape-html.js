'use strict';

/**
 * HTML 转义（D2 · 回显转义）。
 * 任何把本地路径/状态字符串写入页面 DOM 的地方（诊断、状态、路径）一律使用本函数，
 * 禁止裸拼 innerHTML。
 *
 * @param {*} s 待转义的值（null/undefined 视为空串）
 * @returns {string} 转义后的 HTML 安全字符串
 */
function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default: return c;
    }
  });
}

module.exports = { escapeHtml };
