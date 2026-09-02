import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createDshServer } = require('../main/dsh-server.js');
const { terminateProcessTree } = require('../main/dsh-runtime.js');
const normalize = value => path.win32.resolve(value).toLowerCase();
const root = 'D:\\测试 Repo\\deepseek-harness';
const flush = async () => { for (let i = 0; i < 24; i++) await Promise.resolve(); };

function fakeClock() {
  let now = 0;
  let sequence = 0;
  const timers = new Map();
  return {
    timers,
    setTimeout(fn, ms) { const id = ++sequence; timers.set(id, { fn, at: now + ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    async advance(ms) {
      const end = now + ms;
      while (true) {
        const due = [...timers].sort((a, b) => a[1].at - b[1].at).find(([, timer]) => timer.at <= end);
        if (!due) break;
        now = due[1].at;
        timers.delete(due[0]);
        due[1].fn();
        await flush();
      }
      now = end;
      await flush();
    }
  };
}

function fixture(options = {}) {
  const cfg = { path: root, port: 3092, profile: 'web', ...options.cfg };
  const roots = options.roots || [root];
  const files = new Set(roots.flatMap(dir => ['package.json', 'apps/cli/src/bin.ts',
    'node_modules/tsx/package.json', 'apps/cli/lib/bin.js', 'apps/web/dist/index.html'].map(file => normalize(path.win32.join(dir, file)))));
  for (const file of options.missing || []) files.delete(normalize(path.win32.join(root, file)));
  const children = [];
  const killed = [];
  const logs = [];
  const commands = [];
  const clock = fakeClock();
  const deps = {
    projectRoot: 'C:\\App\\resources\\app.asar', executablePath: 'C:\\App\\DeepSeek Harness.exe',
    platform: 'win32', env: options.env || {}, os: { homedir: () => 'C:\\Users\\Tester' },
    getDshConfig: () => ({ dsh: cfg }), clock,
    fs: {
      existsSync: file => files.has(normalize(file)),
      readFileSync: file => {
        if (!files.has(normalize(file))) throw new Error('missing');
        return JSON.stringify({ scripts: { dsh: 'node --import tsx/esm apps/cli/src/bin.ts' } });
      }
    },
    execSync: command => {
      commands.push(command);
      if (command.startsWith('dsh ') || options.missingTools?.includes(command.split(' ')[0])) throw new Error('not installed');
      return command === 'npm root -g' ? 'C:\\npm' : '1.0.0';
    },
    logger: { log: message => logs.push(message), logError: message => logs.push(message) },
    isPortInUse: options.isPortInUse || (async () => false),
    probeUrl: options.probeUrl || (async () => true),
    spawn: (cmd, args, spawnOptions) => {
      if (options.spawnError) throw options.spawnError;
      const child = new EventEmitter();
      Object.assign(child, { pid: 100 + children.length, exitCode: null, signalCode: null,
        stdout: new EventEmitter(), stderr: new EventEmitter(), cmd, args, options: spawnOptions });
      children.push(child);
      queueMicrotask(() => options.onSpawn?.(child));
      return child;
    },
    terminateProcess: async child => {
      killed.push(child.pid);
      if (options.killError) throw new Error('kill failed');
      child.exitCode = 0;
      child.emit('exit', 0, null);
      child.emit('close', 0, null);
    }
  };
  const server = createDshServer(deps);
  return { server, cfg, files, children, killed, logs, commands, clock, deps };
}

test('配置路径和环境变量优先，支持中文、空格与规范化路径', () => {
  const envRoot = 'D:\\环境 仓库';
  const f = fixture({ roots: [root, envRoot], env: { DSH_REPO_ROOT: `${envRoot}\\.` } });
  const facts = f.server.detectFacts();
  assert.equal(facts.repoPaths[0], envRoot);
  assert.equal(f.server.resolveLaunch(f.cfg, facts).cwd, envRoot);
  assert.equal(f.server.resolveLaunch(f.cfg, facts).source, 'config-path');
});

test('安装目录相邻仓库在 app.asar 外，并对候选去重', () => {
  const f = fixture({ cfg: { path: '' }, roots: ['C:\\deepseek-harness', 'C:\\App\\deepseek-harness'] });
  const facts = f.server.detectFacts();
  assert.deepEqual(facts.repoPaths, ['C:\\deepseek-harness', 'C:\\App\\deepseek-harness']);
});

test('显式无效仓库不会退回 npx', async () => {
  const f = fixture({ roots: [] });
  await assert.rejects(f.server.start(), { code: 'INVALID_REPO' });
  assert.equal(f.children.length, 0);
  assert.ok(!f.commands.includes('npm root -g'));
});

for (const [file, code, hint] of [
  ['apps/cli/src/bin.ts', 'MISSING_ENTRY', '恢复完整'],
  ['node_modules/tsx/package.json', 'MISSING_DEPENDENCIES', 'pnpm install --frozen-lockfile'],
  ['apps/cli/lib/bin.js', 'MISSING_BUILD', 'pnpm run build'],
  ['apps/web/dist/index.html', 'MISSING_BUILD', 'pnpm run build']
]) {
  test(`缺失 ${file} 提前给出修复步骤`, async () => {
    const f = fixture({ missing: [file] });
    await assert.rejects(f.server.start(), error => error.code === code && error.message.includes(hint) && error.message.includes(root));
    assert.equal(f.children.length, 0);
  });
}

for (const tool of ['node', 'pnpm']) {
  test(`缺少 ${tool} 不启动子进程`, async () => {
    const f = fixture({ missingTools: [tool] });
    await assert.rejects(f.server.start(), { code: tool === 'node' ? 'MISSING_NODE' : 'MISSING_TOOL' });
    assert.equal(f.children.length, 0);
  });
}

for (const tool of ['npm', 'npx']) {
  test(`npx 路径缺少 ${tool} 时提前失败`, async () => {
    const f = fixture({ cfg: { path: '' }, roots: [], missingTools: [tool] });
    await assert.rejects(f.server.start(), { code: 'MISSING_TOOL' });
    assert.equal(f.children.length, 0);
  });
}

test('并发启动只创建一个子进程，停止只清理持有的进程', async () => {
  const f = fixture();
  const first = f.server.start();
  assert.equal(f.server.start(), first);
  const result = await first;
  assert.equal(result.reused, false);
  assert.equal(f.children.length, 1);
  assert.equal(f.children[0].options.cwd, root);
  assert.equal(f.children[0].options.windowsHide, true);
  await f.server.stop();
  assert.deepEqual(f.killed, [100]);
  assert.equal(f.server.status().ready, false);
  assert.equal(f.clock.timers.size, 0);
});

test('已有可访问服务只复用，stop 不终止外部进程', async () => {
  const f = fixture({ isPortInUse: async () => true });
  assert.equal((await f.server.start()).reused, true);
  await f.server.stop();
  assert.equal(f.children.length, 0);
  assert.deepEqual(f.killed, []);
});

test('占用且不可认证的端口明确失败，不叠加启动', async () => {
  const f = fixture({ isPortInUse: async () => true, probeUrl: async () => false });
  await assert.rejects(f.server.start(), { code: 'PORT_UNAVAILABLE' });
  assert.equal(f.children.length, 0);
});

test('进程提前退出携带末行日志立即失败', async () => {
  const f = fixture({ probeUrl: async () => false, onSpawn: child => {
    child.stderr.emit('data', Buffer.from('构建文件丢失'));
    child.exitCode = 2;
    child.emit('exit', 2, null);
  } });
  await assert.rejects(f.server.start(), error => error.code === 'PROCESS_EXITED' && error.message.includes('构建文件丢失'));
  assert.equal(f.clock.timers.size, 0);
});

test('spawn error 事件立即失败，轮询完全取消', async () => {
  const f = fixture({ probeUrl: async () => false, onSpawn: child => child.emit('error', new Error('ENOENT')) });
  await assert.rejects(f.server.start(), { code: 'SPAWN_FAILED' });
  assert.equal(f.clock.timers.size, 0);
});

test('同步 spawn 异常不会留下启动状态', async () => {
  const f = fixture({ spawnError: new Error('spawn refused') });
  await assert.rejects(f.server.start(), /spawn refused/);
  assert.equal(f.server.status().running, false);
});

test('90 秒超时清理子进程且取消所有计时器', async () => {
  const f = fixture({ probeUrl: async () => false });
  const rejected = assert.rejects(f.server.start(), { code: 'START_TIMEOUT' });
  await flush();
  await f.clock.advance(90000);
  await rejected;
  assert.deepEqual(f.killed, [100]);
  assert.equal(f.clock.timers.size, 0);
});

test('npx 首次安装超时给出终端预安装指引', async () => {
  const f = fixture({ cfg: { path: '' }, roots: [], probeUrl: async () => false });
  const rejected = assert.rejects(f.server.start(), /npm install -g @deepseek-ai\/dsh/);
  await flush();
  await f.clock.advance(90000);
  await rejected;
});

test('停止发生在端口探测期间时，不再创建进程', async () => {
  let resolvePort;
  const f = fixture({ isPortInUse: () => new Promise(resolve => { resolvePort = resolve; }) });
  const rejected = assert.rejects(f.server.start(), { code: 'START_CANCELLED' });
  await f.server.stop();
  resolvePort(false);
  await rejected;
  await flush();
  assert.equal(f.children.length, 0);
});

test('停止中断等待中的 HTTP 探测，不等待超时', async () => {
  let signal;
  const f = fixture({ probeUrl: (url, options) => { signal = options.signal; return new Promise(() => {}); } });
  const rejected = assert.rejects(f.server.start(), { code: 'START_CANCELLED' });
  await flush();
  await f.server.stop();
  await rejected;
  assert.equal(signal.aborted, true);
  assert.equal(f.clock.timers.size, 0);
});

test('重启合并并发请求，旧进程迟到事件不能覆盖新状态', async () => {
  const f = fixture();
  await f.server.start();
  const old = f.children[0];
  const first = f.server.restart();
  assert.equal(f.server.restart(), first);
  await first;
  old.emit('exit', 1, null);
  old.stderr.emit('data', Buffer.from('old output\n'));
  assert.equal(f.server.status().ready, true);
  assert.ok(!f.server.status().lastStderr.includes('old output'));
  assert.equal(f.children.length, 2);
  await f.server.stop();
});

test('进程树清理失败会阻止启动第二个后端', async () => {
  const options = { killError: true };
  const f = fixture(options);
  await f.server.start();
  await assert.rejects(f.server.stop(), /kill failed/);
  await assert.rejects(f.server.start(), { code: 'STOP_REQUIRED' });
  options.killError = false;
  await f.server.stop();
});

test('认证链接不进入状态或分块日志，认证后只使用基础地址', async () => {
  const token = 'a_very_private_launch_token';
  let authenticated = false;
  const f = fixture({
    probeUrl: async url => { if (url.includes(token)) authenticated = true; return authenticated; },
    onSpawn: child => {
      child.stderr.emit('data', Buffer.from('\u001b[32mdsh web: http://127.0.0.1:3092/?to'));
      child.stderr.emit('data', Buffer.from(`ken=${token}\u001b[0m\n`));
    }
  });
  const started = f.server.start();
  await flush();
  await f.clock.advance(2000);
  await started;
  assert.equal(f.server.dshUrl(), 'http://127.0.0.1:3092');
  assert.equal(await f.server.isServerReady(), true);
  await f.server.stop();
  assert.ok(!f.logs.join('\n').includes(token));
  assert.ok(!JSON.stringify(f.server.status()).includes(token));
});

test('Windows taskkill 精确限定本应用子进程树且隐藏窗口', async () => {
  const child = { pid: 42, exitCode: null, signalCode: null };
  const calls = [];
  await terminateProcessTree(child, { platform: 'win32', execFileImpl: (...args) => {
    calls.push(args.slice(0, 3)); args[3](null);
  } });
  assert.deepEqual(calls[0], ['taskkill.exe', ['/PID', '42', '/T', '/F'], { windowsHide: true, timeout: 5000 }]);
  await terminateProcessTree({ ...child, exitCode: 0 }, { platform: 'win32', execFileImpl: () => assert.fail('不应结束已退出进程') });
});
