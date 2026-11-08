import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { 根目录, 上游目录 } from './公共.mjs';
import { 读取脚本来源批准, 核验脚本来源批准, 检查脚本来源批次, 脚本来源差异SHA256 } from '../上游适配/脚本与提示词来源批准.mjs';
import { 脚本来源批准产物 } from './接入脚本与提示词来源.mjs';
import { 事务写入 } from './接入用户功能.mjs';

const manifest = 读取脚本来源批准();
const files = 脚本来源批准产物();
const policy = 'web/src/guan/脚本与提示词来源.ts';
const put = (root, path, value) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), value); };
function fixture(root, field) {
  for (const [path, item] of files) if (item[field] !== null) put(root, path, item[field]);
}

test('三项批准只覆盖9个精确文件；清单与差异篡改拒绝', () => {
  const json = readFileSync(join(根目录, '上游适配/待审查/脚本与提示词来源关闭.json'));
  const patch = readFileSync(join(根目录, '上游适配/待审查/脚本与提示词来源关闭.patch'));
  assert.equal(files.size, 9);
  assert.throws(() => 核验脚本来源批准(Buffer.concat([json, Buffer.from(' ')]), patch), /指纹/);
  assert.throws(() => 核验脚本来源批准(json, Buffer.concat([patch, Buffer.from(' ')])), /指纹/);
});

test('三项精确前态、作者前态、后态可识别；半批与未知前置拒绝', () => {
  const root = mkdtempSync(join(tmpdir(), 'guan-source-batch-'));
  try {
    fixture(root, '原文'); assert.equal(检查脚本来源批次(root, manifest), false);
    for (const [path, item] of files) if (item.原文 !== null) put(root, path, readFileSync(join(上游目录, path)));
    assert.equal(检查脚本来源批次(root, manifest), false);
    fixture(root, '原文'); put(root, policy, files.get(policy).产物);
    assert.throws(() => 检查脚本来源批次(root, manifest), /不完整/);
    fixture(root, '产物'); assert.equal(检查脚本来源批次(root, manifest), true);
    put(root, 'web/src/stores/use-config-store.ts', '未批准前置');
    assert.throws(() => 检查脚本来源批次(root, manifest), /未知改动/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('三项保护拒绝文件、目录符号链接及路径逃逸', () => {
  const root = mkdtempSync(join(tmpdir(), 'guan-source-links-'));
  try {
    fixture(root, '产物'); rmSync(join(root, policy));
    symlinkSync(join(root, 'web/src/stores/use-config-store.ts'), join(root, policy));
    assert.throws(() => 检查脚本来源批次(root, manifest), /符号链接/);
    rmSync(join(root, policy)); rmSync(join(root, 'web/src/guan'), { recursive: true });
    symlinkSync(join(root, 'web/src/stores'), join(root, 'web/src/guan'));
    assert.throws(() => 检查脚本来源批次(root, manifest), /符号链接/);
    assert.throws(() => 检查脚本来源批次(root, { 文件: [{ 文件: '../escape' }] }), /逃逸/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

for (const scenario of ['途中失败', '写后失败']) test('三项事务' + scenario + '恢复全部8文件且不遗留新策略', () => {
  const temp = mkdtempSync(join(tmpdir(), 'guan-source-rollback-'));
  try {
    const root = join(temp, 'runtime'); mkdirSync(root); fixture(root, '原文');
    const ordered = new Map([[policy, files.get(policy)], ...[...files].filter(([path]) => path !== policy)]);
    assert.throws(() => 事务写入(root, ordered, join(temp, 'snapshot'), {
      差异指纹: 脚本来源差异SHA256,
      写入前: (_path, count) => { if (scenario === '途中失败' && count === 4) throw Error('模拟失败'); },
      写后检查: () => { throw Error('模拟失败'); },
    }), /模拟失败/);
    for (const [path, item] of files) {
      if (item.原文 === null) assert.equal(existsSync(join(root, path)), false);
      else assert.equal(readFileSync(join(root, path), 'utf8'), item.原文);
    }
    assert.equal(检查脚本来源批次(root, manifest), false);
    assert.equal(JSON.parse(readFileSync(join(temp, 'snapshot/事务.json'))).状态, '已回退');
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
