import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { 根目录, 上游目录 } from './公共.mjs';
import { 读取顶栏批准, 核验顶栏批准, 检查顶栏批次, 顶栏差异SHA256 } from '../上游适配/首页顶栏批准.mjs';
import { 生成首页顶栏候选 } from './生成首页顶栏候选.mjs';
import { 事务写入 } from './接入用户功能.mjs';

const manifest = 读取顶栏批准();
const files = 生成首页顶栏候选();
const layout = 'web/src/layouts/user-layout.tsx';
const patch = readFileSync(join(根目录, '上游适配/待审查/首页顶栏原样接入.patch'), 'utf8');
const original = files.get(layout).原文;
const put = (root, path, bytes) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), bytes); };

test('顶栏批准精确锁定3份文件，拒绝篡改差异和清单', () => {
  assert.equal(files.size, 3);
  const json = readFileSync(join(根目录, '上游适配/待审查/首页顶栏原样接入.json'));
  assert.throws(() => 核验顶栏批准(Buffer.concat([json, Buffer.from(' ')]), patch), /指纹/);
  assert.throws(() => 核验顶栏批准(json, patch + ' '), /指纹/);
  const after = files.get(layout).产物.toString();
  assert.ok(after.includes('isHome ? <LegacyHomeChrome /> : <AppTopNav />'));
  assert.ok(after.includes('productFeatures.externalAgent ? <AgentPanel /> : null'));
});

test('顶栏只接受完整原态/完整新态，半批、未知改动和符号链接拒绝', () => {
  const root = mkdtempSync(join(tmpdir(), 'guan-header-guard-'));
  try {
    put(root, layout, readFileSync(join(上游目录, layout)));
    assert.equal(检查顶栏批次(root, manifest), false);
    put(root, layout, original);
    assert.equal(检查顶栏批次(root, manifest), false);
    const top = 'web/src/guan/旧版首页顶栏.tsx'; put(root, top, files.get(top).产物);
    assert.throws(() => 检查顶栏批次(root, manifest), /不完整/);
    for (const [path, item] of files) put(root, path, item.产物);
    assert.equal(检查顶栏批次(root, manifest), true);
    put(root, layout, '未批准改动');
    assert.throws(() => 检查顶栏批次(root, manifest), /未知改动/);
    put(root, layout, files.get(layout).产物);
    rmSync(join(root, top)); symlinkSync(join(root, layout), join(root, top));
    assert.throws(() => 检查顶栏批次(root, manifest), /符号链接/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('顶栏接入失败恢复原布局、移除本次新增模块并保留事务证据', () => {
  const temp = mkdtempSync(join(tmpdir(), 'guan-header-rollback-'));
  try {
    const root = join(temp, 'runtime'); mkdirSync(root); put(root, layout, original);
    assert.throws(() => 事务写入(root, files, join(temp, 'snapshot'), { 差异指纹: 顶栏差异SHA256, 写后检查: () => { throw Error('模拟失败'); } }), /模拟失败/);
    assert.equal(readFileSync(join(root, layout), 'utf8'), original);
    for (const name of files.keys()) if (name !== layout) assert.equal(existsSync(join(root, name)), false);
    assert.equal(检查顶栏批次(root, manifest), false);
    assert.equal(JSON.parse(readFileSync(join(temp, 'snapshot/事务.json'))).状态, '已回退');
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
