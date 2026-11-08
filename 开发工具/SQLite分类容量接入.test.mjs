import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { 根目录 } from './公共.mjs';
import { 事务写入 } from './接入用户功能.mjs';
import { 读取分类容量批准, 核验分类容量批准, 核验分类容量来源, 分类容量组合路径, 分类容量差异SHA256 } from '../上游适配/SQLite分类容量批准.mjs';
import { 读取分类容量隔离记录, 核验分类容量完整包, 分类容量批准产物, 加载分类容量磁盘服务 } from './接入SQLite分类容量隔离副本.mjs';

const record = join(根目录, '.运行/SQLite分类容量-YzaI8L/分类容量接入记录.json');
const integration = 读取分类容量隔离记录(record), manifest = 读取分类容量批准();
const home = mkdtempSync(join(根目录, '.运行/分类容量保护测试-')), root = join(home, '组合包');
cpSync(integration.组合包, root, { recursive: true, dereference: false, verbatimSymlinks: true, errorOnExist: true, force: false });
const json = readFileSync(join(根目录, '上游适配/待审查/SQLite分类容量.json'));
const patch = readFileSync(join(根目录, '上游适配/待审查/SQLite分类容量.patch'));
const target = join(root, 分类容量组合路径(manifest.文件[0].文件)), baseline = readFileSync(target);
test('完整批准、六文件事务与全部前置和原态证据通过', () => {
  assert.equal(核验分类容量批准(json, patch).文件.length, 6);
  assert.equal(核验分类容量完整包(root, true), true);
});
test('清单或补丁任何字节改变都拒绝', () => {
  assert.throws(() => 核验分类容量批准(Buffer.concat([json, Buffer.from('\n')]), patch), /指纹不符/);
  assert.throws(() => 核验分类容量批准(json, Buffer.concat([patch, Buffer.from('\n')])), /指纹不符/);
});
test('六文件未知内容与半批均拒绝', () => {
  try {
    writeFileSync(target, Buffer.concat([baseline, Buffer.from('\n')]));
    assert.throws(() => 核验分类容量完整包(root, true), /未知改动/);
    writeFileSync(target, readFileSync(join(integration.事务快照, '接入前', 分类容量组合路径(manifest.文件[0].文件))));
    assert.throws(() => 核验分类容量完整包(root, true), /半批/);
  } finally { writeFileSync(target, baseline); }
});
test('未改服务依赖和历史卡片自动避让源码均不可偏离', () => {
  for (const path of ['服务包/扩展功能/本机服务/写入协调.mjs', '服务包/扩展功能/本机存储/协议.mjs', '画布副本/web/src/guan/卡片自动避让.ts']) {
    const file = join(root, path), value = readFileSync(file);
    try { writeFileSync(file, Buffer.concat([value, Buffer.from('\n')])); assert.throws(() => 核验分类容量完整包(root, true), /范围外/); }
    finally { writeFileSync(file, value); }
  }
});
test('未知文件、空目录和伪装dist拒绝', () => {
  const file = join(root, '未知.js'), dir = join(root, 'dist');
  try {
    writeFileSync(file, 'synthetic'); assert.throws(() => 核验分类容量完整包(root, true), /未知文件/); unlinkSync(file);
    mkdirSync(dir); assert.throws(() => 核验分类容量完整包(root, true), /未知文件/);
  } finally { try { unlinkSync(file); } catch { /* 合成文件可能已移除 */ } try { rmdirSync(dir); } catch { /* 合成目录可能未创建 */ } }
});
test('源码符号链接、硬链接和错误依赖链接拒绝', () => {
  const path = join(root, '未知链接');
  try {
    symlinkSync(target, path); assert.throws(() => 核验分类容量完整包(root, true), /链接/); unlinkSync(path);
    linkSync(target, path); assert.throws(() => 核验分类容量完整包(root, true), /硬链接/); unlinkSync(path);
    const dependencies = join(root, '画布副本/web/node_modules');
    unlinkSync(dependencies); symlinkSync(home, dependencies);
    assert.throws(() => 核验分类容量完整包(root, true), /依赖链接/);
    unlinkSync(dependencies); symlinkSync(join(integration.副本, 'web/node_modules'), dependencies);
  } finally { try { unlinkSync(path); } catch { /* 合成链接可能已移除 */ } }
});
test('来源指纹改变拒绝，不修改真实自有来源', () => {
  const own = join(home, '合成来源'); mkdirSync(own);
  for (const item of manifest.自有来源) {
    const file = join(own, item.文件); mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, readFileSync(join(根目录, item.文件)));
  }
  mkdirSync(join(own, '开发工具'));
  cpSync(join(根目录, '开发工具/预审SQLite分类容量.mjs'), join(own, '开发工具/预审SQLite分类容量.mjs'));
  核验分类容量来源(own);
  writeFileSync(join(own, manifest.自有来源[0].文件), 'synthetic');
  assert.throws(() => 核验分类容量来源(own), /偏离批准/);
});
test('六文件故障写入回退完整前态，快照保留，可重做整批事务', () => {
  const delta = 分类容量批准产物();
  for (const [path, item] of delta) {
    const file = join(root, path); if (item.原文 === null) unlinkSync(file); else writeFileSync(file, item.原文);
  }
  核验分类容量完整包(root, false);
  const failed = join(home, '合成失败快照');
  assert.throws(() => 事务写入(root, delta, failed, { 差异指纹: 分类容量差异SHA256, 写入前(_path, count) { if (count === 4) throw Error('synthetic failure'); } }), /synthetic failure/);
  assert.equal(JSON.parse(readFileSync(join(failed, '事务.json'))).状态, '已回退');
  核验分类容量完整包(root, false);
  事务写入(root, delta, join(home, '重做快照'), { 差异指纹: 分类容量差异SHA256, 写后检查() { 核验分类容量完整包(root, true); } });
  assert.equal(核验分类容量完整包(root, true), true);
});
test('真实磁盘服务导入闭合，临时空库读取详细容量后正常关闭', async () => {
  await assert.rejects(加载分类容量磁盘服务({ ...integration, 服务包: home }), /路径映射不符/);
  const approved = await 加载分类容量磁盘服务(integration), data = join(home, '合成数据');
  const workspace = approved.openWorkspace({ dataRoot: data, initialize: true });
  try { assert.equal((await workspace.readDetailedUsage()).breakdown.format, 'guan-sqlite-usage.v1'); }
  finally { workspace.close(); }
  assert.equal(读取分类容量隔离记录(record).组合包, integration.组合包);
});
