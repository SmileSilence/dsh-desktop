'use strict';

const { execFile } = require('node:child_process');
const { stripVTControlCharacters } = require('node:util');
const { StringDecoder } = require('node:string_decoder');

//#region 后端输出与凭据
/** 在截断之前隐藏登录凭据及代理密码。 */
function redactOutput(value) {
  return stripVTControlCharacters(String(value))
    .replace(/([?&]token=)[^\s&#"'<>)]*/gi, '$1[REDACTED]')
    .replace(/(https?:\/\/[^\s/:]+:)[^\s/]+@/gi, '$1[REDACTED]@');
}

/** 按完整 UTF-8 行处理；过长行整体丢弃，避免残留的半截凭据进入日志。 */
function createLineReader(onLine, maxLength = 65536) {
  const decoder = new StringDecoder('utf8');
  let pending = '';
  let dropping = false;
  function consume(text, flush = false) {
    for (const part of text.split(/(\n)/)) {
      if (part === '\n') {
        if (!dropping) onLine(pending.replace(/\r$/, ''));
        pending = '';
        dropping = false;
      } else if (!dropping) {
        pending += part;
        if (pending.length > maxLength) { pending = ''; dropping = true; }
      }
    }
    if (flush) {
      if (pending && !dropping) onLine(pending);
      pending = '';
      dropping = false;
    }
  }
  return { write: chunk => consume(decoder.write(chunk)), end: () => consume(decoder.end(), true) };
}

/** 仅识别正式启动行中的本机根路径登录链接，不接受 LAN 地址或其他端口。 */
function parseLaunchUrl(line, port) {
  const clean = stripVTControlCharacters(line);
  const match = /^\s*dsh web:\s+(http:\/\/[^\s]+)(?:\s|$)/.exec(clean);
  if (!match) return null;
  try {
    const url = new URL(match[1]);
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.port !== String(port)
      || url.username || url.password || url.pathname !== '/' || url.hash
      || [...url.searchParams.keys()].length !== 1
      || !/^[A-Za-z0-9_-]+$/.test(url.searchParams.get('token') || '')) return null;
    // 与页面基础地址统一主机名，使认证 Cookie 可以被页面复用。
    url.hostname = '127.0.0.1';
    return url.href;
  } catch { return null; }
}
//#endregion

//#region 浏览器会话认证
/** Electron ClientRequest 支持逐跳放行；fetch(manual) 在部分 Electron 版本直接拒绝跳转。 */
function probeSessionRequest(address, options, getSession, requestImpl) {
  const { signal, timeoutMs = 3000 } = options;
  if (signal?.aborted) return Promise.resolve(false);
  return new Promise(resolve => {
    let request;
    let settled = false;
    let redirects = 0;
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      request?.abort();
      resolve(result);
    };
    const abort = () => finish(false);
    const timer = setTimeout(abort, timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    try {
      const origin = new URL(address).origin;
      request = requestImpl({ url: address, session: getSession(), credentials: 'include', redirect: 'manual' });
      request.on('error', abort);
      request.on('redirect', (_status, _method, destination) => {
        try {
          const next = new URL(destination, address);
          if (++redirects > 3 || next.origin !== origin || next.username || next.password) return finish(false);
          request.followRedirect();
        } catch { finish(false); }
      });
      request.on('response', response => {
        response.on('error', abort);
        response.on('end', () => finish(response.statusCode >= 200 && response.statusCode < 300));
        response.resume();
      });
      request.end();
    } catch { finish(false); }
  });
}

/**
 * 探测地址是否由 DSH Web 服务应答（无需浏览器会话认证）。
 * 未认证的 DSH Web 返回 401 + 特征文本；已认证返回 2xx；登录流 303 也视为 DSH 服务。
 * 用于区分"端口上有 DSH 服务（即使未认证）"与"端口无服务/被其他程序占用"。
 */
function probeDshService(address, { requestImpl, signal, timeoutMs = 3000 } = {}) {
  if (signal?.aborted) return Promise.resolve(false);
  return new Promise(resolve => {
    let request;
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      request?.abort();
      resolve(result);
    };
    const abort = () => finish(false);
    const timer = setTimeout(abort, timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    const inspect = response => {
      let body = '';
      try { response.setEncoding('utf8'); } catch { /* 忽略：body 以文本读取 */ }
      response.on('data', chunk => { body = (body + chunk).slice(0, 256); });
      response.on('error', abort);
      response.on('end', () => {
        const status = typeof response.statusCode === 'number' ? response.statusCode : 0;
        finish((status >= 200 && status < 300)
          || (status === 401 && body.includes('dsh web authentication required')));
      });
      response.resume();
    };
    try {
      if (requestImpl) {
        request = requestImpl({ url: address, credentials: 'omit', redirect: 'manual' });
        request.on('error', abort);
        request.on('redirect', (_status, _method, destination) => {
          try {
            if (new URL(destination, address).origin === new URL(address).origin) finish(true);
          } catch { finish(false); }
        });
        request.on('response', inspect);
        request.end();
      } else {
        fetch(address, { redirect: 'manual', signal }).then(response => {
          response.text().then(text => {
            const status = response.status;
            finish((status >= 200 && status < 300)
              || (status === 401 && text.includes('dsh web authentication required')));
          }).catch(abort);
        }).catch(abort);
      }
    } catch { finish(false); }
  });
}

/** 使用页面会话；Electron 传入 net.request，非 Electron 检查可使用标准 fetch。 */
function createSessionProbe(getSession, requestImpl) {
  return async (address, { signal, timeoutMs = 3000 } = {}) => {
    if (requestImpl) return probeSessionRequest(address, { signal, timeoutMs }, getSession, requestImpl);
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) return false;
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, timeoutMs);
    try {
      const origin = new URL(address).origin;
      let next = address;
      for (let redirects = 0; redirects <= 3; redirects++) {
        const response = await getSession().fetch(next, {
          credentials: 'include', redirect: 'manual', cache: 'no-store', signal: controller.signal
        });
        const location = response.headers.get('location');
        if (response.body) await response.body.cancel();
        if (response.status >= 200 && response.status < 300) return true;
        if (![301, 302, 303, 307, 308].includes(response.status) || !location) return false;
        const target = new URL(location, next);
        if (target.origin !== origin || target.username || target.password) return false;
        next = target.href;
      }
      return false;
    } catch {
      // 网络错误、超时和取消统一交由启动管理器决定重试或结束。
      return false;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  };
}
//#endregion

//#region 进程清理
/** 只终止调用方持有的子进程；Windows 同时结束该 PID 的整个进程树。 */
function terminateProcessTree(child, { platform = process.platform, execFileImpl = execFile } = {}) {
  if (!child?.pid || child.exitCode !== null || child.signalCode) return Promise.resolve();
  if (platform === 'win32') {
    return new Promise((resolve, reject) => {
      execFileImpl('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'],
        { windowsHide: true, timeout: 5000 }, error => {
          if (!error || child.exitCode !== null || child.signalCode) resolve();
          else reject(new Error('无法结束 DSH 后端进程树，请检查进程权限后重试。'));
        });
    });
  }
  return new Promise((resolve, reject) => {
    const finish = () => { clearTimeout(timer); resolve(); };
    child.once('exit', finish);
    const timer = setTimeout(() => {
      child.removeListener('exit', finish);
      reject(new Error('DSH 后端停止超时。'));
    }, 5000);
    try { child.kill('SIGTERM'); } catch (error) { clearTimeout(timer); reject(error); }
  });
}
//#endregion

module.exports = { redactOutput, createLineReader, parseLaunchUrl, createSessionProbe, probeDshService, terminateProcessTree };
