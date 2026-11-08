import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, unlinkSync, symlinkSync, linkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { 根目录 } from './公共.mjs';
import { 授权入口批准产物 } from './接入SQLite工作台授权隔离副本.mjs';
import { 事务写入 } from './接入用户功能.mjs';
import { 核验授权入口批准, 读取授权入口批准, 核验授权入口自有依赖, 检查授权入口后继, 授权入口差异SHA256 } from '../上游适配/SQLite工作台授权入口批准.mjs';
import { 检查启动存储后继 } from '../上游适配/SQLite启动存储批准.mjs';

const { delta, prerequisite, combined } = 授权入口批准产物();
function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'guan-stage6-entry-approved-')), root = join(home, '副本'); mkdirSync(root);
  for (const [path, value] of prerequisite) { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), value.产物); }
  return { home, root };
}
function apply(root, home, options = {}) {
  return 事务写入(root, delta, join(home, '快照'), { 差异指纹: 授权入口差异SHA256, 写后检查() { assert.equal(检查授权入口后继(root), true); }, ...options });
}
test('9文件批准锁定复审JSON/patch及全部自有依赖，历史待批状态快照不覆盖', () => {
  const json = readFileSync(join(根目录, '上游适配/待审查/SQLite工作台授权入口复审.json')), patch = readFileSync(join(根目录, '上游适配/待审查/SQLite工作台授权入口复审.patch'));
  assert.equal(读取授权入口批准().文件.length, 9); assert.match(读取授权入口批准().状态, /^待具体9文件/);
  核验授权入口自有依赖(根目录);
  assert.throws(() => 核验授权入口批准(Buffer.concat([json, Buffer.from(' ')]), patch), /指纹/);
  assert.throws(() => 核验授权入口批准(json, Buffer.concat([patch, Buffer.from(' ')])), /指纹/);
});
test('只接受完整启动前置及全9文件前/后态，不接受半批', () => {
  const { root, home } = fixture(); assert.equal(检查授权入口后继(root), false); assert.equal(检查启动存储后继(root), true);
  writeFileSync(join(root, 'web/index.html'), delta.get('web/index.html').产物);
  assert.throws(() => 检查授权入口后继(root), /不完整/);
  writeFileSync(join(root, 'web/index.html'), delta.get('web/index.html').原文); apply(root, home);
  assert.equal(检查授权入口后继(root), true);
  assert.throws(() => 检查启动存储后继(root), /未知修改/); // 历史保护器没有被放宽。
});
test('25文件、节点修正和路由临时状态的未知改动全部拒绝', () => {
  for (const path of ['web/src/main.tsx', 'web/src/lib/canvas/canvas-event-bus.ts', 'web/src/router.tsx', 'web/src/guan/路由临时状态.ts']) {
    const { root } = fixture(); writeFileSync(join(root, path), '合成未知改动');
    assert.throws(() => 检查授权入口后继(root), /前置不完整或未知/);
  }
});
test('授权模块目录拒绝未知文件和目录，不假装缺文件为完整后态', () => {
  for (const kind of ['file', 'directory', 'missing']) {
    const { root, home } = fixture(); apply(root, home);
    const directory = join(root, 'web/src/guan/sqlite');
    if (kind === 'file') writeFileSync(join(directory, '未知.mjs'), 'export{}');
    if (kind === 'directory') mkdirSync(join(directory, '未知目录'));
    if (kind === 'missing') unlinkSync(join(directory, '协议.mjs'));
    assert.throws(() => 检查授权入口后继(root), /未知|不完整/);
  }
});
test('文件或父目录符号链接、硬链接均拒绝', () => {
  for (const kind of ['symbolic', 'hard', 'parent']) {
    const { root, home } = fixture(); apply(root, home);
    if (kind === 'parent') {
      const linked = join(home, '目录链接'); symlinkSync(root, linked);
      assert.throws(() => 检查授权入口后继(linked), /符号链接/); continue;
    }
    const file = join(root, 'web/src/guan/sqlite/协议.mjs'), external = join(home, '外部');
    writeFileSync(external, readFileSync(file)); unlinkSync(file);
    if (kind === 'symbolic') symlinkSync(external, file); else linkSync(external, file);
    assert.throws(() => 检查授权入口后继(root), /链接/);
  }
});
test('第四次事务中途失败和后检查失败均完整回退，保留原HTML及快照', () => {
  for (const point of ['midway', 'postcheck']) {
    const { root, home } = fixture();
    assert.throws(() => apply(root, home, point === 'midway' ? { 写入前(_path, count) { if (count === 4) throw Error('合成中途故障'); } } : { 写后检查() { throw Error('合成写后故障'); } }), /合成/);
    assert.equal(检查授权入口后继(root), false); assert.equal(检查启动存储后继(root), true);
    assert.equal(readFileSync(join(root, 'web/index.html'), 'utf8'), delta.get('web/index.html').原文);
    for (const [path, item] of delta) if (item.原文 === null) assert.equal(existsSync(join(root, path)), false);
    assert.equal(JSON.parse(readFileSync(join(home, '快照/事务.json'))).状态, '已回退');
  }
});
test('事务成功保留9文件精确记录和HTML原快照，完整所有前置产物不变', () => {
  const { root, home } = fixture(); apply(root, home);
  for (const [path, item] of combined) assert.equal(readFileSync(join(root, path), 'utf8'), item.产物);
  const journal = JSON.parse(readFileSync(join(home, '快照/事务.json')));
  assert.equal(journal.文件.length, 9); assert.equal(journal.差异SHA256, 授权入口差异SHA256); assert.equal(journal.状态, '完成');
  assert.equal(readFileSync(join(home, '快照/接入前/web/index.html'), 'utf8'), delta.get('web/index.html').原文);
});
