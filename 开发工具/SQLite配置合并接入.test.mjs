import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { 根目录 } from './公共.mjs';
import { 构建凭据接入候选 } from './预审SQLite凭据接入.mjs';
import { 事务写入 } from './接入用户功能.mjs';
import { 配置合并批准产物, 读取配置合并复验记录 } from './接入SQLite配置合并隔离副本.mjs';
import { 检查凭据接入后继 } from '../上游适配/SQLite凭据接入批准.mjs';
import { 媒体启动器依赖 } from '../上游适配/SQLite临时媒体策略批准.mjs';
import { 核验配置合并批准, 读取配置合并批准, 检查配置合并后继, 配置合并前置指纹, 配置合并路径, 配置合并差异SHA256 } from '../上游适配/SQLite配置合并批准.mjs';

const candidate = 构建凭据接入候选(), files = new Map(媒体启动器依赖().map(item => [item.文件, { 产物: readFileSync(join(根目录, item.文件)) }]));
for (const map of [candidate.prerequisite, candidate.delta]) for (const [path, value] of map) files.set(path, value);
const delta = 配置合并批准产物();
function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'guan-config-approved-')), root = join(home, '副本'); mkdirSync(root);
  for (const [path, item] of files) { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), item.产物); }
  return { home, root };
}
function apply(f, overrides = {}) {
  assert.equal(检查配置合并后继(f.root), false);
  return 事务写入(f.root, delta, join(f.home, '快照'), { 差异指纹: 配置合并差异SHA256, 写后检查() { assert.equal(检查配置合并后继(f.root), true); }, ...overrides });
}
test('配置合并精确批准1文件，不改历史JSON/patch状态或指纹', () => {
  const json = readFileSync(join(根目录, '上游适配/待审查/SQLite配置合并保存.json')), patch = readFileSync(join(根目录, '上游适配/待审查/SQLite配置合并保存.patch'));
  assert.equal(读取配置合并批准().文件.length, 1); assert.match(读取配置合并批准().状态, /待用户批准/);
  assert.equal(delta.size, 1); assert.throws(() => 核验配置合并批准(Buffer.concat([json, Buffer.from(' ')]), patch), /指纹/);
  assert.throws(() => 核验配置合并批准(json, Buffer.concat([patch, Buffer.from(' ')])), /指纹/);
});
test('配置合并只接受完整10文件前置或精确1文件后继，旧保护器保持拒绝', () => {
  const f = fixture(); assert.equal(检查凭据接入后继(f.root), true); apply(f);
  assert.equal(检查配置合并后继(f.root), true); assert.throws(() => 检查凭据接入后继(f.root), /未知/);
  assert.equal(readFileSync(join(f.root, 配置合并路径), 'utf8'), delta.get(配置合并路径).产物);
  const journal = JSON.parse(readFileSync(join(f.home, '快照/事务.json')));
  assert.equal(journal.文件.length, 1); assert.equal(journal.状态, '完成'); assert.equal(journal.差异SHA256, 配置合并差异SHA256);
});
test('配置合并逐项核验全部历史文件，不接受缺失或额外模块', () => {
  const f = fixture(); apply(f);
  for (const path of 配置合并前置指纹().keys()) {
    const target = join(f.root, path), original = readFileSync(target); writeFileSync(target, '未知');
    assert.throws(() => 检查配置合并后继(f.root), /未知/); writeFileSync(target, original);
  }
  const target = join(f.root, 配置合并路径); unlinkSync(target); assert.throws(() => 检查配置合并后继(f.root), /缺失|未知/);
  writeFileSync(target, delta.get(配置合并路径).产物);
  writeFileSync(join(f.root, 'web/src/guan/sqlite/额外.mjs'), 'export{}'); assert.throws(() => 检查配置合并后继(f.root), /未知/);
});
test('符号链接、硬链接、额外目录与根链接拒绝', () => {
  for (const kind of ['symbolic', 'hard', 'directory', 'root']) {
    const f = fixture(); apply(f); const target = join(f.root, 配置合并路径), external = join(f.home, '外部');
    if (kind === 'symbolic' || kind === 'hard') { writeFileSync(external, readFileSync(target)); unlinkSync(target); if (kind === 'symbolic') symlinkSync(external, target); else linkSync(external, target); }
    if (kind === 'directory') mkdirSync(join(f.root, '扩展功能/未知目录'));
    if (kind === 'root') { symlinkSync(f.root, external); assert.throws(() => 检查配置合并后继(external), /链接/); }
    else assert.throws(() => 检查配置合并后继(f.root), /链接|未知/);
  }
});
test('写入前和写后故障均回退，保留原态快照且不碰历史源码', () => {
  for (const point of ['before', 'after']) {
    const f = fixture(); assert.throws(() => apply(f, point === 'before' ? { 写入前() { throw Error('合成写前故障'); } } : { 写后检查() { throw Error('合成写后故障'); } }), /合成/);
    assert.equal(检查配置合并后继(f.root), false); assert.equal(检查凭据接入后继(f.root), true);
    assert.equal(JSON.parse(readFileSync(join(f.home, '快照/事务.json'))).状态, '已回退');
    assert.equal(readFileSync(join(f.home, '快照/接入前', 配置合并路径), 'utf8'), delta.get(配置合并路径).原文);
  }
});
test('复验拒绝日常、作者与凭据旧记录路径，不写入这些路径', () => {
  for (const path of [join(根目录, 'package.json'), join(根目录, '../infinite-canvas-upstream/package.json'), join(根目录, '.运行/SQLite完整界面-gyAu5M/凭据接入记录.json')]) {
    assert.ok(existsSync(path) || path.includes('upstream')); assert.throws(() => 读取配置合并复验记录(path), /只允许/);
  }
});
