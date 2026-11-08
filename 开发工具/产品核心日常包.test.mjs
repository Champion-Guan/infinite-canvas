import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { 根目录 } from './公共.mjs';
import { 核验产品日常包, 核验产品恢复收据 } from './产品核心日常运行.mjs';
import { 核验本次旧锁 } from './产品核心3100保全恢复.mjs';

const file = process.env.GUAN_PRODUCT_MANIFEST;
assert.ok(file, '须明确指定本轮构建的GUAN_PRODUCT_MANIFEST，不接触正式数据');
const original = readFileSync(file), sha = bytes => createHash('sha256').update(bytes).digest('hex'), expected = sha(original);
const root = mkdtempSync(join(根目录, '.运行/SQLite产品日常准备-'));
cpSync(dirname(file), root, { recursive: true, force: false, errorOnExist: true });
const manifest = join(root, '准备清单.json');
test('完整产品、悬浮删除、恢复挂载及原稳定助手来源核验', () => {
  assert.equal(核验产品日常包(manifest, expected).manifest.protocol, 'guan-product-daily.v1');
});
test('错误摘要与伪造来源，即使重算摘要仍拒绝', () => {
  assert.throws(() => 核验产品日常包(manifest, '0'.repeat(64)), /内容或指纹/);
  try {
    for (const key of ['integrationRecord', 'deltaSHA256', 'helperSourceSHA256', 'baselineSHA']) {
      const value = JSON.parse(original); value[key] = 'synthetic';
      const bytes = JSON.stringify(value); writeFileSync(manifest, bytes);
      assert.throws(() => 核验产品日常包(manifest, sha(bytes)), /内容或指纹|助手不符/);
    }
  } finally { writeFileSync(manifest, original); }
});
test('未知文件、空目录、符号链接及构建字节变化拒绝', () => {
  const unknown = join(root, '未知项'), directory = join(root, 'web/未知目录'), link = join(root, 'web/未知.svg');
  try { writeFileSync(unknown, 'synthetic'); assert.throws(() => 核验产品日常包(manifest, expected), /内容或指纹/); }
  finally { unlinkSync(unknown); }
  try { mkdirSync(directory); assert.throws(() => 核验产品日常包(manifest, expected), /内容或指纹/); }
  finally { rmdirSync(directory); }
  try { symlinkSync(join(root, 'web/logo.svg'), link); assert.throws(() => 核验产品日常包(manifest, expected), /不安全/); }
  finally { unlinkSync(link); }
  const script = join(root, 'web/assets', readdirSync(join(root, 'web/assets')).find(name => name.endsWith('.js'))), bytes = readFileSync(script);
  try { writeFileSync(script, Buffer.concat([bytes, Buffer.from('\n')])); assert.throws(() => 核验产品日常包(manifest, expected), /内容或指纹/); }
  finally { writeFileSync(script, bytes); }
});
test('本次窄范围锁校验拒绝其他PID、nonce和附加字段', () => {
  核验本次旧锁({ pid: 60988, nonce: '0976a297-8adb-4c85-aa08-4bf5075c0114' });
  for (const value of [{ pid: 1 }, { pid: 60988, nonce: 'wrong' }, { pid: 60988, nonce: '0976a297-8adb-4c85-aa08-4bf5075c0114', extra: true }]) assert.throws(() => 核验本次旧锁(value));
});
test('没有TTY和当前维护确认时，启动在访问正式数据前拒绝；外部收据拒绝', () => {
  const result = spawnSync(process.execPath, ['开发工具/产品核心日常运行.mjs', '--启动', manifest, expected, '/tmp/untrusted.json', '0'.repeat(64), '--不确认'], { cwd: 根目录, encoding: 'utf8' });
  assert.notEqual(result.status, 0); assert.match(result.stderr, /需要当前保存关闭确认/);
  assert.throws(() => 核验产品恢复收据('/tmp/untrusted.json', '0'.repeat(64)), /路径不符/);
});
