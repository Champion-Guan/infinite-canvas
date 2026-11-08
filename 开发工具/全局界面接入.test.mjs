import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { 根目录 } from './公共.mjs';
import { 全局恢复批准产物 } from './接入全局界面恢复.mjs';
import { 读取全局恢复批准, 核验全局恢复批准, 检查全局恢复批次, 全局恢复差异SHA256 } from '../上游适配/全局界面恢复批准.mjs';
import { 生成首页顶栏候选 } from './生成首页顶栏候选.mjs';
import { 生成脚本来源候选 } from './预审脚本与提示词来源.mjs';
import { 读取顶栏批准, 检查顶栏批次 } from '../上游适配/首页顶栏批准.mjs';
import { 读取脚本来源批准, 检查脚本来源批次 } from '../上游适配/脚本与提示词来源批准.mjs';
import { 事务写入 } from './接入用户功能.mjs';

const files = 全局恢复批准产物();
const manifest = 读取全局恢复批准();
const put = (root, path, content) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), content); };
function before(root) {
  for (const [path, item] of new Map([...生成首页顶栏候选(), ...生成脚本来源候选()])) put(root, path, item.产物);
  for (const [path, item] of files) if (item.原文 !== null) put(root, path, item.原文);
}

test('全局恢复只接受批准的9文件及精确JSON/patch；不改旧历史快照', () => {
  assert.equal(files.size, 9);
  const json = readFileSync(join(根目录, '上游适配/待审查/全局顶栏主题品牌恢复.json'));
  const patch = readFileSync(join(根目录, '上游适配/待审查/全局顶栏主题品牌恢复.patch'));
  assert.throws(() => 核验全局恢复批准(Buffer.concat([json, Buffer.from(' ')]), patch), /指纹/);
  assert.throws(() => 核验全局恢复批准(json, Buffer.concat([patch, Buffer.from(' ')])), /指纹/);
  assert.equal(读取顶栏批准().文件.length, 3);
  assert.equal(读取脚本来源批准().文件.length, 9);
});

test('只允许完整前后态；半批/未知/未声明资产拒绝，旧批次仅识别完整后继', () => {
  const root = mkdtempSync(join(tmpdir(), 'guan-global-guard-'));
  try {
    before(root);
    assert.equal(检查全局恢复批次(root), false);
    const [first, item] = files.entries().next().value;
    put(root, first, item.产物);
    assert.throws(() => 检查全局恢复批次(root), /不完整/);
    assert.throws(() => 检查顶栏批次(root, 读取顶栏批准()), /不完整/);
    for (const [path, value] of files) put(root, path, value.产物);
    assert.equal(检查全局恢复批次(root), true);
    assert.equal(检查顶栏批次(root, 读取顶栏批准()), true);
    assert.equal(检查脚本来源批次(root, 读取脚本来源批准()), true);
    put(root, first, '未知改动');
    assert.throws(() => 检查全局恢复批次(root), /不完整/);
    put(root, first, item.产物);
    put(root, 'web/public/guan/brand/unapproved.png', '未声明');
    assert.throws(() => 检查全局恢复批次(root), /未声明/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('品牌文件、父目录、根符号链接及路径逃逸拒绝', () => {
  const temp = mkdtempSync(join(tmpdir(), 'guan-global-links-'));
  const root = join(temp, 'runtime'); mkdirSync(root);
  try {
    before(root);
    for (const [path, value] of files) put(root, path, value.产物);
    const icon = 'web/public/guan/brand/favicon.png';
    rmSync(join(root, icon)); symlinkSync(join(root, 'web/index.html'), join(root, icon));
    assert.throws(() => 检查全局恢复批次(root), /符号链接/);
    rmSync(join(root, 'web/public/guan/brand'), { recursive: true });
    symlinkSync(root, join(root, 'web/public/guan/brand'));
    assert.throws(() => 检查全局恢复批次(root), /符号链接/);
    symlinkSync(root, join(temp, 'linked-root'));
    assert.throws(() => 检查全局恢复批次(join(temp, 'linked-root')), /符号链接/);
    assert.throws(() => 检查全局恢复批次(root, { 文件: [{ 文件: '../outside' }] }), /逃逸/);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

for (const fault of ['middle', 'after']) test('全局恢复事务失败回退全部8文本并移除新图标：' + fault, () => {
  const temp = mkdtempSync(join(tmpdir(), 'guan-global-rollback-'));
  const root = join(temp, 'runtime'); mkdirSync(root);
  try {
    before(root);
    assert.throws(() => 事务写入(root, files, join(temp, 'snapshot'), {
      差异指纹: 全局恢复差异SHA256,
      写入前: (_, count) => { if (fault === 'middle' && count === 4) throw Error('合成途中失败'); },
      写后检查: () => { assert.equal(检查全局恢复批次(root), true); if (fault === 'after') throw Error('合成写后失败'); },
    }), /合成/);
    for (const [path, item] of files) {
      if (item.原文 === null) assert.equal(existsSync(join(root, path)), false);
      else assert.equal(readFileSync(join(root, path), 'utf8'), item.原文);
    }
    assert.equal(检查全局恢复批次(root), false);
    assert.equal(JSON.parse(readFileSync(join(temp, 'snapshot/事务.json'))).状态, '已回退');
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
