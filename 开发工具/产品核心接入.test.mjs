import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { 根目录 } from './公共.mjs';
import { 事务写入 } from './接入用户功能.mjs';
import { 产品前置记录 } from './预审产品核心迁入.mjs';
import { 读取视区跟随隔离记录 } from './接入新建卡片视区跟随隔离副本.mjs';
import { 读取产品批准, 核验产品批准, 核验产品自有来源, 产品差异SHA256 } from '../上游适配/产品核心迁入批准.mjs';
import { 产品批准产物, 核验产品完整包 } from './接入产品核心隔离副本.mjs';

const previous = 读取视区跟随隔离记录(产品前置记录), manifest = 读取产品批准();
const home = mkdtempSync(join(根目录, '.运行/产品保护测试-')), root = join(home, '组合包');
cpSync(previous.组合包, root, { recursive: true, dereference: false, verbatimSymlinks: true, errorOnExist: true, force: false });
const json = readFileSync(join(根目录, '上游适配/待审查/产品核心迁入.json'));
const patch = readFileSync(join(根目录, '上游适配/待审查/产品核心迁入.patch'));
const delta = 产品批准产物(), first = [...delta][0], target = join(root, first[0]);
test('精确30项批准及完整原态通过，未指定状态拒绝', () => {
  assert.equal(核验产品批准(json, patch).文件.length, 30);
  assert.equal(核验产品完整包(root, false), true);
  assert.throws(() => 核验产品完整包(root, true), /不完整/);
  assert.throws(() => 核验产品完整包(root), /明确/);
});
test('历史审查任一字节变化拒绝', () => {
  assert.throws(() => 核验产品批准(Buffer.concat([json, Buffer.from('\n')]), patch), /指纹不符/);
  assert.throws(() => 核验产品批准(json, Buffer.concat([patch, Buffer.from('\n')])), /指纹不符/);
});
test('只接一项的半批和任意产物篡改拒绝', () => {
  try {
    writeFileSync(target, first[1].产物);
    assert.throws(() => 核验产品完整包(root, false), /不完整/);
    assert.throws(() => 核验产品完整包(root, true), /不完整/);
    writeFileSync(target, 'synthetic tampering');
    assert.throws(() => 核验产品完整包(root, false), /未知改动/);
  } finally { unlinkSync(target); }
});
test('服务、启动器、容量和布局等范围外文件仍受保护', () => {
  for (const path of ['服务包/扩展功能/本机服务/数据服务.mjs', '画布副本/扩展功能/本机服务/受限工作台启动器.mjs',
    '画布副本/web/src/guan/SQLite分类容量面板.tsx', '画布副本/web/src/guan/卡片自动避让.ts']) {
    const file = join(root, path), value = readFileSync(file);
    try { writeFileSync(file, Buffer.concat([value, Buffer.from('\n')])); assert.throws(() => 核验产品完整包(root, false), /范围外/); }
    finally { writeFileSync(file, value); }
  }
});
test('未知文件目录、源码链接和硬链接拒绝', () => {
  const path = join(root, '合成未知项'), ordinary = join(root, '画布副本/web/package.json');
  writeFileSync(path, 'synthetic'); assert.throws(() => 核验产品完整包(root, false), /未知文件/); unlinkSync(path);
  mkdirSync(path); assert.throws(() => 核验产品完整包(root, false), /目录改变/); rmdirSync(path);
  symlinkSync(ordinary, path); assert.throws(() => 核验产品完整包(root, false), /链接/); unlinkSync(path);
  linkSync(ordinary, path); assert.throws(() => 核验产品完整包(root, false), /硬链接/); unlinkSync(path);
});
test('锁定生成器和自有7文件的合成来源篡改拒绝', () => {
  const own = join(home, '合成来源');
  for (const path of ['开发工具/预审产品核心迁入.mjs', ...manifest.自有来源.map(item => item.文件)]) {
    mkdirSync(join(own, path, '..'), { recursive: true }); cpSync(join(根目录, path), join(own, path));
  }
  核验产品自有来源(own);
  const file = join(own, manifest.自有来源[0].文件); writeFileSync(file, 'synthetic');
  assert.throws(() => 核验产品自有来源(own), /偏离批准/);
});
test('事务写后失败可恢复全前态，新文件无伪造原态快照', () => {
  const failed = join(home, '合成失败快照');
  assert.throws(() => 事务写入(root, delta, failed, { 差异指纹: 产品差异SHA256, 写后检查() { throw Error('synthetic failure'); } }), /synthetic failure/);
  assert.equal(JSON.parse(readFileSync(join(failed, '事务.json'))).状态, '已回退');
  for (const item of manifest.文件) assert.equal(existsSync(join(failed, '接入前/画布副本', item.文件)), item.原始SHA256 !== null);
  assert.equal(核验产品完整包(root, false), true);
});
test('重做后全后态通过，历史审查字节不变', () => {
  事务写入(root, delta, join(home, '重做快照'), { 差异指纹: 产品差异SHA256, 写后检查() { 核验产品完整包(root, true); } });
  assert.equal(核验产品完整包(root, true), true);
  assert.throws(() => 核验产品完整包(root, false), /不完整/);
  assert.deepEqual(readFileSync(join(根目录, '上游适配/待审查/产品核心迁入.json')), json);
  assert.deepEqual(readFileSync(join(根目录, '上游适配/待审查/产品核心迁入.patch')), patch);
});
