'use strict';

const os = require('os');

/**
 * 诊断导出（B5 / P3.3 / §4.5）。
 * 内容：appVersion、platform/arch、electron/chrome/node 版本、日志文件路径与尾部、
 * 后端 running/port、脱敏配置、崩溃证据摘要。文本可复制。
 */

/**
 * 生成诊断文本（纯函数 + deps 注入日志/状态）。
 * @param {{
 *   appVersion:string,
 *   platform:string, arch:string,
 *   electronVersion:string, chromeVersion:string, nodeVersion:string,
 *   logDir:string, logTail:(lines?:number)=>string,
 *   backend:{running:boolean, port:number},
 *   config:object,
 *   crashEvidence?:string,
 *   timestamp?:string
 * }} deps
 * @returns {string}
 */
function buildDiagnostics(deps) {
  const {
    appVersion, platform, arch, electronVersion, chromeVersion, nodeVersion,
    logDir, logTail, backend, config, crashEvidence, timestamp = new Date().toISOString()
  } = deps;

  const lines = [
    'DSH Desktop 诊断导出',
    `生成时间: ${timestamp}`,
    '',
    `App 版本: ${appVersion}`,
    `平台: ${platform} / ${arch}`,
    `Electron: ${electronVersion}`,
    `Node: ${nodeVersion}`,
    `Chrome: ${chromeVersion}`,
    '',
    `日志目录: ${logDir}`,
    `后端状态: ${backend.running ? 'running' : 'stopped'} (port ${backend.port})`,
    ''
  ];

  // 脱敏配置（剔除 bridge.token 与凭据）
  lines.push('配置（脱敏）:');
  lines.push(maskDiagnosticConfig(config));
  lines.push('');

  if (crashEvidence) {
    lines.push('崩溃证据:');
    lines.push(crashEvidence);
    lines.push('');
  }

  lines.push('日志尾部:');
  lines.push(logTail(50));
  return lines.join('\n');
}

/** 递归脱敏配置：剔除 bridge 段与 dsh.env 值（与桥 GET /api/settings 一致） */
function maskDiagnosticConfig(config) {
  if (!config || typeof config !== 'object') return String(config);
  const clone = JSON.parse(JSON.stringify(config));
  delete clone.bridge;
  if (clone.dsh && typeof clone.dsh === 'object') {
    if (clone.dsh.env && typeof clone.dsh.env === 'object') {
      clone.dsh.env = Object.fromEntries(Object.keys(clone.dsh.env).map((k) => [k, '***']));
    }
    if (typeof clone.dsh.proxy === 'string' && clone.dsh.proxy.length > 0) {
      clone.dsh.proxy = clone.dsh.proxy.replace(/:\/\/([^:/@]+):(.+)@/, '://$1:***@');
    }
  }
  return JSON.stringify(clone, null, 2);
}

module.exports = { buildDiagnostics, maskDiagnosticConfig };
