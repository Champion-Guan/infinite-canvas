import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { 根目录 } from './公共.mjs';
import { 合并恢复批准产物 } from './接入音视频提示词与节点信息恢复.mjs';
import { 精简主题批准产物 } from './接入精简离线与三态主题.mjs';
import { 全局恢复批准产物 } from './接入全局界面恢复.mjs';
import { 生成首页顶栏候选 } from './生成首页顶栏候选.mjs';
import { 生成脚本来源候选 } from './预审脚本与提示词来源.mjs';
import { 核验合并恢复批准, 读取合并恢复批准, 检查合并恢复批次, 合并恢复历史映射, 合并恢复差异SHA256 } from '../上游适配/音视频提示词与节点信息恢复批准.mjs';
import { 检查精简主题批次, 精简主题历史映射 } from '../上游适配/精简离线与三态主题批准.mjs';
import { 检查全局恢复批次 } from '../上游适配/全局界面恢复批准.mjs';
import { 检查脚本来源批次, 读取脚本来源批准 } from '../上游适配/脚本与提示词来源批准.mjs';
import { 检查顶栏批次, 读取顶栏批准 } from '../上游适配/首页顶栏批准.mjs';
import { 事务写入 } from './接入用户功能.mjs';
import { 顶栏单来源批准产物 } from './接入顶栏单来源.mjs';

const files = 合并恢复批准产物();
const revised = 顶栏单来源批准产物();
const put = (root, path, text) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); };
function before(root) {
  for (const [path, item] of new Map([...生成首页顶栏候选(), ...生成脚本来源候选(), ...全局恢复批准产物(), ...精简主题批准产物()])) put(root, path, item.产物);
  // 历史fixture补齐最新校验器涉及但本恢复批次没有改动的文件，使用锁定批准前态而非当前运行内容。
  for (const [path, item] of revised) if (!existsSync(join(root, path))) put(root, path, item.原文);
}

test('恢复精确10文件，锁定JSON和patch，不允许篡改', () => {
  assert.equal(files.size, 10); assert.equal(读取合并恢复批准().文件.length, 10);
  const json = readFileSync(join(根目录, '上游适配/待审查/音视频提示词与节点信息恢复.json'));
  const patch = readFileSync(join(根目录, '上游适配/待审查/音视频提示词与节点信息恢复.patch'));
  assert.throws(() => 核验合并恢复批准(Buffer.concat([json, Buffer.from(' ')]), patch), /指纹/);
  assert.throws(() => 核验合并恢复批准(json, Buffer.concat([patch, Buffer.from(' ')])), /指纹/);
});

test('完整前后态及历史链识别；逐份半批和未知文件拒绝，不给路径豁免', () => {
  const root = mkdtempSync(join(tmpdir(), 'guan-restored-guard-'));
  try {
    before(root); assert.equal(检查合并恢复批次(root), false);
    for (const [path, item] of files) {
      put(root, path, item.产物);
      assert.throws(() => 检查精简主题批次(root), /不完整/);
      put(root, path, item.原文);
    }
    for (const [path, item] of files) put(root, path, item.产物);
    assert.equal(检查合并恢复批次(root), true);
    assert.equal(检查精简主题批次(root), true); assert.equal(检查全局恢复批次(root), true);
    assert.equal(检查脚本来源批次(root, 读取脚本来源批准()), true); assert.equal(检查顶栏批次(root, 读取顶栏批准()), true);
    assert.equal(合并恢复历史映射(root).size, 10); assert.equal(精简主题历史映射(root).size, 21);
    for (const [path, item] of files) {
      put(root, path, item.原文); assert.throws(() => 检查合并恢复批次(root), /不完整/);
      put(root, path, '未知改动'); assert.throws(() => 检查合并恢复批次(root), /未知/);
      put(root, path, item.产物);
    }
    put(root, 'web/src/guan/三态主题状态.ts', '未知改动');
    assert.throws(() => 检查精简主题批次(root), /未知/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('恢复保护拒绝根、父目录、文件符号链接与逃逸', () => {
  const temp = mkdtempSync(join(tmpdir(), 'guan-restored-links-')), root = join(temp, 'runtime'); mkdirSync(root);
  try {
    before(root);
    const path = 'web/src/guan/精简与离线策略.ts';
    rmSync(join(root, path)); symlinkSync(join(root, 'web/index.html'), join(root, path));
    assert.throws(() => 检查合并恢复批次(root), /符号链接/);
    rmSync(join(root, 'web/src/guan'), { recursive: true }); symlinkSync(root, join(root, 'web/src/guan'));
    assert.throws(() => 检查合并恢复批次(root), /符号链接/);
    symlinkSync(root, join(temp, 'linked-root')); assert.throws(() => 检查合并恢复批次(join(temp, 'linked-root')), /符号链接/);
    assert.throws(() => 检查合并恢复批次(root, { 文件: [{ 文件: '../outside' }] }), /逃逸/);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

for (const fault of ['middle', 'after']) test('恢复事务途中/写后失败还原全部10份原文件：' + fault, () => {
  const temp = mkdtempSync(join(tmpdir(), 'guan-restored-rollback-')), root = join(temp, 'runtime'); mkdirSync(root);
  try {
    before(root);
    assert.throws(() => 事务写入(root, files, join(temp, 'snapshot'), {
      差异指纹: 合并恢复差异SHA256,
      写入前: (_, count) => { if (fault === 'middle' && count === 5) throw Error('合成途中失败'); },
      写后检查: () => { assert.equal(检查合并恢复批次(root), true); if (fault === 'after') throw Error('合成写后失败'); },
    }), /合成/);
    for (const [path, item] of files) assert.equal(readFileSync(join(root, path), 'utf8'), item.原文);
    assert.equal(检查合并恢复批次(root), false); assert.equal(检查精简主题批次(root), true);
    assert.equal(JSON.parse(readFileSync(join(temp, 'snapshot/事务.json'))).状态, '已回退');
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
