'use strict';

const path = require('path');
const fs = require('fs');

/**
 * 滚动日志（E5 / P0.2）。
 * 写入 <userData>/logs/，按大小滚动（默认 1MB / 最多 5 份）。
 * 副作用（fs）经 deps 注入；开发态可同时输出控制台。
 */

const DEFAULT_MAX_SIZE = 1024 * 1024; // 1MB
const DEFAULT_MAX_FILES = 5;

/**
 * @param {{ userDataPath: string, fs?: object, maxSize?: number, maxFiles?: number, consoleEnabled?: boolean, console?: object }} deps
 * @returns {{ log: Function, logError: Function, getLogDir: Function, tail: Function }}
 */
function createLogger(deps) {
  const { userDataPath, maxSize = DEFAULT_MAX_SIZE, maxFiles = DEFAULT_MAX_FILES } = deps;
  const f = deps.fs || fs;
  const consoleEnabled = deps.consoleEnabled !== false;
  const output = deps.console || console;
  const logDir = path.join(userDataPath, 'logs');
  const logFile = path.join(logDir, 'dsh-desktop.log');

  function ensureDir() {
    if (!f.existsSync(logDir)) f.mkdirSync(logDir, { recursive: true });
  }

  function rotate() {
    ensureDir();
    // 从最旧开始：.N-1 → .N，然后当前 → .1
    for (let i = maxFiles - 1; i >= 1; i--) {
      const from = `${logFile}.${i}`;
      const to = `${logFile}.${i + 1}`;
      if (f.existsSync(from)) f.renameSync(from, to);
    }
    if (f.existsSync(logFile)) f.renameSync(logFile, `${logFile}.1`);
  }

  function write(level, msg) {
    const line = `[${new Date().toISOString()}] [${level}] ${msg}\n`;
    try {
      ensureDir();
      if (f.existsSync(logFile) && f.statSync(logFile).size >= maxSize) rotate();
      f.appendFileSync(logFile, line, 'utf-8');
    } catch (e) {
      // 日志失败不致命
    }
    // Windows GUI/安装版可能继承一个随后被关闭的 stdout/stderr 管道。
    // 控制台输出只是辅助信息，EPIPE 等写入错误绝不能导致主进程崩溃。
    if (consoleEnabled) {
      try {
        if (level === 'ERROR') output.error(`[DSH Desktop] ${msg}`);
        else output.log(`[DSH Desktop] ${msg}`);
      } catch (e) {
        // 文件日志已完成，忽略不可用的控制台管道。
      }
    }
  }

  function log(msg) { write('INFO', msg); }
  function logError(msg) { write('ERROR', msg); }

  /** 读取日志尾部（诊断导出用，§4.5：尾部 50 行） */
  function tail(lines = 50) {
    try {
      if (!f.existsSync(logFile)) return '';
      const content = f.readFileSync(logFile, 'utf-8');
      const all = content.split(/\r?\n/);
      return all.slice(-lines).join('\n');
    } catch (e) {
      return '';
    }
  }

  return { log, logError, getLogDir: () => logDir, tail };
}

module.exports = { createLogger };
