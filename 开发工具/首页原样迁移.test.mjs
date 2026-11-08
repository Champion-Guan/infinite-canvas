import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { 根目录 } from './公共.mjs';
import { 哈希 } from './检查运行副本.mjs';
import { 检查首页批次 } from './检查首页批次.mjs';
import { 事务写入 } from './接入用户功能.mjs';
import { 读取轮播兼容批准, 读取原样首页批准 } from '../上游适配/首页原样迁移批准.mjs';
import { 匹配首页后继 } from '../上游适配/首页批次后继.mjs';

const manifest = 读取轮播兼容批准();
const sources = new Map([
  ['web/src/guan/画布入口.tsx', '扩展功能/首页/画布入口候选.tsx'],
  ...['工作台首页.tsx', '首页.module.css', '轮播依赖.js', '轮播依赖.d.ts'].map(name => ['web/src/guan/' + name, '扩展功能/首页/' + name]),
  ...manifest.资源.map(item => [item.文件, '界面资源/' + item.文件.split('/guan/')[1]]),
]);
const files = new Map([...sources].map(([target, source]) => [target, { 产物: readFileSync(join(根目录, source)) }]));
const put = (root, path, content) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), content); };

test('原样首页38项：权威源码与锁定审批逐字节一致，前置36项记录仍可读取', () => {
  assert.equal(manifest.文件.length + manifest.资源.length, 38);
  assert.equal(读取原样首页批准().资源.length, 33);
  for (const item of [...manifest.文件, ...manifest.资源]) {
    const actual = 哈希(files.get(item.文件).产物);
    assert.ok(actual === item.候选SHA256 || 匹配首页后继(item, actual), item.文件);
  }
});

test('原样首页拒绝半批、改动轮播JS、额外资源及符号链接', () => {
  const root = mkdtempSync(join(tmpdir(), 'guan-exact-home-'));
  try {
    assert.equal(检查首页批次(root, manifest), false);
    const items = [...files];
    put(root, items[0][0], items[0][1].产物);
    assert.throws(() => 检查首页批次(root, manifest), /批次不完整/);
    for (const [path, item] of items.slice(1)) put(root, path, item.产物);
    assert.equal(检查首页批次(root, manifest), true);
    const js = 'web/src/guan/轮播依赖.js';
    put(root, js, '未知轮播代码');
    assert.throws(() => 检查首页批次(root, manifest), /未知改动/);
    put(root, js, files.get(js).产物);
    const extra = 'web/public/guan/首页原样资源/未知.js';
    put(root, extra, '不允许');
    assert.throws(() => 检查首页批次(root, manifest), /未声明/);
    rmSync(join(root, extra));
    rmSync(join(root, js)); symlinkSync(join(root, 'web/src/guan/工作台首页.tsx'), join(root, js));
    assert.throws(() => 检查首页批次(root, manifest), /符号链接/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('原样首页事务失败恢复原有文本，不残留新依赖或图片', () => {
  const temp = mkdtempSync(join(tmpdir(), 'guan-exact-home-rollback-'));
  try {
    const root = join(temp, 'runtime'); mkdirSync(root);
    const entry = 'web/src/guan/画布入口.tsx'; put(root, entry, '原入口');
    assert.throws(() => 事务写入(root, files, join(temp, 'snapshot'), { 差异指纹: manifest.差异SHA256, 写后检查: () => { throw Error('模拟失败'); } }), /模拟失败/);
    assert.equal(readFileSync(join(root, entry), 'utf8'), '原入口');
    for (const path of files.keys()) if (path !== entry) assert.equal(existsSync(join(root, path)), false);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
