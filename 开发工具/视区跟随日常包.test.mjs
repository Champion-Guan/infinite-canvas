import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { 根目录 } from './公共.mjs';
import { 核验视区跟随日常包 } from './视区跟随日常运行.mjs';

const source = join(根目录, '.运行/SQLite视区跟随日常准备-QxvXUK');
const expected = '611c452fe25dec8f5b80ccd26a221c0bf6425fd538214a69c7ecfa8236e6f857';
const root = mkdtempSync(join(根目录, '.运行/SQLite视区跟随日常准备-'));
cpSync(source, root, { recursive: true, force: false, errorOnExist: true });
const file = join(root, '准备清单.json'), original = readFileSync(file);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
test('批准来源、完整静态包与原稳定助手来源通过，核验不访问正式数据', () => {
  assert.equal(核验视区跟随日常包(file, expected).manifest.protocol, 'guan-reveal-daily.v1');
});
test('错误摘要及伪造接入记录/差异拒绝，即使重新计算清单摘要', () => {
  assert.throws(() => 核验视区跟随日常包(file, '0'.repeat(64)), /内容或指纹/);
  try {
    for (const key of ['integrationRecord', 'deltaSHA256', 'helperSourceSHA256']) {
      const value = JSON.parse(original); value[key] = 'synthetic';
      const bytes = JSON.stringify(value); writeFileSync(file, bytes);
      assert.throws(() => 核验视区跟随日常包(file, sha(bytes)), /内容或指纹|助手不符/);
    }
  } finally { writeFileSync(file, original); }
});
test('未知根文件、静态空目录、源码链接和构建字节改变拒绝', () => {
  const unknown = join(root, '未知项'), directory = join(root, 'web/未知目录'), link = join(root, 'web/未知.svg');
  try { writeFileSync(unknown, 'synthetic'); assert.throws(() => 核验视区跟随日常包(file, expected), /内容或指纹/); }
  finally { unlinkSync(unknown); }
  try { mkdirSync(directory); assert.throws(() => 核验视区跟随日常包(file, expected), /内容或指纹/); }
  finally { rmdirSync(directory); }
  try { symlinkSync(join(root, 'web/logo.svg'), link); assert.throws(() => 核验视区跟随日常包(file, expected), /不安全/); }
  finally { unlinkSync(link); }
  const script = join(root, 'web/assets', readdirSync(join(root, 'web/assets')).find(name => name.endsWith('.js'))), bytes = readFileSync(script);
  try { writeFileSync(script, Buffer.concat([bytes, Buffer.from('\n')])); assert.throws(() => 核验视区跟随日常包(file, expected), /内容或指纹/); }
  finally { writeFileSync(script, bytes); }
});
