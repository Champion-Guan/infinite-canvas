import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { 根目录 } from './公共.mjs';
import { 事务写入 } from './接入用户功能.mjs';
import { 产品竞态前置记录 } from './预审产品入口创建竞态.mjs';
import { 读取产品隔离记录 } from './接入产品核心隔离副本.mjs';
import { 读取产品入口批准, 核验产品入口批准, 产品入口差异SHA256, 产品入口组合路径 } from '../上游适配/产品入口竞态批准.mjs';
import { 产品入口批准产物, 核验产品入口完整包 } from './接入产品入口竞态隔离副本.mjs';

const previous = 读取产品隔离记录(产品竞态前置记录), manifest = 读取产品入口批准();
const home = mkdtempSync(join(根目录, '.运行/产品入口保护测试-')), root = join(home, '组合包');
cpSync(previous.组合包, root, { recursive: true, dereference: false, verbatimSymlinks: true, errorOnExist: true, force: false });
const json = readFileSync(join(根目录, '上游适配/待审查/产品入口创建竞态.json'));
const patch = readFileSync(join(根目录, '上游适配/待审查/产品入口创建竞态.patch'));
const delta = 产品入口批准产物(), target = join(root, 产品入口组合路径), baseline = readFileSync(target);
test('精确批准、完整前态通过，未指定状态拒绝', () => {
  assert.equal(核验产品入口批准(json, patch).文件.length, 1);
  assert.equal(核验产品入口完整包(root, false), true);
  assert.throws(() => 核验产品入口完整包(root, true), /前后态/);
  assert.throws(() => 核验产品入口完整包(root), /明确/);
});
test('批准快照字节及部分修订篡改拒绝', () => {
  assert.throws(() => 核验产品入口批准(Buffer.concat([json, Buffer.from('\n')]), patch), /指纹/);
  assert.throws(() => 核验产品入口批准(json, Buffer.concat([patch, Buffer.from('\n')])), /指纹/);
  try { writeFileSync(target, delta.get(产品入口组合路径).产物.replace('if (id && !busy)', 'if (id)')); assert.throws(() => 核验产品入口完整包(root, true), /未知改动/); }
  finally { writeFileSync(target, baseline); }
});
test('先前产品工作区、SQLite服务及未知文件目录链接仍受保护', () => {
  for (const relative of ['画布副本/web/src/guan/产品工作区.tsx', '服务包/扩展功能/本机服务/数据服务.mjs']) {
    const file = join(root, relative), value = readFileSync(file);
    try { writeFileSync(file, Buffer.concat([value, Buffer.from('\n')])); assert.throws(() => 核验产品入口完整包(root, false), /范围外/); }
    finally { writeFileSync(file, value); }
  }
  const unknown = join(root, '合成未知项');
  writeFileSync(unknown, 'synthetic'); assert.throws(() => 核验产品入口完整包(root, false), /未知文件/); unlinkSync(unknown);
  mkdirSync(unknown); assert.throws(() => 核验产品入口完整包(root, false), /目录改变/); rmdirSync(unknown);
  symlinkSync(target, unknown); assert.throws(() => 核验产品入口完整包(root, false), /链接/); unlinkSync(unknown);
});
test('失败事务回退、全后态通过且既有批准字节保持', () => {
  const failed = join(home, '失败快照');
  assert.throws(() => 事务写入(root, delta, failed, { 差异指纹: 产品入口差异SHA256, 写后检查() { throw Error('synthetic'); } }), /synthetic/);
  assert.equal(JSON.parse(readFileSync(join(failed, '事务.json'))).状态, '已回退');
  assert.deepEqual(readFileSync(join(failed, '接入前', 产品入口组合路径)), baseline);
  核验产品入口完整包(root, false);
  事务写入(root, delta, join(home, '完成快照'), { 差异指纹: 产品入口差异SHA256, 写后检查() { 核验产品入口完整包(root, true); } });
  assert.equal(核验产品入口完整包(root, true), true);
  assert.equal(manifest.文件[0].文件, 'web/src/guan/画布入口.tsx');
  assert.deepEqual(readFileSync(join(根目录, '上游适配/待审查/产品入口创建竞态.json')), json);
  assert.deepEqual(readFileSync(join(根目录, '上游适配/待审查/产品入口创建竞态.patch')), patch);
});
