import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, renameSync, symlinkSync, unlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { 根目录 } from './公共.mjs';
import { Excel勾选前置记录 } from './预审Excel勾选事件.mjs';
import { 读取Excel隔离记录 } from './接入Excel导入与工作簿隔离副本.mjs';
import { 核验Excel勾选批准, 读取Excel勾选批准, 核验Excel勾选来源, Excel勾选差异SHA256 } from '../上游适配/Excel勾选事件批准.mjs';
import { Excel勾选批准产物, 核验Excel勾选完整包 } from './接入Excel勾选事件隔离副本.mjs';
import { 事务写入 } from './接入用户功能.mjs';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'guan-excel-selection-guard-'))), root = join(home, '组合包');
cpSync(读取Excel隔离记录(Excel勾选前置记录).组合包, root, { recursive: true, dereference: false, verbatimSymlinks: true });
const manifest = 读取Excel勾选批准(), delta = Excel勾选批准产物();
test('一文件批准、来源、完整前置均匹配', () => {
  assert.equal(manifest.文件数, 1); 核验Excel勾选来源(根目录); assert.equal(核验Excel勾选完整包(root, false), true);
});
test('篡改批准、未知文件、未知源码和链接均拒绝', () => {
  const json = readFileSync(join(根目录, '上游适配/待审查/Excel勾选事件一文件修订.json'));
  const patch = readFileSync(join(根目录, '上游适配/待审查/Excel勾选事件一文件修订.patch'));
  assert.throws(() => 核验Excel勾选批准(Buffer.concat([json, Buffer.from(' ')]), patch));
  assert.throws(() => 核验Excel勾选批准(json, Buffer.concat([patch, Buffer.from(' ')])));
  assert.throws(() => 核验Excel勾选来源(home));
  const unknown = join(root, 'unknown.txt'); writeFileSync(unknown, 'test');
  assert.throws(() => 核验Excel勾选完整包(root, false)); unlinkSync(unknown);
  const file = join(root, '画布副本/web/index.html'), bytes = readFileSync(file);
  writeFileSync(file, 'changed'); assert.throws(() => 核验Excel勾选完整包(root, false)); writeFileSync(file, bytes);
  renameSync(file, file + '.saved'); symlinkSync(file + '.saved', file);
  assert.throws(() => 核验Excel勾选完整包(root, false), /拒绝源码链接/); unlinkSync(file); renameSync(file + '.saved', file);
});
test('写后故障恢复原态，随后完整事务精确后态匹配', () => {
  const failed = join(home, '故障快照');
  assert.throws(() => 事务写入(root, delta, failed, { 差异指纹: Excel勾选差异SHA256, 写后检查() { throw Error('合成写后故障'); } }), /合成写后故障/);
  assert.equal(JSON.parse(readFileSync(join(failed, '事务.json'))).状态, '已回退');
  assert.equal(核验Excel勾选完整包(root, false), true);
  事务写入(root, delta, join(home, '完整快照'), { 差异指纹: Excel勾选差异SHA256, 写后检查() { 核验Excel勾选完整包(root, true); } });
  assert.equal(核验Excel勾选完整包(root, true), true); assert.throws(() => 核验Excel勾选完整包(root, false));
});
