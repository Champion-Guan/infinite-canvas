import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { 根目录 } from './公共.mjs';
import { 读取首页批准, 核验首页批准, 首页差异SHA256 } from '../上游适配/首页接入批准.mjs';
import { 检查首页批次 } from './检查首页批次.mjs';
import { 事务写入 } from './接入用户功能.mjs';
import { 读取首页批准产物 } from './读取首页批准产物.mjs';

const 清单 = 读取首页批准();
const 图片清单 = readFileSync(join(根目录, '界面资源/首页轮播/图片清单.json'));
const 文件 = 读取首页批准产物(清单, '首页原图接入.patch');
const 写 = (根, 路径, 内容) => { mkdirSync(dirname(join(根, 路径)), { recursive: true }); writeFileSync(join(根, 路径), 内容); };

test('首页批准锁定原审查、3文本和30原图，拒绝篡改清单、差异、图片清单', () => {
  const json = readFileSync(join(根目录, '上游适配/待审查/首页原图接入.json'));
  const patch = readFileSync(join(根目录, '上游适配/待审查/首页原图接入.patch'));
  assert.equal(清单.前置首页审查SHA256, 'c219fe373e41d0adefcc5fcd16dd9d324cdb9cffa7b86b44f40dae822b961800');
  for (let i = 0; i < 3; i++) {
    const args = [json, patch, 图片清单]; args[i] = Buffer.concat([args[i], Buffer.from(' ')]);
    assert.throws(() => 核验首页批准(...args), /不符/);
  }
});

test('首页完整33项通过，缺图、半批、错误哈希、额外文件与路径逃逸拒绝', () => {
  const temp = mkdtempSync(join(tmpdir(), 'guan-home-guard-'));
  try {
    assert.equal(检查首页批次(temp, 清单), false);
    const items = [...文件];
    写(temp, items[0][0], items[0][1].产物);
    assert.throws(() => 检查首页批次(temp, 清单), /批次不完整/);
    for (const [name, item] of items.slice(1)) 写(temp, name, item.产物);
    assert.equal(检查首页批次(temp, 清单), true);
    const last = items.at(-1); rmSync(join(temp, last[0]));
    assert.throws(() => 检查首页批次(temp, 清单), /批次不完整/);
    写(temp, last[0], '损坏图片');
    assert.throws(() => 检查首页批次(temp, 清单), /未知改动/);
    写(temp, last[0], last[1].产物);
    写(temp, 'web/public/guan/首页轮播/未批准.webp', '不可加入');
    assert.throws(() => 检查首页批次(temp, 清单), /未声明/);
    assert.throws(() => 检查首页批次(temp, { ...清单, 文件: [{ ...清单.文件[0], 文件: '../escape' }, ...清单.文件.slice(1)] }), /路径逃逸/);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test('首页拒绝符号链接；失败事务恢复旧入口并移除仅本次新增图片', () => {
  const temp = mkdtempSync(join(tmpdir(), 'guan-home-rollback-'));
  try {
    const root = join(temp, 'runtime'); mkdirSync(root);
    const entry = 'web/src/guan/画布入口.tsx'; 写(root, entry, '旧入口');
    const newFiles = new Map([...文件].filter(([name]) => name !== entry));
    newFiles.set(entry, 文件.get(entry));
    assert.throws(() => 事务写入(root, newFiles, join(temp, 'snapshot'), { 差异指纹: 首页差异SHA256, 写后检查: () => { throw Error('模拟校验失败'); } }), /模拟/);
    assert.equal(readFileSync(join(root, entry), 'utf8'), '旧入口');
    for (const [name] of newFiles) if (name !== entry) assert.equal(existsSync(join(root, name)), false);
    assert.equal(JSON.parse(readFileSync(join(temp, 'snapshot/事务.json'))).差异SHA256, 首页差异SHA256);
    rmSync(join(root, entry));
    symlinkSync(join(temp, 'snapshot/接入前', entry), join(root, entry));
    assert.throws(() => 检查首页批次(root, 清单), /符号链接/);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
