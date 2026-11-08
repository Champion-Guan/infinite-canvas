import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { 根目录 } from './公共.mjs';
import { SQLite批准产物 } from './接入SQLite隔离副本.mjs';
import { 事务写入 } from './接入用户功能.mjs';
import { 检查SQLite批次, 读取SQLite批准, 核验SQLite批准, SQLite安全指纹, SQLite差异SHA256 } from '../上游适配/SQLite全面替换批准.mjs';

const files = SQLite批准产物();
function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'guan-stage6-approved-'));
  const root = join(home, '副本'); mkdirSync(root);
  for (const [path, item] of files) if (item.原文 !== null) {
    mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), item.原文);
  }
  return { home, root };
}

test('25文件批准指纹与自有依赖精确核验，不覆盖审批前历史快照', () => {
  const json = readFileSync(join(根目录, '上游适配/待审查/SQLite全面替换.json'));
  const patch = readFileSync(join(根目录, '上游适配/待审查/SQLite全面替换.patch'));
  assert.equal(读取SQLite批准().文件.length, 25);
  assert.equal(读取SQLite批准().状态, '待具体差异批准，禁止应用或重启');
  assert.throws(() => 核验SQLite批准(Buffer.concat([json, Buffer.from(' ')]), patch), /指纹/);
  assert.throws(() => 核验SQLite批准(json, Buffer.concat([patch, Buffer.from(' ')])), /指纹/);
});

test('批次只接受完整前态和后态，半批、未知修改、链接与路径逃逸拒绝', () => {
  const { root } = fixture();
  assert.equal(检查SQLite批次(root), false);
  const [path, item] = files.entries().next().value;
  writeFileSync(join(root, path), item.产物);
  assert.throws(() => 检查SQLite批次(root), /不完整/);
  for (const [name, value] of files) { mkdirSync(dirname(join(root, name)), { recursive: true }); writeFileSync(join(root, name), value.产物); }
  assert.equal(检查SQLite批次(root), true);
  writeFileSync(join(root, path), '未知改动'); assert.throws(() => 检查SQLite批次(root), /未知改动/);
  unlinkSync(join(root, path)); symlinkSync(join(root, 'web/src/main.tsx'), join(root, path));
  assert.throws(() => 检查SQLite批次(root), /符号链接/);
  assert.throws(() => SQLite安全指纹(root, '../外部'), /逃逸/);
});

test('25文件事务失败完整恢复，新增入口移除且事务证据保留', () => {
  const { root, home } = fixture(), snapshot = join(home, '快照');
  assert.throws(() => 事务写入(root, files, snapshot, { 差异指纹: SQLite差异SHA256, 写后检查() { throw Error('合成故障'); } }), /合成故障/);
  assert.equal(检查SQLite批次(root), false);
  for (const [path, item] of files) {
    if (item.原文 === null) assert.equal(existsSync(join(root, path)), false);
    else assert.equal(readFileSync(join(root, path), 'utf8'), item.原文);
  }
  assert.equal(JSON.parse(readFileSync(join(snapshot, '事务.json'))).状态, '已回退');
});

test('25文件完整事务成功，保留原始文件及批准指纹', () => {
  const { root, home } = fixture(), snapshot = join(home, '快照');
  事务写入(root, files, snapshot, { 差异指纹: SQLite差异SHA256, 写后检查() { assert.equal(检查SQLite批次(root), true); } });
  assert.equal(检查SQLite批次(root), true);
  const journal = JSON.parse(readFileSync(join(snapshot, '事务.json')));
  assert.equal(journal.状态, '完成'); assert.equal(journal.文件.length, 25); assert.equal(journal.差异SHA256, SQLite差异SHA256);
  for (const [path, item] of files) if (item.原文 !== null) assert.equal(readFileSync(join(snapshot, '接入前', path), 'utf8'), item.原文);
});
