import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, symlinkSync, linkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { 根目录 } from './公共.mjs';
import { 媒体策略批准产物 } from './接入SQLite临时媒体隔离启动器.mjs';
import { 事务写入 } from './接入用户功能.mjs';
import { 核验媒体策略批准, 读取媒体策略批准, 媒体启动器路径, 媒体启动器依赖, 检查媒体启动器包, 媒体策略差异SHA256 } from '../上游适配/SQLite临时媒体策略批准.mjs';
import { 核验授权入口自有依赖 } from '../上游适配/SQLite工作台授权入口批准.mjs';

const delta = 媒体策略批准产物();
function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'guan-media-approved-')), root = join(home, '启动器包'); mkdirSync(root);
  for (const path of [媒体启动器路径, ...媒体启动器依赖().map(item => item.文件)]) {
    mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), readFileSync(join(根目录, path)));
  }
  return { root, home };
}
function apply(f, options = {}) { return 事务写入(f.root, delta, join(f.home, '快照'), { 差异指纹: 媒体策略差异SHA256, 写后检查() { assert.equal(检查媒体启动器包(f.root), true); }, ...options }); }

test('批准只锁定一行媒体策略，原9文件批准依赖及历史JSON/patch不变', () => {
  const json = readFileSync(join(根目录, '上游适配/待审查/SQLite临时媒体策略.json')), patch = readFileSync(join(根目录, '上游适配/待审查/SQLite临时媒体策略.patch'));
  assert.equal(读取媒体策略批准().文件.length, 1); 核验授权入口自有依赖(根目录);
  assert.throws(() => 核验媒体策略批准(Buffer.concat([json, Buffer.from(' ')]), patch), /指纹/);
  assert.throws(() => 核验媒体策略批准(json, Buffer.concat([patch, Buffer.from(' ')])), /指纹/);
});
test('只有完整依赖加精确前/后态可用，未知内容和缺失依赖拒绝', () => {
  const f = fixture(); assert.equal(检查媒体启动器包(f.root), false); apply(f); assert.equal(检查媒体启动器包(f.root), true);
  writeFileSync(join(f.root, 媒体启动器路径), '未知'); assert.throws(() => 检查媒体启动器包(f.root), /未知/);
  const g = fixture(); unlinkSync(join(g.root, 媒体启动器依赖()[0].文件)); assert.throws(() => 检查媒体启动器包(g.root), /不完整/);
});
test('拒绝包中额外文件、目录、符号/硬链接及根目录链接', () => {
  for (const kind of ['file', 'directory', 'symbolic', 'hard', 'root']) {
    const f = fixture();
    if (kind === 'file') writeFileSync(join(f.root, '额外.mjs'), 'export{}');
    if (kind === 'directory') mkdirSync(join(f.root, '额外目录'));
    if (kind === 'symbolic' || kind === 'hard') {
      const path = join(f.root, 媒体启动器路径), external = join(f.home, '外部'); writeFileSync(external, readFileSync(path)); unlinkSync(path);
      if (kind === 'symbolic') symlinkSync(external, path); else linkSync(external, path);
    }
    if (kind === 'root') { const link = join(f.home, '链接'); symlinkSync(f.root, link); assert.throws(() => 检查媒体启动器包(link), /链接/); }
    else assert.throws(() => 检查媒体启动器包(f.root), /未知|链接/);
  }
});
test('写前失败或写后检查失败完整回退；成功保留前态快照和精确日志', () => {
  for (const point of ['before', 'after']) {
    const f = fixture(); assert.throws(() => apply(f, point === 'before' ? { 写入前() { throw Error('合成写前故障'); } } : { 写后检查() { throw Error('合成写后故障'); } }), /合成/);
    assert.equal(检查媒体启动器包(f.root), false); assert.equal(JSON.parse(readFileSync(join(f.home, '快照/事务.json'))).状态, '已回退');
  }
  const f = fixture(); apply(f); const journal = JSON.parse(readFileSync(join(f.home, '快照/事务.json')));
  assert.equal(journal.状态, '完成'); assert.equal(journal.文件.length, 1); assert.equal(journal.差异SHA256, 媒体策略差异SHA256);
  assert.equal(readFileSync(join(f.home, '快照/接入前', 媒体启动器路径), 'utf8'), delta.get(媒体启动器路径).原文);
});
