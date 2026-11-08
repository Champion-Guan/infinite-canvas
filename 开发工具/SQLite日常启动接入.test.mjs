import test from 'node:test';
import assert from 'node:assert/strict';
import { linkSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { 根目录 } from './公共.mjs';
import { 事务写入 } from './接入用户功能.mjs';
import { 日常启动批准产物, 读取日常启动复验记录, 核验日常启动完整源码 } from './接入SQLite日常启动隔离副本.mjs';
import { 核验日常启动批准, 读取日常启动批准, 日常启动前置指纹, 检查日常启动后继, 日常启动差异SHA256 } from '../上游适配/SQLite日常启动批准.mjs';
import { 检查配置合并后继 } from '../上游适配/SQLite配置合并批准.mjs';
import { 配置合并源码指纹 } from './接入SQLite配置合并隔离副本.mjs';

const { integration: previous, delta } = 日常启动批准产物('.运行/SQLite配置合并-CPXu7b/配置合并接入记录.json');
const prior = 日常启动前置指纹(), roots = [];
function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'guan-daily-approved-')), root = join(home, '副本'); mkdirSync(root); roots.push(home);
  for (const path of prior.keys()) { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), readFileSync(join(previous.副本, path))); }
  return { home, root };
}
function apply(f, options = {}) {
  assert.equal(检查日常启动后继(f.root), false);
  return 事务写入(f.root, delta, join(f.home, '快照'), { 差异指纹: 日常启动差异SHA256,
    写后检查() { assert.equal(检查日常启动后继(f.root), true); }, ...options });
}
test('批准精确3文件，历史待审查字节保持，JSON/patch任何漂移拒绝', () => {
  const json = readFileSync(join(根目录, '上游适配/待审查/SQLite日常启动.json')), patch = readFileSync(join(根目录, '上游适配/待审查/SQLite日常启动.patch'));
  assert.equal(delta.size, 3); assert.equal(读取日常启动批准().文件.length, 3); assert.match(读取日常启动批准().状态, /未批准/);
  assert.throws(() => 核验日常启动批准(Buffer.concat([json, Buffer.from(' ')]), patch), /指纹/);
  assert.throws(() => 核验日常启动批准(json, Buffer.concat([patch, Buffer.from(' ')])), /指纹/);
});
test('完整前后态和3文件事务通过，旧配置合并保护器继续拒绝新后继', () => {
  const f = fixture(); assert.equal(检查配置合并后继(f.root), true); apply(f);
  assert.equal(检查日常启动后继(f.root), true); assert.throws(() => 检查配置合并后继(f.root), /未知/);
  const journal = JSON.parse(readFileSync(join(f.home, '快照/事务.json')));
  assert.equal(journal.状态, '完成'); assert.equal(journal.文件.length, 3); assert.equal(journal.差异SHA256, 日常启动差异SHA256);
  for (const [path, value] of delta) assert.equal(readFileSync(join(f.root, path), 'utf8'), value.产物);
});
test('3文件逐个半批状态均拒绝，所有历史前置逐项漂移均拒绝', () => {
  const f = fixture();
  for (const [path, value] of delta) {
    writeFileSync(join(f.root, path), value.产物); assert.throws(() => 检查日常启动后继(f.root), /不完整/);
    if (value.原文 === null) unlinkSync(join(f.root, path)); else writeFileSync(join(f.root, path), value.原文);
  }
  apply(f);
  for (const path of new Set([...prior.keys(), ...delta.keys()])) {
    const target = join(f.root, path), original = readFileSync(target); writeFileSync(target, '未知改动');
    assert.throws(() => 检查日常启动后继(f.root), /未知/); writeFileSync(target, original);
  }
});
test('未知文件、目录、符号链接、硬链接及根链接均拒绝', () => {
  for (const kind of ['file', 'directory', 'symbolic', 'hard', 'root', 'dangling']) {
    const f = fixture(); apply(f); const target = join(f.root, [...delta.keys()][1]), external = join(f.home, '外部');
    if (kind === 'file') writeFileSync(join(f.root, '扩展功能/额外.mjs'), 'export{}');
    if (kind === 'directory') mkdirSync(join(f.root, '扩展功能/额外目录'));
    if (['symbolic', 'hard', 'dangling'].includes(kind)) {
      if (kind !== 'dangling') writeFileSync(external, readFileSync(target));
      unlinkSync(target); if (kind === 'hard') linkSync(external, target); else symlinkSync(external, target);
    }
    if (kind === 'root') { symlinkSync(f.root, external); assert.throws(() => 检查日常启动后继(external), /链接/); }
    else assert.throws(() => 检查日常启动后继(f.root), /链接|未知/);
  }
});
test('三个写入位置及写后检查故障均原样回退，新增文件撤回且快照保留', () => {
  for (const point of [0, 1, 2, 'after']) {
    const f = fixture();
    const options = point === 'after' ? { 写后检查() { throw Error('合成写后故障'); } } : { 写入前(path, index) { if (index === point) throw Error('合成写前故障'); } };
    assert.throws(() => apply(f, options), /合成/);
    assert.equal(检查日常启动后继(f.root), false); assert.equal(检查配置合并后继(f.root), true);
    assert.equal(JSON.parse(readFileSync(join(f.home, '快照/事务.json'))).状态, '已回退');
    assert.equal(readFileSync(join(f.home, '快照/接入前', [...delta.keys()][0]), 'utf8'), delta.values().next().value.原文);
  }
});
test('全源码核验拒绝批准模块外漂移，复验拒绝作者/日常/旧前置路径', () => {
  const f = fixture();
  for (const path of 配置合并源码指纹(previous.副本).keys()) {
    if (prior.has(path)) continue;
    mkdirSync(dirname(join(f.root, path)), { recursive: true }); writeFileSync(join(f.root, path), readFileSync(join(previous.副本, path)));
  }
  核验日常启动完整源码(f.root, false); apply(f); 核验日常启动完整源码(f.root, true);
  const target = join(f.root, 'web/package.json'), original = readFileSync(target); writeFileSync(target, '未知模块外漂移');
  assert.throws(() => 核验日常启动完整源码(f.root, true), /完整源码/); writeFileSync(target, original);
  writeFileSync(join(f.root, '未知根文件'), 'unknown'); assert.throws(() => 核验日常启动完整源码(f.root, true), /完整源码/);
  for (const path of [join(根目录, 'package.json'), join(根目录, '../infinite-canvas-upstream/package.json'), '.运行/SQLite配置合并-CPXu7b/配置合并接入记录.json']) {
    assert.throws(() => 读取日常启动复验记录(path), /只允许/);
  }
});
test.after(() => console.log(JSON.stringify({ retainedSyntheticRoots: roots, real3100TakenOver: false, realKeychainAccessed: false })));
