import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createRoutes, assertPatch, assertWindowAction, maskSettings } = require('../main/bridge/routes.js');
const { isAllowedOrigin } = require('../main/bridge/server.js');

function makeRoutes(overrides = {}) {
  const services = {
    state: () => ({ appVersion: '1.0.0', windowVisible: true }),
    getSettings: () => ({ language: 'zh-CN' }),
    patchSettings: (p) => p,
    windowAction: (a) => ({ action: a, result: 'ok' }),
    notify: (b) => ({ delivered: true }),
    restartBackend: () => ({ started: true, port: 3080 }),
    getDiagnostics: () => ({ text: 'diag' }),
    checkUpdater: () => ({ hasUpdate: false, current: '1.0.0', latest: '1.0.0' }),
    bridgeInfo: () => ({ appVersion: '1.0.0', capabilities: [] }),
    ...overrides
  };
  return createRoutes(services);
}

test('后端重启接口等待实际结果并捕获异步失败', async () => {
  let complete;
  const request = makeRoutes({ restartBackend: () => new Promise(resolve => { complete = resolve; }) })({ method: 'POST', pathname: '/api/backend/restart' });
  complete({ started: true, port: 3092 });
  assert.deepEqual((await request).json.data, { started: true, port: 3092 });
  const failed = await makeRoutes({ restartBackend: async () => { throw new Error('启动超时'); } })({ method: 'POST', pathname: '/api/backend/restart' });
  assert.equal(failed.status, 500);
  assert.equal(failed.json.code, 'RESTART_FAILED');
});

// ============ 端点分发 ============
test('GET /healthz', async () => {
  const r = await makeRoutes()({ method: 'GET', pathname: '/healthz', body: {} });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.data, { healthy: true });
});

test('GET /api/state → services.state()', async () => {
  const r = await makeRoutes()({ method: 'GET', pathname: '/api/state', body: {} });
  assert.equal(r.status, 200);
  assert.equal(r.json.data.appVersion, '1.0.0');
});

test('GET /api/settings → services.getSettings()', async () => {
  const r = await makeRoutes()({ method: 'GET', pathname: '/api/settings', body: {} });
  assert.equal(r.json.ok, true);
});

test('PATCH /api/settings 白名单通过', async () => {
  const r = await makeRoutes()({ method: 'PATCH', pathname: '/api/settings', body: { tray: { topMost: true } } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.data, { tray: { topMost: true } });
});

test('PATCH /api/settings 未知字段 → 422 UNKNOWN_FIELD', async () => {
  const r = await makeRoutes()({ method: 'PATCH', pathname: '/api/settings', body: { bridge: { token: 'x' } } });
  assert.equal(r.status, 422);
  assert.equal(r.json.code, 'UNKNOWN_FIELD');
});

test('PATCH /api/settings 校验失败 → 422 INVALID_CONFIG', async () => {
  const services = {
    patchSettings: () => { const e = new Error('配置校验失败'); e.code = 'EINVALID_CONFIG'; e.errors = [{ path: 'dsh.port' }]; throw e; }
  };
  const r = await makeRoutes(services)({ method: 'PATCH', pathname: '/api/settings', body: { dsh: { port: 0 } } });
  assert.equal(r.status, 422);
  assert.equal(r.json.code, 'INVALID_CONFIG');
});

test('POST /api/window/minimize → 200', async () => {
  const r = await makeRoutes()({ method: 'POST', pathname: '/api/window/minimize', body: {} });
  assert.equal(r.status, 200);
  assert.equal(r.json.data.action, 'minimize');
});

test('POST /api/window/evil → 400 UNKNOWN_ACTION', async () => {
  const r = await makeRoutes()({ method: 'POST', pathname: '/api/window/evil', body: {} });
  assert.equal(r.status, 400);
  assert.equal(r.json.code, 'UNKNOWN_ACTION');
});

test('POST /api/notify / backend/restart / updater/check', async () => {
  assert.equal((await makeRoutes()({ method: 'POST', pathname: '/api/notify', body: { title: 't' } })).json.data.delivered, true);
  assert.equal((await makeRoutes()({ method: 'POST', pathname: '/api/backend/restart', body: {} })).json.data.started, true);
  assert.equal((await makeRoutes()({ method: 'POST', pathname: '/api/updater/check', body: {} })).json.data.hasUpdate, false);
});

test('POST /api/dsh/check-update 与 /api/dsh/update（G1）', async () => {
  const services = {
    checkDshUpdate: async () => ({ source: 'npx', currentVersion: '0.1.1-rc.2', latestVersion: '0.1.1-rc.2', hasUpdate: false }),
    updateDsh: async (body) => {
      if (!(body && body.confirm === true)) { const e = new Error('需要 confirm'); e.code = 'CONFIRM_REQUIRED'; throw e; }
      return { ok: true, log: ['done'], restartRequired: true };
    }
  };
  const routes = makeRoutes(services);
  const check = await routes({ method: 'POST', pathname: '/api/dsh/check-update', body: {} });
  assert.equal(check.status, 200);
  assert.equal(check.json.data.hasUpdate, false);

  const noConfirm = await routes({ method: 'POST', pathname: '/api/dsh/update', body: {} });
  assert.equal(noConfirm.status, 400);
  assert.equal(noConfirm.json.code, 'CONFIRM_REQUIRED');

  const confirmed = await routes({ method: 'POST', pathname: '/api/dsh/update', body: { confirm: true } });
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.json.data.ok, true);
  assert.equal(confirmed.json.data.restartRequired, true);
});

