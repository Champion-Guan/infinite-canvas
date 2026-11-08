import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, unlinkSync, symlinkSync, linkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { 根目录 } from './公共.mjs';
import { 授权入口批准产物 } from './接入SQLite工作台授权隔离副本.mjs';
import { 媒体策略批准产物 } from './接入SQLite临时媒体隔离启动器.mjs';
import { 免填码批准产物 } from './接入SQLite免填码隔离副本.mjs';
import { 事务写入 } from './接入用户功能.mjs';
import { 检查授权入口后继 } from '../上游适配/SQLite工作台授权入口批准.mjs';
import { 媒体启动器路径, 媒体启动器依赖 } from '../上游适配/SQLite临时媒体策略批准.mjs';
import { 核验免填码批准, 读取免填码批准, 检查免填码后继, 核验免填码自有依赖, 免填码差异SHA256 } from '../上游适配/SQLite免填码启动批准.mjs';

const delta = 免填码批准产物(), { combined } = 授权入口批准产物();
function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'guan-auto-approved-')), root = join(home, '副本'); mkdirSync(root);
  const files = new Map([...combined, ...媒体策略批准产物()]);
  for (const item of 媒体启动器依赖()) files.set(item.文件, { 产物: readFileSync(join(根目录, item.文件)) });
  for (const [path, value] of files) { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), value.产物); }
  return { home, root };
}
function apply(f, options = {}) {
  return 事务写入(f.root, delta, join(f.home, '快照'), { 差异指纹: 免填码差异SHA256, 写后检查() { assert.equal(检查免填码后继(f.root), true); }, ...options });
}
test('3文件批准原字节和全部自有来源锁定，历史待批说明不覆盖', () => {
  const json = readFileSync(join(根目录, '上游适配/待审查/SQLite免填码启动.json')), patch = readFileSync(join(根目录, '上游适配/待审查/SQLite免填码启动.patch'));
  assert.equal(读取免填码批准().文件.length, 3); assert.match(读取免填码批准().状态, /待审查/); 核验免填码自有依赖(根目录);
  assert.throws(() => 核验免填码批准(Buffer.concat([json, Buffer.from(' ')]), patch), /指纹/);
  assert.throws(() => 核验免填码批准(json, Buffer.concat([patch, Buffer.from(' ')])), /指纹/);
});
test('只接受全部前置和3文件全前或全后态，旧9文件保护器仍拒绝新后继', () => {
  const f = fixture(); assert.equal(检查免填码后继(f.root), false); assert.equal(检查授权入口后继(f.root), true);
  apply(f); assert.equal(检查免填码后继(f.root), true); assert.throws(() => 检查授权入口后继(f.root), /未知改动/);
  for (const [path, item] of delta) assert.equal(readFileSync(join(f.root, path), 'utf8'), item.产物);
});
test('任意单文件后态均拒绝为半批，未知内容不接受', () => {
  for (const [path, item] of delta) {
    const f = fixture(); mkdirSync(dirname(join(f.root, path)), { recursive: true }); writeFileSync(join(f.root, path), item.产物);
    assert.throws(() => 检查免填码后继(f.root), /不完整/);
    writeFileSync(join(f.root, path), '未知'); assert.throws(() => 检查免填码后继(f.root), /未知/);
  }
});
test('原25文件、节点、路由、授权HTML及每份启动器依赖未知改动均拒绝', () => {
  for (const path of ['web/src/main.tsx', 'web/src/lib/canvas/canvas-event-bus.ts', 'web/src/router.tsx', 'web/src/guan/路由临时状态.ts', 'web/index.html', ...媒体启动器依赖().map(item => item.文件)]) {
    const f = fixture(); writeFileSync(join(f.root, path), '未知'); assert.throws(() => 检查免填码后继(f.root), /前置不完整|依赖不完整/);
  }
});
test('拒绝新增未知模块、目录、缺依赖、符号链接、硬链接及根目录链接', () => {
  for (const kind of ['file', 'directory', 'missing', 'symbolic', 'hard', 'root']) {
    const f = fixture(); apply(f);
    if (kind === 'file') writeFileSync(join(f.root, 'web/src/guan/sqlite/额外.mjs'), 'export{}');
    if (kind === 'directory') mkdirSync(join(f.root, '扩展功能/额外目录'));
    if (kind === 'missing') unlinkSync(join(f.root, 媒体启动器依赖()[0].文件));
    if (kind === 'symbolic' || kind === 'hard') {
      const path = join(f.root, 媒体启动器路径), external = join(f.home, '外部'); writeFileSync(external, readFileSync(path)); unlinkSync(path);
      if (kind === 'symbolic') symlinkSync(external, path); else linkSync(external, path);
    }
    if (kind === 'root') { const link = join(f.home, '根链接'); symlinkSync(f.root, link); assert.throws(() => 检查免填码后继(link), /链接/); }
    else assert.throws(() => 检查免填码后继(f.root), /未知|不完整|链接/);
  }
});
test('三个写入边界或写后失败均整体回退；成功日志包含3文件和原态快照', () => {
  for (const point of [0, 1, 2, 'after']) {
    const f = fixture();
    assert.throws(() => apply(f, point === 'after' ? { 写后检查() { throw Error('合成写后故障'); } } : { 写入前(_path, count) { if (count === point) throw Error('合成中途故障'); } }), /合成/);
    assert.equal(检查免填码后继(f.root), false); assert.equal(检查授权入口后继(f.root), true);
    for (const [path, item] of delta) if (item.原文 === null) assert.equal(existsSync(join(f.root, path)), false); else assert.equal(readFileSync(join(f.root, path), 'utf8'), item.原文);
    assert.equal(JSON.parse(readFileSync(join(f.home, '快照/事务.json'))).状态, '已回退');
  }
  const f = fixture(); apply(f); const journal = JSON.parse(readFileSync(join(f.home, '快照/事务.json')));
  assert.equal(journal.状态, '完成'); assert.equal(journal.文件.length, 3); assert.equal(journal.差异SHA256, 免填码差异SHA256);
  assert.equal(readFileSync(join(f.home, '快照/接入前', 媒体启动器路径), 'utf8'), delta.get(媒体启动器路径).原文);
});
