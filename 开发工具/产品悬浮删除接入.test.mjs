import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { 根目录 } from './公共.mjs';
import { 事务写入 } from './接入用户功能.mjs';
import { 产品删除前置记录 } from './预审产品悬浮删除.mjs';
import { 读取产品入口隔离记录 } from './接入产品入口竞态隔离副本.mjs';
import { 读取产品删除批准, 核验产品删除批准, 产品删除差异SHA256 } from '../上游适配/产品悬浮删除批准.mjs';
import { 产品删除批准产物, 核验产品删除完整包 } from './接入产品悬浮删除隔离副本.mjs';

const previous = 读取产品入口隔离记录(产品删除前置记录), manifest = 读取产品删除批准();
const home = mkdtempSync(join(根目录, '.运行/产品删除保护测试-')), root = join(home, '组合包');
cpSync(previous.组合包, root, { recursive: true, dereference: false, verbatimSymlinks: true, errorOnExist: true, force: false });
const json = readFileSync(join(根目录, '上游适配/待审查/产品悬浮删除十文件.json'));
const patch = readFileSync(join(根目录, '上游适配/待审查/产品悬浮删除十文件.patch'));
const delta = 产品删除批准产物();
test('十文件精确批准、全前态通过，后态和未指定状态拒绝', () => {
  assert.equal(核验产品删除批准(json, patch).文件.length, 10);
  assert.equal(核验产品删除完整包(root, false), true);
  assert.throws(() => 核验产品删除完整包(root, true), /前后态/);
  assert.throws(() => 核验产品删除完整包(root), /明确/);
});
test('批准字节改动和半批接入都拒绝', () => {
  assert.throws(() => 核验产品删除批准(Buffer.concat([json, Buffer.from('\n')]), patch), /指纹/);
  assert.throws(() => 核验产品删除批准(json, Buffer.concat([patch, Buffer.from('\n')])), /指纹/);
  const path = '画布副本/web/src/guan/顶部产品胶囊.tsx', file = join(root, path), before = readFileSync(file);
  try {
    writeFileSync(file, delta.get(path).产物);
    assert.throws(() => 核验产品删除完整包(root, false), /前后态/);
    assert.throws(() => 核验产品删除完整包(root, true), /前后态/);
    writeFileSync(file, 'synthetic'); assert.throws(() => 核验产品删除完整包(root, false), /未知改动/);
  } finally { writeFileSync(file, before); }
});
test('历史产品和SQLite服务、未知文件目录链接全部受保护', () => {
  for (const relative of ['画布副本/web/src/guan/产品工作区.tsx', '服务包/扩展功能/本机服务/数据服务.mjs']) {
    const file = join(root, relative), value = readFileSync(file);
    try { writeFileSync(file, Buffer.concat([value, Buffer.from('\n')])); assert.throws(() => 核验产品删除完整包(root, false), /范围外/); }
    finally { writeFileSync(file, value); }
  }
  const unknown = join(root, '合成未知项');
  writeFileSync(unknown, 'synthetic'); assert.throws(() => 核验产品删除完整包(root, false), /未知文件/); unlinkSync(unknown);
  mkdirSync(unknown); assert.throws(() => 核验产品删除完整包(root, false), /目录改变/); rmdirSync(unknown);
  symlinkSync(join(root, '画布副本/web/src/guan/顶部产品胶囊.tsx'), unknown); assert.throws(() => 核验产品删除完整包(root, false), /链接/); unlinkSync(unknown);
});
test('十文件写入中断及写后检查失败均原态回退，新增文件也撤回', () => {
  assert.throws(() => 事务写入(root, delta, join(home, '半途失败快照'), {
    差异指纹: 产品删除差异SHA256, 写入前(path, count) { if (count === 5) throw Error('synthetic-interruption'); },
  }), /synthetic-interruption/);
  核验产品删除完整包(root, false);
  assert.throws(() => 事务写入(root, delta, join(home, '写后失败快照'), {
    差异指纹: 产品删除差异SHA256, 写后检查() { throw Error('synthetic-postcheck'); },
  }), /synthetic-postcheck/);
  核验产品删除完整包(root, false);
});
test('十文件完整事务后态通过，原快照和历史批准不改', () => {
  const snapshot = join(home, '完成快照');
  事务写入(root, delta, snapshot, { 差异指纹: 产品删除差异SHA256, 写后检查() { 核验产品删除完整包(root, true); } });
  assert.equal(核验产品删除完整包(root, true), true);
  const journal = JSON.parse(readFileSync(join(snapshot, '事务.json')));
  assert.equal(journal.状态, '完成'); assert.equal(journal.文件.length, 10);
  assert.equal(manifest.文件.filter(item => item.原始SHA256 === null).length, 2);
  for (const item of manifest.文件.filter(item => item.原始SHA256 !== null))
    assert.deepEqual(readFileSync(join(snapshot, '接入前/画布副本', item.文件)), readFileSync(join(previous.副本, item.文件)));
  assert.deepEqual(readFileSync(join(根目录, '上游适配/待审查/产品悬浮删除十文件.json')), json);
  assert.deepEqual(readFileSync(join(根目录, '上游适配/待审查/产品悬浮删除十文件.patch')), patch);
});