test('未知端点 → 404 NOT_FOUND', async () => {
  const r = await makeRoutes()({ method: 'GET', pathname: '/api/nope', body: {} });
  assert.equal(r.status, 404);
  assert.equal(r.json.code, 'NOT_FOUND');
});

// ============ assertPatch / assertWindowAction ============
test('assertPatch 非对象 → INVALID_BODY', () => {
  assert.equal(assertPatch('x').code, 'INVALID_BODY');
  assert.equal(assertPatch(null).code, 'INVALID_BODY');
});

test('assertWindowAction 白名单', () => {
  assert.equal(assertWindowAction('show').ok, true);
  assert.equal(assertWindowAction('toggle').ok, true);
  assert.equal(assertWindowAction('explode').ok, false);
});

// ============ maskSettings（X2 脱敏） ============
test('maskSettings 剔除 bridge 段', () => {
  const masked = maskSettings({ language: 'zh-CN', bridge: { port: 1, token: 'secret' } });
  assert.equal(masked.bridge, undefined);
  assert.equal(masked.language, 'zh-CN');
});

test('maskSettings 对 dsh.env 值脱敏', () => {
  const masked = maskSettings({ dsh: { env: { DEEPSEEK_API_KEY: 'sk-xxx', FOO: 'bar' } } });
  assert.deepEqual(masked.dsh.env, { DEEPSEEK_API_KEY: '***', FOO: '***' });
});

test('maskSettings 对 dsh.proxy 密码段脱敏', () => {
  const masked = maskSettings({ dsh: { proxy: 'http://user:p@ssw0rd@proxy.local:8080' } });
  assert.equal(masked.dsh.proxy, 'http://user:***@proxy.local:8080');
  const plain = maskSettings({ dsh: { proxy: 'http://proxy.local:8080' } });
  assert.equal(plain.dsh.proxy, 'http://proxy.local:8080');
});

// ============ isAllowedOrigin（D3） ============
test('isAllowedOrigin 允许 DSH 页面 origin', () => {
  const allowed = ['http://127.0.0.1:3080', 'http://localhost:3080'];
  assert.equal(isAllowedOrigin('http://127.0.0.1:3080', allowed), true);
  assert.equal(isAllowedOrigin('http://localhost:3080', allowed), true);
});

test('isAllowedOrigin 拒绝异源与缺失', () => {
  const allowed = ['http://127.0.0.1:3080', 'http://localhost:3080'];
  assert.equal(isAllowedOrigin('https://evil.com', allowed), false);
  assert.equal(isAllowedOrigin(null, allowed), false);
  assert.equal(isAllowedOrigin('', allowed), false);
});
