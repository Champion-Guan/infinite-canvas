import test from 'node:test';
import assert from 'node:assert/strict';
import { linkSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { 根目录 } from './公共.mjs';
import { SQLite批准产物 } from './接入SQLite隔离副本.mjs';
import { 节点存储批准产物 } from './接入SQLite节点存储隔离副本.mjs';
import { 检查SQLite批次 } from '../上游适配/SQLite全面替换批准.mjs';
import { 核验节点存储批准, 读取节点存储批准, 检查节点存储后继, 节点存储差异SHA256 } from '../上游适配/SQLite节点存储批准.mjs';
import { 事务写入 } from './接入用户功能.mjs';

const parent = SQLite批准产物(), { delta } = 节点存储批准产物();
const [path, item] = delta.entries().next().value;
function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'guan-stage6-node-approved-')), root = join(home, '副本'); mkdirSync(root);
  for (const [name, value] of parent) { mkdirSync(dirname(join(root, name)), { recursive: true }); writeFileSync(join(root, name), value.产物); }
  return { home, root };
}

test('1文件后继的批准指纹锁定，不覆盖原审批快照', () => {
  const json = readFileSync(join(根目录, '上游适配/待审查/SQLite节点存储惰性接入.json'));
  const patch = readFileSync(join(根目录, '上游适配/待审查/SQLite节点存储惰性接入.patch'));
  assert.equal(读取节点存储批准().状态, '待此1文件具体差异批准，未应用任何运行副本');
  assert.equal(delta.size, 1);
  assert.throws(() => 核验节点存储批准(Buffer.concat([json, Buffer.from(' ')]), patch), /指纹/);
  assert.throws(() => 核验节点存储批准(json, Buffer.concat([patch, Buffer.from(' ')])), /指纹/);
});

test('后继必须有完整25文件前置，不能接受浏览器版前态或半批', () => {
  const { root } = fixture(); assert.equal(检查节点存储后继(root), false);
  const [name, value] = [...parent].find(([name, value]) => name !== path && value.原文 !== null);
  writeFileSync(join(root, name), value.原文);
  assert.throws(() => 检查节点存储后继(root), /前置不完整/);
  writeFileSync(join(root, path), item.产物);
  assert.throws(() => 检查节点存储后继(root), /前置不完整/);
});

test('后继拒绝未知修改、符号链接与硬链接', () => {
  const { root, home } = fixture(); writeFileSync(join(root, path), '未知改动');
  assert.throws(() => 检查节点存储后继(root), /未知改动/);
  unlinkSync(join(root, path)); symlinkSync(join(home, '不存在'), join(root, path));
  assert.throws(() => 检查节点存储后继(root), /符号链接/);
  unlinkSync(join(root, path)); writeFileSync(join(home, '外部'), item.原文); linkSync(join(home, '外部'), join(root, path));
  assert.throws(() => 检查节点存储后继(root), /硬链接/);
});

test('后继事务失败恢复完整25文件原后态，快照与失败证据保留', () => {
  const { root, home } = fixture(), snapshot = join(home, '快照');
  assert.throws(() => 事务写入(root, delta, snapshot, { 差异指纹: 节点存储差异SHA256, 写后检查() { throw Error('合成故障'); } }), /合成故障/);
  assert.equal(检查节点存储后继(root), false); assert.equal(检查SQLite批次(root), true);
  assert.equal(readFileSync(join(root, path), 'utf8'), item.原文);
  assert.equal(JSON.parse(readFileSync(join(snapshot, '事务.json'))).状态, '已回退');
});

test('后继事务成功只替换1文件，原25文件批准器仍拒绝新后态', () => {
  const { root, home } = fixture(), snapshot = join(home, '快照');
  事务写入(root, delta, snapshot, { 差异指纹: 节点存储差异SHA256, 写后检查() { assert.equal(检查节点存储后继(root), true); } });
  assert.equal(检查节点存储后继(root), true);
  assert.throws(() => 检查SQLite批次(root), /未知改动/);
  for (const [name, value] of parent) if (name !== path) assert.equal(readFileSync(join(root, name), 'utf8'), value.产物);
  assert.equal(readFileSync(join(snapshot, '接入前', path), 'utf8'), item.原文);
  const journal = JSON.parse(readFileSync(join(snapshot, '事务.json')));
  assert.equal(journal.状态, '完成'); assert.equal(journal.文件.length, 1); assert.equal(journal.差异SHA256, 节点存储差异SHA256);
});
