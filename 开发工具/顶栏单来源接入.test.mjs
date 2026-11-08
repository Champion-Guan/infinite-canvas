import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { 根目录 } from './公共.mjs';
import { 顶栏单来源批准产物 } from './接入顶栏单来源.mjs';
import { 合并恢复批准产物 } from './接入音视频提示词与节点信息恢复.mjs';
import { 精简主题批准产物 } from './接入精简离线与三态主题.mjs';
import { 全局恢复批准产物 } from './接入全局界面恢复.mjs';
import { 核验顶栏单来源批准, 检查顶栏单来源批次, 顶栏单来源差异SHA256, 修订前态指纹 } from '../上游适配/顶栏单来源批准.mjs';
import { 检查合并恢复批次 } from '../上游适配/音视频提示词与节点信息恢复批准.mjs';
import { 检查精简主题批次 } from '../上游适配/精简离线与三态主题批准.mjs';
import { 检查全局恢复批次 } from '../上游适配/全局界面恢复批准.mjs';
import { 事务写入 } from './接入用户功能.mjs';
const files = 顶栏单来源批准产物();
const put = (root, path, text) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); };
function before(root) {
  for (const [path, item] of new Map([...全局恢复批准产物(), ...精简主题批准产物(), ...合并恢复批准产物()])) put(root, path, item.产物);
  for (const [path, item] of files) put(root, path, item.原文);
}
test('修订批准JSON/patch保持原字节，精确10文件', () => {
  const json = readFileSync(join(根目录, '上游适配/待审查/保留顶栏主题与单测试来源.json'));
  const patch = readFileSync(join(根目录, '上游适配/待审查/保留顶栏主题与单测试来源.patch'));
  assert.equal(核验顶栏单来源批准(json, patch).文件.length, 10);
  assert.throws(() => 核验顶栏单来源批准(Buffer.concat([json, Buffer.from(' ')]), patch), /指纹/);
  assert.throws(() => 核验顶栏单来源批准(json, Buffer.concat([patch, Buffer.from(' ')])), /指纹/);
});
test('完整前后态、逐份半批/未知拒绝，最新后继仍严格验证旧链', () => {
  const root = mkdtempSync(join(tmpdir(), 'guan-single-source-'));
  try {
    before(root); assert.equal(检查顶栏单来源批次(root), false);
    for (const [path, item] of files) { put(root, path, item.产物); assert.throws(() => 检查顶栏单来源批次(root), /不完整/); put(root, path, item.原文); }
    for (const [path, item] of files) put(root, path, item.产物);
    assert.equal(检查顶栏单来源批次(root), true);
    assert.equal(检查合并恢复批次(root), true); assert.equal(检查精简主题批次(root), true); assert.equal(检查全局恢复批次(root), true);
    for (const [path, item] of files) {
      assert.equal(修订前态指纹(root, path), 哈希文本(item.原文));
      put(root, path, item.原文); assert.throws(() => 检查顶栏单来源批次(root), /不完整/);
      put(root, path, 'unknown'); assert.throws(() => 检查合并恢复批次(root), /未知/); put(root, path, item.产物);
    }
    put(root, 'web/src/guan/三态主题状态.ts', 'unknown'); assert.throws(() => 检查精简主题批次(root), /未知/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
import { createHash } from 'node:crypto';
const 哈希文本 = text => createHash('sha256').update(text).digest('hex');
test('根、父目录、文件符号链接与路径逃逸均拒绝', () => {
  const temp = mkdtempSync(join(tmpdir(), 'guan-single-links-')), root = join(temp, 'runtime'); mkdirSync(root);
  try {
    before(root); const path = [...files.keys()][0]; rmSync(join(root, path)); symlinkSync(join(root, 'web/index.html'), join(root, path));
    assert.throws(() => 检查顶栏单来源批次(root), /符号链接/);
    rmSync(join(root, 'web/src/guan'), { recursive: true }); symlinkSync(root, join(root, 'web/src/guan'));
    assert.throws(() => 检查顶栏单来源批次(root), /符号链接/);
    symlinkSync(root, join(temp, 'linked')); assert.throws(() => 检查顶栏单来源批次(join(temp, 'linked')), /符号链接/);
    assert.throws(() => 检查顶栏单来源批次(root, { 文件: [{ 文件: '../outside' }] }), /逃逸/);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
for (const fault of ['middle', 'after']) test('10文件事务失败自动回退：' + fault, () => {
  const temp = mkdtempSync(join(tmpdir(), 'guan-single-rollback-')), root = join(temp, 'runtime'); mkdirSync(root);
  try {
    before(root);
    assert.throws(() => 事务写入(root, files, join(temp, 'snapshot'), {
      差异指纹: 顶栏单来源差异SHA256,
      写入前: (_, count) => { if (fault === 'middle' && count === 5) throw Error('合成失败'); },
      写后检查: () => { assert.equal(检查顶栏单来源批次(root), true); if (fault === 'after') throw Error('合成失败'); },
    }), /合成失败/);
    for (const [path, item] of files) assert.equal(readFileSync(join(root, path), 'utf8'), item.原文);
    assert.equal(检查顶栏单来源批次(root), false); assert.equal(检查合并恢复批次(root), true);
    assert.equal(JSON.parse(readFileSync(join(temp, 'snapshot/事务.json'))).状态, '已回退');
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
