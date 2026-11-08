import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { 根目录, 上游目录 } from './公共.mjs';
import { 读取双入口批准, 核验双入口批准, 检查双入口批次, 双入口差异SHA256 } from '../上游适配/右上双入口批准.mjs';
import { 双入口批准产物 } from './接入右上双入口.mjs';
import { 事务写入 } from './接入用户功能.mjs';

const manifest = 读取双入口批准();
const files = 双入口批准产物();
const core = manifest.文件[0].文件;
const modulePath = manifest.文件[1].文件;
const put = (root, path, bytes) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), bytes); };

test('双入口批准只覆盖2文件，清单或补丁篡改即拒绝', () => {
  const json = readFileSync(join(根目录, '上游适配/待审查/右上双入口关闭.json'));
  const patch = readFileSync(join(根目录, '上游适配/待审查/右上双入口关闭.patch'));
  assert.equal(files.size, 2);
  assert.throws(() => 核验双入口批准(Buffer.concat([json, Buffer.from(' ')]), patch), /指纹/);
  assert.throws(() => 核验双入口批准(json, Buffer.concat([patch, Buffer.from(' ')])), /指纹/);
});

test('双入口完整前态/后态可识别，半批、未知内容、符号链接拒绝', () => {
  const root = mkdtempSync(join(tmpdir(), 'guan-two-entries-'));
  try {
    put(root, core, readFileSync(join(上游目录, core)));
    assert.equal(检查双入口批次(root, manifest), false);
    put(root, core, files.get(core).原文);
    assert.equal(检查双入口批次(root, manifest), false);
    put(root, modulePath, files.get(modulePath).产物);
    assert.throws(() => 检查双入口批次(root, manifest), /不完整/);
    put(root, core, files.get(core).产物);
    assert.equal(检查双入口批次(root, manifest), true);
    put(root, core, '未批准修改');
    assert.throws(() => 检查双入口批次(root, manifest), /未知改动/);
    put(root, core, files.get(core).产物);
    rmSync(join(root, modulePath)); symlinkSync(join(root, core), join(root, modulePath));
    assert.throws(() => 检查双入口批次(root, manifest), /符号链接/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('双入口事务失败恢复原文件，不遗留新增模块，证据保留', () => {
  const temp = mkdtempSync(join(tmpdir(), 'guan-two-entries-rollback-'));
  try {
    const root = join(temp, 'runtime'); mkdirSync(root); put(root, core, files.get(core).原文);
    assert.throws(() => 事务写入(root, files, join(temp, 'snapshot'), { 差异指纹: 双入口差异SHA256, 写后检查: () => { throw Error('模拟写后失败'); } }), /模拟写后失败/);
    assert.equal(readFileSync(join(root, core), 'utf8'), files.get(core).原文);
    assert.equal(existsSync(join(root, modulePath)), false);
    assert.equal(检查双入口批次(root, manifest), false);
    assert.equal(JSON.parse(readFileSync(join(temp, 'snapshot/事务.json'))).状态, '已回退');
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
