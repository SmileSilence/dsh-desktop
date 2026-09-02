import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createLineReader, parseLaunchUrl, redactOutput, createSessionProbe } = require('../main/dsh-runtime.js');

test('UTF-8 字符和登录凭据跨数据块时，直到行结束才处理', () => {
  const lines = [];
  const reader = createLineReader(line => lines.push(redactOutput(line)));
  const raw = Buffer.from('中文 http://127.0.0.1:3092/?token=secret_abc\r\n');
  for (const byte of raw) reader.write(Buffer.from([byte]));
  reader.end();
  assert.deepEqual(lines, ['中文 http://127.0.0.1:3092/?token=[REDACTED]']);
});

test('过长未结束行整体丢弃，下一行仍可解析', () => {
  const lines = [];
  const reader = createLineReader(line => lines.push(line), 10);
  reader.write(Buffer.from('x'.repeat(100)));
  reader.write(Buffer.from('private\nok\n'));
  reader.end();
  assert.deepEqual(lines, ['ok']);
});

test('正式启动行支持颜色码和 localhost，并忽略 LAN 展示', () => {
  assert.equal(parseLaunchUrl('\u001b[32mdsh web: http://localhost:3092/?token=abc_-\u001b[0m (LAN: http://192.168.0.2:3092/?token=abc_-) ', 3092),
    'http://127.0.0.1:3092/?token=abc_-');
});

for (const address of ['http://127.0.0.1:9999/?token=secret', 'http://example.com:3092/?token=secret',
  'https://127.0.0.1:3092/?token=secret', 'http://user:pass@127.0.0.1:3092/?token=secret',
  'http://127.0.0.1:3092/other?token=secret', 'http://127.0.0.1:3092/?token=a&token=b']) {
  test(`拒绝非本机正式启动链接 ${address.split('?')[0]}`, () => {
    assert.equal(parseLaunchUrl(`dsh web: ${address}`, 3092), null);
  });
}

test('非启动日志中的 URL 不用于登录，输出仍脱敏', () => {
  assert.equal(parseLaunchUrl('debug http://127.0.0.1:3092/?token=secret', 3092), null);
  assert.equal(redactOutput('http://user:password@proxy/?token=secret'), 'http://user:[REDACTED]@proxy/?token=[REDACTED]');
});

test('真实 HTTP 登录重定向取得 Cookie 后返回 200，过期 Cookie 返回 401', async t => {
  let cookie = '';
  let valid = true;
  const requests = [];
  const server = createServer((req, res) => {
    requests.push(req.url);
    if (req.url === '/?token=valid') {
      res.writeHead(303, { location: '/', 'set-cookie': 'dsh-auth=valid; HttpOnly; SameSite=Strict; Path=/' });
    } else if (req.url === '/redirect-away') {
      res.writeHead(303, { location: 'http://example.com/' });
    } else if (req.url.startsWith('/status/')) {
      res.writeHead(Number(req.url.split('/').pop()));
    } else if (valid && req.headers.cookie === 'dsh-auth=valid') res.writeHead(200);
    else res.writeHead(401);
    res.end('page');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  // 此处注入 Cookie 容器；Electron 的真实 Session 在隔离打包冒烟中验证。
  const probe = createSessionProbe(() => ({ fetch: async (url, options) => {
    const response = await fetch(url, { ...options, headers: { cookie } });
    if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    return response;
  } }));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal(await probe(base), false);
  assert.equal(await probe(`${base}/?token=wrong`), false);
  assert.equal(await probe(`${base}/?token=valid`), true);
  assert.equal(await probe(base), true);
  assert.ok(requests.includes('/'));
  valid = false;
  assert.equal(await probe(base), false);
  assert.equal(await probe(`${base}/redirect-away`), false);
  for (const code of [401, 403, 404, 500, 503]) assert.equal(await probe(`${base}/status/${code}`), false);
});

test('浏览器探测响应不返回时按时取消', async () => {
  let aborted = false;
  const probe = createSessionProbe(() => ({ fetch: (url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')); });
  }) }));
  assert.equal(await probe('http://127.0.0.1:3092', { timeoutMs: 5 }), false);
  assert.equal(aborted, true);
});

for (const [destination, statusCode, expected] of [
  ['http://127.0.0.1:3092/', 200, true],
  ['http://127.0.0.1:3092/', 401, false],
  ['http://127.0.0.1:3092/', 403, false],
  ['http://127.0.0.1:3092/', 404, false],
  ['http://127.0.0.1:3092/', 500, false],
  ['http://example.com/', 200, false],
  ['http://127.0.0.1:9999/', 200, false]
]) {
  test(`Electron 请求逐跳放行 ${destination}，最终状态 ${statusCode}`, async () => {
    const browserSession = {};
    let followed = 0;
    let requestOptions;
    const probe = createSessionProbe(() => browserSession, options => {
      requestOptions = options;
      const request = new EventEmitter();
      request.abort = () => {};
      request.end = () => queueMicrotask(() => request.emit('redirect', 303, 'GET', destination));
      request.followRedirect = () => {
        followed++;
        const response = new EventEmitter();
        response.statusCode = statusCode;
        response.resume = () => queueMicrotask(() => response.emit('end'));
        request.emit('response', response);
      };
      return request;
    });
    assert.equal(await probe('http://127.0.0.1:3092/?token=secret'), expected);
    assert.equal(requestOptions.session, browserSession);
    assert.equal(requestOptions.credentials, 'include');
    assert.equal(requestOptions.redirect, 'manual');
    assert.equal(followed, destination === 'http://127.0.0.1:3092/' ? 1 : 0);
  });
}

test('Electron 重定向循环最多放行三次', async () => {
  let followed = 0;
  const probe = createSessionProbe(() => ({}), () => {
    const request = new EventEmitter();
    const redirect = () => request.emit('redirect', 303, 'GET', 'http://127.0.0.1:3092/');
    request.abort = () => {};
    request.end = () => queueMicrotask(redirect);
    request.followRedirect = () => { followed++; queueMicrotask(redirect); };
    return request;
  });
  assert.equal(await probe('http://127.0.0.1:3092'), false);
  assert.equal(followed, 3);
});

test('Electron 挂起请求在取消后被 abort', async () => {
  const controller = new AbortController();
  let aborted = false;
  const probe = createSessionProbe(() => ({}), () => {
    const request = new EventEmitter();
    request.abort = () => { aborted = true; };
    request.end = () => queueMicrotask(() => controller.abort());
    return request;
  });
  assert.equal(await probe('http://127.0.0.1:3092', { signal: controller.signal }), false);
  assert.equal(aborted, true);
});
