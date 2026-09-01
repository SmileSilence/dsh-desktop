'use strict';

const http = require('http');
const crypto = require('crypto');

/**
 * IPC 桥 server（F2 / D3 / §15.1）。
 * loopback 随机端口 + Bearer token + Origin 校验 + CORS；仅 GET/POST/OPTIONS/PATCH。
 */

const MAX_BODY_SIZE = 64 * 1024; // 64KB

/**
 * 校验请求来源（D3）：存在 Origin 时必须为 DSH 页面 origin（防跨站调用）；
 * 缺失时放行（curl/CLI 场景，认证由 Bearer token 承担，roadmap §5 curl 验证不含 Origin）。
 * @param {string|null} origin
 * @param {string[]} allowedOrigins e.g. ['http://127.0.0.1:3080','http://localhost:3080']
 */
function isAllowedOrigin(origin, allowedOrigins) {
  if (!origin) return false;
  return allowedOrigins.includes(origin);
}

/**
 * 创建桥 server。
 * @param {{
 *   getDshPort:()=>number,
 *   getToken:()=>string,
 *   routes:(req:{method:string,pathname:string,body:any})=>{status:number,json:object},
 *   logger?:{log?:Function,logError?:Function}
 * }} deps
 * @returns {{ start:()=>Promise<{port:number}>, stop:()=>Promise<void>, getPort:()=>number|null }}
 */
function createBridgeServer(deps) {
  const { getDshPort, getToken, routes, logger = {} } = deps;
  let server = null;
  let currentPort = null;

  function allowedOrigins() {
    const port = getDshPort() || 3080;
    return [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
  }

  function handle(req, res) {
    // CORS 预检
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': req.headers.origin || '',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS'
      });
      res.end();
      return;
    }

    // 方法白名单
    if (!['GET', 'POST', 'PATCH'].includes(req.method)) {
      sendJson(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED', message: `方法 ${req.method} 不允许` });
      return;
    }

    // Origin 校验（D3）：缺失时放行（curl/CLI 场景，凭 token 认证）；存在但非 DSH 页面 → 403
    const origin = req.headers.origin || null;
    if (origin !== null && !isAllowedOrigin(origin, allowedOrigins())) {
      sendJson(res, 403, { ok: false, code: 'BAD_ORIGIN', message: '来源不被允许' });
      return;
    }

    // Bearer token（D3）
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (token.length === 0 || token !== getToken()) {
      sendJson(res, 401, { ok: false, code: 'UNAUTHORIZED', message: '缺少或无效的 Bearer token' });
      return;
    }

    // 解析 body（限制 64KB）
    let bodyRaw = '';
    req.on('data', (chunk) => {
      bodyRaw += chunk;
      if (bodyRaw.length > MAX_BODY_SIZE) {
        bodyRaw = null;
        req.destroy();
      }
    });
    req.on('end', () => {
      if (bodyRaw === null) {
        sendJson(res, 413, { ok: false, code: 'BODY_TOO_LARGE', message: '请求体超过 64KB' });
        return;
      }
      let body = {};
      if (bodyRaw.trim().length > 0) {
        try {
          body = JSON.parse(bodyRaw);
        } catch (e) {
          sendJson(res, 400, { ok: false, code: 'INVALID_JSON', message: '请求体不是合法 JSON' });
          return;
        }
      }
      const url = new URL(req.url, 'http://127.0.0.1');
      routes({ method: req.method, pathname: url.pathname, body }).then((result) => {
        sendJson(res, result.status, result.json);
      }).catch((e) => {
        logger.logError?.(`路由处理异常: ${e.message}`);
        sendJson(res, 500, { ok: false, code: 'INTERNAL', message: e.message });
      });
    });
  }

  function sendJson(res, status, json) {
    const origin = res.req.headers.origin || '';
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Headers': 'Authorization, Content-Type'
    });
    res.end(JSON.stringify(json));
  }

  function start() {
    return new Promise((resolve, reject) => {
      server = http.createServer(handle);
      server.on('error', (e) => {
        logger.logError?.(`桥 server 错误: ${e.message}`);
        reject(e);
      });
      // 监听 127.0.0.1:0（随机端口，仅回环）
      server.listen(0, '127.0.0.1', () => {
        currentPort = server.address().port;
        logger.log?.(`桥 server 已监听 127.0.0.1:${currentPort}`);
        resolve({ port: currentPort });
      });
    });
  }

  function stop() {
    return new Promise((resolve) => {
      if (!server) return resolve();
      server.close(() => {
        server = null;
        currentPort = null;
        resolve();
      });
    });
  }

  return {
    start,
    stop,
    getPort: () => currentPort,
    generateToken: () => crypto.randomBytes(24).toString('hex')
  };
}

module.exports = { createBridgeServer, isAllowedOrigin };
