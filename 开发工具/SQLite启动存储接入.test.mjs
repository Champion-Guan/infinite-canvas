import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { 根目录 } from './公共.mjs';
import { 启动存储批准产物 } from './接入SQLite启动存储隔离副本.mjs';
import { 检查节点存储后继 } from '../上游适配/SQLite节点存储批准.mjs';
import { 核验启动存储批准, 读取启动存储批准, 检查启动存储后继, 核验启动存储自有依赖, 启动存储差异SHA256 } from '../上游适配/SQLite启动存储批准.mjs';
import { 事务写入 } from './接入用户功能.mjs';

const { delta, combined } = 启动存储批准产物();
function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'guan-stage6-start-approved-')), root = join(home, '副本'); mkdirSync(root);
  for (const [path, value] of combined) {
    const content = delta.has(path) ? value.原文 : value.产物;
    if (content === null) continue;
    mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), content);
  }
  return { home, root };
}

test('3文件批准锁定JSON/patch及自有路由源码，不覆盖历史待批快照', () => {
  const json = readFileSync(join(根目录, '上游适配/待审查/SQLite启动存储隔离.json')), patch = readFileSync(join(根目录, '上游适配/待审查/SQLite启动存储隔离.patch'));
  assert.equal(读取启动存储批准().文件.length, 3); assert.equal(delta.size, 3);
  assert.match(读取启动存储批准().状态, /^待具体3文件/);
  核验启动存储自有依赖(根目录);
  assert.throws(() => 核验启动存储批准(Buffer.concat([json, Buffer.from(' ')]), patch), /指纹/);
  assert.throws(() => 核验启动存储批准(json, Buffer.concat([patch, Buffer.from(' ')])), /指纹/);
});

test('启动后继必须有完整25文件和节点修正，新增3文件不能半批', () => {
  const { root } = fixture(); assert.equal(检查启动存储后继(root), false);
  const path = 'web/src/lib/canvas/canvas-event-bus.ts', node = combined.get(path);
  writeFileSync(join(root, path), node.原文);
  assert.throws(() => 检查启动存储后继(root), /前置不完整|完整后继/);
  writeFileSync(join(root, path), node.产物);
  writeFileSync(join(root, 'web/index.html'), delta.get('web/index.html').产物);
  assert.throws(() => 检查启动存储后继(root), /不完整/);
});

test('启动后继拒绝未知改动、符号链接与硬链接', () => {
  for (const type of ['unknown', 'symbolic', 'hard']) {
    const { root, home } = fixture(), path = join(root, 'web/index.html');
    if (type === 'unknown') writeFileSync(path, '未知内容');
    else { unlinkSync(path); const external = join(home, '外部'); writeFileSync(external, delta.get('web/index.html').原文); if (type === 'symbolic') symlinkSync(external, path); else linkSync(external, path); }
    assert.throws(() => 检查启动存储后继(root), /未知修改|符号链接|硬链接/);
  }
});

test('第三次事务中途失败恢复全部原态及前置，未出现新增文件', () => {
  const { root, home } = fixture(), snapshot = join(home, '快照');
  assert.throws(() => 事务写入(root, delta, snapshot, { 差异指纹: 启动存储差异SHA256, 写入前(_path, count) { if (count === 2) throw Error('合成中途故障'); } }), /合成中途故障/);
  assert.equal(检查启动存储后继(root), false); assert.equal(检查节点存储后继(root), true);
  assert.equal(existsSync(join(root, 'web/src/guan/路由临时状态.ts')), false);
  for (const [path, item] of delta) if (item.原文 !== null) assert.equal(readFileSync(join(root, path), 'utf8'), item.原文);
  assert.equal(JSON.parse(readFileSync(join(snapshot, '事务.json'))).状态, '已回退');
});

test('第三次事务成功只应用精确3文件，保留快照及全部前置产物', () => {
  const { root, home } = fixture(), snapshot = join(home, '快照');
  事务写入(root, delta, snapshot, { 差异指纹: 启动存储差异SHA256, 写后检查() { assert.equal(检查启动存储后继(root), true); } });
  assert.equal(检查节点存储后继(root), true);
  for (const [path, item] of combined) assert.equal(readFileSync(join(root, path), 'utf8'), item.产物);
  const journal = JSON.parse(readFileSync(join(snapshot, '事务.json')));
  assert.equal(journal.状态, '完成'); assert.equal(journal.文件.length, 3); assert.equal(journal.差异SHA256, 启动存储差异SHA256);
  assert.equal(readFileSync(join(snapshot, '接入前/web/src/router.tsx'), 'utf8'), delta.get('web/src/router.tsx').原文);
});
