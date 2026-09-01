import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createLogger } = require('../main/logging.js');

function memoryFs() {
  const files = new Map();
  return {
    existsSync: (file) => files.has(file),
    mkdirSync: () => undefined,
    statSync: (file) => ({ size: files.get(file)?.length || 0 }),
    appendFileSync: (file, value) => files.set(file, `${files.get(file) || ''}${value}`),
    readFileSync: (file) => files.get(file) || '',
    renameSync: (from, to) => { files.set(to, files.get(from)); files.delete(from); },
    files
  };
}

test('控制台管道抛出 EPIPE 时文件日志仍成功且不崩溃', () => {
  const fs = memoryFs();
  const brokenConsole = {
    log: () => { const error = new Error('broken pipe'); error.code = 'EPIPE'; throw error; },
    error: () => { const error = new Error('broken pipe'); error.code = 'EPIPE'; throw error; }
  };
  const logger = createLogger({ userDataPath: 'C:/data', fs, console: brokenConsole });
  assert.doesNotThrow(() => logger.log('启动完成'));
  assert.doesNotThrow(() => logger.logError('测试错误'));
  assert.match(logger.tail(10), /启动完成/);
  assert.match(logger.tail(10), /测试错误/);
});

test('打包态关闭控制台输出', () => {
  const fs = memoryFs();
  let calls = 0;
  const logger = createLogger({
    userDataPath: 'C:/data', fs, consoleEnabled: false,
    console: { log: () => { calls += 1; }, error: () => { calls += 1; } }
  });
  logger.log('仅写文件');
  assert.equal(calls, 0);
  assert.match(logger.tail(10), /仅写文件/);
});
