import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, unlinkSync, symlinkSync, linkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { 根目录 } from './公共.mjs';
import { 构建分片候选 } from './预审SQLite分片存储.mjs';
import { 分片存储批准产物 } from './接入SQLite分片隔离副本.mjs';
import { 事务写入 } from './接入用户功能.mjs';
import { 媒体启动器路径, 媒体启动器依赖 } from '../上游适配/SQLite临时媒体策略批准.mjs';
import { 检查保存恢复后继 } from '../上游适配/SQLite保存恢复批准.mjs';
import { 核验分片存储批准, 读取分片存储批准, 检查分片存储后继, 核验分片存储自有依赖, 分片存储差异SHA256 } from '../上游适配/SQLite分片存储批准.mjs';

const delta = 分片存储批准产物(), { prerequisite } = 构建分片候选();
function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'guan-sharded-approved-')), root = join(home, '副本'); mkdirSync(root);
  const files = new Map(prerequisite);
  for (const item of 媒体启动器依赖()) files.set(item.文件, { 产物: readFileSync(join(根目录, item.文件)) });
  for (const [path, value] of files) { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), value.产物); }
  return { home, root };
}
function apply(f, options = {}) {
  assert.equal(检查分片存储后继(f.root), false);
  return 事务写入(f.root, delta, join(f.home, '快照'), { 差异指纹: 分片存储差异SHA256, 写后检查() { assert.equal(检查分片存储后继(f.root), true); }, ...options });
}
test('分片4文件批准原字节和自有来源锁定，不覆盖历史待批说明', () => {
  const json = readFileSync(join(根目录, '上游适配/待审查/SQLite分片存储.json')), patch = readFileSync(join(根目录, '上游适配/待审查/SQLite分片存储.patch'));
  assert.equal(读取分片存储批准().文件.length, 4); assert.match(读取分片存储批准().状态, /待用户批准/); 核验分片存储自有依赖(根目录);
  assert.throws(() => 核验分片存储批准(Buffer.concat([json, Buffer.from(' ')]), patch), /指纹/);
  assert.throws(() => 核验分片存储批准(json, Buffer.concat([patch, Buffer.from(' ')])), /指纹/);
});
test('分片只接受全部前置和4文件全前或全后，保存恢复历史保护器不放宽', () => {
  const f = fixture(); assert.equal(检查分片存储后继(f.root), false); assert.equal(检查保存恢复后继(f.root), true);
  apply(f); assert.equal(检查分片存储后继(f.root), true); assert.throws(() => 检查保存恢复后继(f.root), /未知改动/);
  for (const [path, item] of delta) assert.equal(readFileSync(join(f.root, path), 'utf8'), item.产物);
});
test('分片每个单文件后态、缺失和未知内容均拒绝', () => {
  for (const [path, item] of delta) {
    const f = fixture(); mkdirSync(dirname(join(f.root, path)), { recursive: true }); writeFileSync(join(f.root, path), item.产物);
    assert.throws(() => 检查分片存储后继(f.root), /不完整/);
    writeFileSync(join(f.root, path), '未知'); assert.throws(() => 检查分片存储后继(f.root), /未知/);
    const g = fixture(); apply(g); unlinkSync(join(g.root, path)); assert.throws(() => 检查分片存储后继(g.root), /不完整|未知/);
  }
});
test('分片核验每个历史前置文件以及全部启动器依赖', () => {
  const files = new Set([...prerequisite.keys(), 媒体启动器路径, ...媒体启动器依赖().map(item => item.文件)]);
  for (const path of files) {
    const f = fixture(); writeFileSync(join(f.root, path), '未知');
    assert.throws(() => 检查分片存储后继(f.root), /前置不完整|依赖不完整|未知改动/);
  }
});
test('分片拒绝额外模块、目录、缺依赖、符号链接、硬链接与根链接', () => {
  for (const kind of ['file', 'directory', 'missing', 'symbolic', 'hard', 'parent', 'root']) {
    const f = fixture(); apply(f);
    if (kind === 'file') writeFileSync(join(f.root, 'web/src/guan/sqlite/额外.mjs'), 'export{}');
    if (kind === 'directory') mkdirSync(join(f.root, '扩展功能/额外目录'));
    if (kind === 'missing') unlinkSync(join(f.root, 媒体启动器依赖()[0].文件));
    if (kind === 'symbolic' || kind === 'hard') {
      const path = join(f.root, 'web/src/guan/sqlite/分片值编码.mjs'), external = join(f.home, '外部'); writeFileSync(external, readFileSync(path)); unlinkSync(path);
      if (kind === 'symbolic') symlinkSync(external, path); else linkSync(external, path);
    }
    if (kind === 'parent') symlinkSync(f.home, join(f.root, 'web/src/guan/sqlite/外部目录'));
    if (kind === 'root') { const link = join(f.home, '根链接'); symlinkSync(f.root, link); assert.throws(() => 检查分片存储后继(link), /链接/); }
    else assert.throws(() => 检查分片存储后继(f.root), /未知|不完整|链接/);
  }
});
test('分片四个写边界与写后故障完整回退，成功保留4文件事务记录', () => {
  for (const point of [0, 1, 2, 3, 'after']) {
    const f = fixture();
    assert.throws(() => apply(f, point === 'after' ? { 写后检查() { throw Error('合成写后故障'); } } : { 写入前(_path, count) { if (count === point) throw Error('合成中途故障'); } }), /合成/);
    assert.equal(检查分片存储后继(f.root), false); assert.equal(检查保存恢复后继(f.root), true);
    for (const [path, item] of delta) if (item.原文 === null) assert.equal(existsSync(join(f.root, path)), false); else assert.equal(readFileSync(join(f.root, path), 'utf8'), item.原文);
    assert.equal(JSON.parse(readFileSync(join(f.home, '快照/事务.json'))).状态, '已回退');
  }
  const f = fixture(); apply(f); const journal = JSON.parse(readFileSync(join(f.home, '快照/事务.json')));
  assert.equal(journal.状态, '完成'); assert.equal(journal.文件.length, 4); assert.equal(journal.差异SHA256, 分片存储差异SHA256);
  for (const [path, item] of delta) if (item.原文 !== null) assert.equal(readFileSync(join(f.home, '快照/接入前', path), 'utf8'), item.原文);
});
