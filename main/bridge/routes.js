'use strict';

/**
 * IPC 桥路由（F2 / D3 / §15.1）。
 * 纯路由分发：不碰 http/electron，services 由 server 层注入，可 node:test。
 * 统一响应：2xx → { ok:true, data? }；4xx/5xx → { ok:false, code, message, detail? }
 */

// PATCH 白名单（§15.1）：window/theme/tray/hotkey/dsh/language；bridge/updater 不可由用户写
const PATCH_WHITELIST = ['window', 'theme', 'tray', 'hotkey', 'dsh', 'language'];

const WINDOW_ACTIONS = new Set(['minimize', 'maximize', 'unmaximize', 'close', 'toggle', 'show']);

/** 从配置对象中剔除敏感字段并脱敏（X2） */
function maskSettings(cfg) {
  const { bridge, dsh, ...rest } = cfg;
  const masked = { ...rest };
  if (dsh) {
    masked.dsh = { ...dsh };
    // dsh.env 值脱敏（键保留）
    if (masked.dsh.env && typeof masked.dsh.env === 'object') {
      masked.dsh.env = Object.fromEntries(
        Object.entries(masked.dsh.env).map(([k]) => [k, '***'])
      );
    }
    // dsh.proxy 密码段脱敏：http://user:pass@host → http://user:***@host（密码段可含 @，贪婪匹配到最后一个 @）
    if (typeof masked.dsh.proxy === 'string' && masked.dsh.proxy.length > 0) {
      masked.dsh.proxy = masked.dsh.proxy.replace(/:\/\/([^:/@]+):(.+)@/, '://$1:***@');
    }
  }
  return masked; // bridge 段永不返回
}

/**
 * 校验 PATCH 负载：仅白名单字段；未知/类型错误 → 422
 * @param {object} patch
 * @returns {{ ok:true, patch:object } | { ok:false, code:string, message:string }}
 */
function assertPatch(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return { ok: false, code: 'INVALID_BODY', message: '请求体必须是对象' };
  }
  const unknown = Object.keys(patch).filter((k) => !PATCH_WHITELIST.includes(k));
  if (unknown.length > 0) {
    return { ok: false, code: 'UNKNOWN_FIELD', message: `未知字段: ${unknown.join(', ')}` };
  }
  return { ok: true, patch };
}

/**
 * 校验窗口 action
 * @param {string} action
 * @returns {{ ok:true, action:string } | { ok:false, code:string, message:string }}
 */
function assertWindowAction(action) {
  if (!WINDOW_ACTIONS.has(action)) {
    return { ok: false, code: 'UNKNOWN_ACTION', message: `未知窗口动作: ${action}` };
  }
  return { ok: true, action };
}

/**
 * 创建路由处理器。
 * @param {{
 *   state:()=>object,
 *   getSettings:()=>object,
 *   patchSettings:(patch:object)=>object,
 *   windowAction:(action:string)=>object,
 *   notify:(body:object)=>object,
 *   restartBackend:()=>object,
 *   getDiagnostics:()=>{text:string},
 *   checkUpdater:()=>object,
 *   bridgeInfo:()=>object,
 *   checkDshUpdate?:()=>Promise<object>,
 *   updateDsh?:(body:object)=>Promise<object>,
 * }} services
 * @returns {(req:{method:string, pathname:string, body:any}) => Promise<{status:number, json:object}>}
 */
function createRoutes(services) {
  const ok = (data) => ({ status: 200, json: { ok: true, data } });
  const fail = (status, code, message, detail) => ({ status, json: { ok: false, code, message, detail } });

  return async function route(req) {
    const { method, pathname, body } = req;

    // GET /healthz（插件探测）
    if (method === 'GET' && pathname === '/healthz') {
      return ok({ healthy: true });
    }

    // GET /api/state
    if (method === 'GET' && pathname === '/api/state') {
      return ok(services.state());
    }

    // GET /api/settings（脱敏）
    if (method === 'GET' && pathname === '/api/settings') {
      return ok(services.getSettings());
    }

    // PATCH /api/settings（白名单 + 原子写）
    if (method === 'PATCH' && pathname === '/api/settings') {
      const check = assertPatch(body);
      if (!check.ok) return fail(422, check.code, check.message);
      try {
        return ok(services.patchSettings(check.patch));
      } catch (e) {
        if (e.code === 'EINVALID_CONFIG') return fail(422, 'INVALID_CONFIG', e.message, e.errors);
        return fail(409, 'WRITE_FAILED', `写配置失败: ${e.message}`);
      }
    }

    // POST /api/window/:action
    const winMatch = /^\/api\/window\/([a-z]+)$/.exec(pathname);
    if (method === 'POST' && winMatch) {
      const check = assertWindowAction(winMatch[1]);
      if (!check.ok) return fail(400, check.code, check.message);
      try {
        return ok(services.windowAction(check.action));
      } catch (e) {
        return fail(500, 'WINDOW_ACTION_FAILED', e.message);
      }
    }

    // POST /api/notify
    if (method === 'POST' && pathname === '/api/notify') {
      try {
        return ok(services.notify(body || {}));
      } catch (e) {
        return fail(503, 'NOTIFY_FAILED', e.message);
      }
    }

    // POST /api/backend/restart
    if (method === 'POST' && pathname === '/api/backend/restart') {
      try {
        return ok(await services.restartBackend());
      } catch (e) {
        return fail(500, 'RESTART_FAILED', e.message);
      }
    }

    // GET /api/diagnostics
    if (method === 'GET' && pathname === '/api/diagnostics') {
      return ok(services.getDiagnostics());
    }

    // POST /api/updater/check
    if (method === 'POST' && pathname === '/api/updater/check') {
      try {
        return ok(services.checkUpdater());
      } catch (e) {
        return fail(502, 'UPDATE_CHECK_FAILED', e.message);
      }
    }

    // GET /api/bridge/info
    if (method === 'GET' && pathname === '/api/bridge/info') {
      return ok(services.bridgeInfo());
    }

    // POST /api/dsh/check-update（G1，§16.4）
    if (method === 'POST' && pathname === '/api/dsh/check-update') {
      try {
        return ok(await services.checkDshUpdate());
      } catch (e) {
        return fail(502, 'DSH_CHECK_FAILED', e.message);
      }
    }

    // POST /api/dsh/update（G1，需 confirm:true）
    if (method === 'POST' && pathname === '/api/dsh/update') {
      try {
        return ok(await services.updateDsh(body || {}));
      } catch (e) {
        if (e.code === 'CONFIRM_REQUIRED') return fail(400, 'CONFIRM_REQUIRED', e.message);
        return fail(500, 'DSH_UPDATE_FAILED', e.message);
      }
    }

    return fail(404, 'NOT_FOUND', `未知端点: ${method} ${pathname}`);
  };
}

module.exports = { createRoutes, assertPatch, assertWindowAction, maskSettings, PATCH_WHITELIST, WINDOW_ACTIONS };
