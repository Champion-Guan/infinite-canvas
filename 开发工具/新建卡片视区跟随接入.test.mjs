import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { 根目录 } from './公共.mjs';
import { 事务写入 } from './接入用户功能.mjs';
import { 读取视区跟随批准, 核验视区跟随批准, 核验视区跟随自有来源, 视区跟随差异SHA256, 视区跟随组合路径 } from '../上游适配/新建卡片视区跟随批准.mjs';
import { 读取分类容量隔离记录 } from './接入SQLite分类容量隔离副本.mjs';
import { 视区跟随前置记录 } from './预审新建卡片视区跟随.mjs';
import { 核验视区跟随完整包, 视区跟随批准产物 } from './接入新建卡片视区跟随隔离副本.mjs';

const previous = 读取分类容量隔离记录(视区跟随前置记录), manifest = 读取视区跟随批准();
const home = mkdtempSync(join(根目录, '.运行/视区跟随保护测试-')), root = join(home, '组合包');
cpSync(previous.组合包, root, { recursive: true, dereference: false, verbatimSymlinks: true, errorOnExist: true, force: false });
const json = readFileSync(join(根目录, '上游适配/待审查/新建卡片视区跟随.json'));
const patch = readFileSync(join(根目录, '上游适配/待审查/新建卡片视区跟随.patch'));
const delta = 视区跟随批准产物(), target = join(root, 视区跟随组合路径), baseline = readFileSync(target);

test('完整一文件批准、原态与锁定候选来源通过', () => {
  assert.equal(核验视区跟随批准(json, patch).文件.length, 1);
  assert.equal(核验视区跟随完整包(root, false), true);
  assert.throws(() => 核验视区跟随完整包(root, true), /前后态错误/);
  assert.throws(() => 核验视区跟随完整包(root), /明确指定/);
  核验视区跟随自有来源(根目录);
});
test('历史审查清单与补丁的任一字节变化拒绝', () => {
  assert.throws(() => 核验视区跟随批准(Buffer.concat([json, Buffer.from('\n')]), patch), /指纹不符/);
  assert.throws(() => 核验视区跟随批准(json, Buffer.concat([patch, Buffer.from('\n')])), /指纹不符/);
});
test('一文件未知修改、漏接ref或只接部分代码均拒绝', () => {
  try {
    writeFileSync(target, Buffer.concat([baseline, Buffer.from('\n')]));
    assert.throws(() => 核验视区跟随完整包(root, false), /未知改动/);
    const partial = delta.get(视区跟随组合路径).产物.replace('    const revealCreatedNodeRef = useRef<string | null>(null);\n', '');
    writeFileSync(target, partial);
    assert.throws(() => 核验视区跟随完整包(root, true), /未知改动/);
  } finally { writeFileSync(target, baseline); }
});
test('分类容量、几何模块、SQLite服务和启动器仍属于范围外保护', () => {
  for (const path of ['画布副本/web/src/guan/卡片自动避让.ts', '画布副本/web/src/guan/SQLite分类容量面板.tsx',
    '服务包/扩展功能/本机服务/数据服务.mjs', '服务包/扩展功能/本机存储/SQLite工作区.mjs', '画布副本/扩展功能/本机服务/受限工作台启动器.mjs']) {
    const file = join(root, path), value = readFileSync(file);
    try { writeFileSync(file, Buffer.concat([value, Buffer.from('\n')])); assert.throws(() => 核验视区跟随完整包(root, false), /范围外/); }
    finally { writeFileSync(file, value); }
  }
});
test('未知文件、空目录、源码链接、硬链接及错误依赖链接拒绝', () => {
  const path = join(root, '合成未知项');
  try {
    writeFileSync(path, 'synthetic'); assert.throws(() => 核验视区跟随完整包(root, false), /未知文件/); unlinkSync(path);
    mkdirSync(path); assert.throws(() => 核验视区跟随完整包(root, false), /目录改变/); rmdirSync(path);
    symlinkSync(target, path); assert.throws(() => 核验视区跟随完整包(root, false), /链接/); unlinkSync(path);
    linkSync(target, path); assert.throws(() => 核验视区跟随完整包(root, false), /硬链接/); unlinkSync(path);
    const deps = join(root, '画布副本/web/node_modules');
    try {
      unlinkSync(deps); symlinkSync(home, deps);
      assert.throws(() => 核验视区跟随完整包(root, false), /依赖链接/);
    } finally { unlinkSync(deps); symlinkSync(join(previous.副本, 'web/node_modules'), deps); }
  } finally { try { unlinkSync(path); } catch { /* 本测试的合成项可能已移除 */ } }
});
test('自有候选生成器更改拒绝；只使用合成来源，不改真实工具', () => {
  const own = join(home, '合成来源'); mkdirSync(join(own, '开发工具'), { recursive: true });
  const path = '开发工具/预审新建卡片视区跟随.mjs';
  cpSync(join(根目录, path), join(own, path)); 核验视区跟随自有来源(own);
  writeFileSync(join(own, path), 'synthetic');
  assert.throws(() => 核验视区跟随自有来源(own), /偏离批准/);
});
test('写后校验失败可回退完整原态，原态快照保留，重做事务后通过', () => {
  const failed = join(home, '合成失败快照');
  assert.throws(() => 事务写入(root, delta, failed, { 差异指纹: 视区跟随差异SHA256, 写后检查() { throw Error('synthetic failure'); } }), /synthetic failure/);
  assert.equal(JSON.parse(readFileSync(join(failed, '事务.json'))).状态, '已回退');
  assert.deepEqual(readFileSync(join(failed, '接入前', 视区跟随组合路径)), baseline);
  核验视区跟随完整包(root, false);
  事务写入(root, delta, join(home, '重做快照'), { 差异指纹: 视区跟随差异SHA256, 写后检查() { 核验视区跟随完整包(root, true); } });
  assert.equal(核验视区跟随完整包(root, true), true);
  assert.throws(() => 核验视区跟随完整包(root, false), /前后态错误/);
  assert.equal(manifest.文件[0].文件, 'web/src/pages/canvas/project.tsx');
});
