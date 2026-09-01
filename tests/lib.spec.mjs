import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { escapeHtml } = require('../main/lib/escape-html.js');
const { compareSemver, parseVersion } = require('../main/lib/semver.js');

// ============ escape-html（D2） ============
test('escapeHtml 转义全部危险字符', () => {
  assert.equal(escapeHtml(`<script>alert("x'&y")</script>`),
    '&lt;script&gt;alert(&quot;x&#39;&amp;y&quot;)&lt;/script&gt;');
});

test('escapeHtml null/undefined → 空串', () => {
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
});

test('escapeHtml 数字/普通文本原样', () => {
  assert.equal(escapeHtml(42), '42');
  assert.equal(escapeHtml('hello 世界'), 'hello 世界');
});

// ============ compareSemver（X4 / P0.4） ============
test('compareSemver 基本比较', () => {
  assert.equal(compareSemver('1.2.3', '1.2.4'), -1);
  assert.equal(compareSemver('1.2.4', '1.2.3'), 1);
  assert.equal(compareSemver('1.2.3', '1.2.3'), 0);
  assert.equal(compareSemver('0.1.1-rc.2', '0.1.1'), 0); // 预发布不参与排序
});

test('compareSemver 忽略 v 前缀与空格', () => {
  assert.equal(compareSemver('v1.2.3', '1.2.3'), 0);
  assert.equal(compareSemver(' 1.0.0 ', '1.0.1'), -1);
});

test('compareSemver 主/次版本优先', () => {
  assert.equal(compareSemver('2.0.0', '1.9.9'), 1);
  assert.equal(compareSemver('1.10.0', '1.9.9'), 1);
});

test('compareSemver 非法版本 → null（标记 unknown，不硬判）', () => {
  assert.equal(compareSemver('abc', '1.2.3'), null);
  assert.equal(compareSemver('1.2.3', 'unknown'), null);
  assert.equal(compareSemver(null, '1.2.3'), null);
  assert.equal(compareSemver('', ''), null);
});

test('parseVersion 解析', () => {
  assert.deepEqual(parseVersion('0.1.1-rc.2'), [0, 1, 1]);
  assert.deepEqual(parseVersion('v2.3.4'), [2, 3, 4]);
  assert.equal(parseVersion('nope'), null);
});
