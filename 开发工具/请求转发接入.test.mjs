import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { 根目录, 上游目录 } from './公共.mjs';
import { 请求转发批准产物 } from './接入请求转发恢复.mjs';
import { 运行目录, 哈希 } from './检查运行副本.mjs';
import { 核验请求转发批准, 检查请求转发批次, 请求转发安全指纹, 请求转发差异SHA256, 请求转发前态指纹 } from '../上游适配/请求转发恢复批准.mjs';
import { 检查顶栏单来源批次, 读取顶栏单来源批准 } from '../上游适配/顶栏单来源批准.mjs';
import { 检查合并恢复批次, 读取合并恢复批准 } from '../上游适配/音视频提示词与节点信息恢复批准.mjs';
import { 检查精简主题批次, 读取精简主题批准 } from '../上游适配/精简离线与三态主题批准.mjs';
import { 检查全局恢复批次, 读取全局恢复批准 } from '../上游适配/全局界面恢复批准.mjs';
import { 事务写入 } from './接入用户功能.mjs';
const files = 请求转发批准产物();
const [target, item] = [...files][0];
// 权威候选已在上面重建并锁定；历史夹具只读取逐文件指纹匹配的快照，避免重复递归重建整条历史。
const manifests = [读取全局恢复批准(), 读取精简主题批准(), 读取合并恢复批准(), 读取顶栏单来源批准()];
const expected = new Map(manifests.flatMap(manifest => manifest.文件.map(value => [value.文件, value])));
const history = new Map([...expected].map(([path, value]) => {
  const content = path === target ? item.原文 : readFileSync(join(运行目录, path));
  assert.equal(哈希(content), value.候选SHA256, '合成历史夹具来源不是精确批准态：' + path);
  return [path, { 产物: content }];
}));
const previous = new Map(manifests.at(-1).文件.map(value => [value.文件, history.get(value.文件)]));
const put = (root, path, content) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), content); };
const setup = root => { for (const [path, item] of history) put(root, path, item.产物); };
function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'guan-relay-approval-'));
  try { setup(root); return run(root); }
  finally { rmSync(root, { recursive: true, force: true }); }
}
test('请求转发批准严格锁定原JSON/patch，不接受篡改或额外字节', () => {
  const json = readFileSync(join(根目录, '上游适配/待审查/请求转发恢复.json'));
  const patch = readFileSync(join(根目录, '上游适配/待审查/请求转发恢复.patch'));
  assert.equal(核验请求转发批准(json, patch).文件.length, 1);
  assert.throws(() => 核验请求转发批准(Buffer.concat([json, Buffer.from(' ')]), patch), /指纹/);
  assert.throws(() => 核验请求转发批准(json, Buffer.concat([patch, Buffer.from(' ')])), /指纹/);
});
test('仅完整前置与精确后态可通过全部历史保护，未知策略不能伪装恢复', () => fixture(root => {
  assert.equal(检查请求转发批次(root), false);
  assert.equal(检查顶栏单来源批次(root), true);
  put(root, target, item.产物);
  assert.equal(检查请求转发批次(root), true);
  assert.equal(请求转发前态指纹(root, target), 请求转发安全指纹(创建前态(root), target));
  for (const check of [检查顶栏单来源批次, 检查合并恢复批次, 检查精简主题批次, 检查全局恢复批次]) assert.equal(check(root), true);
  put(root, target, item.产物 + '\n// unknown');
  assert.equal(检查请求转发批次(root), false);
  assert.throws(() => 检查顶栏单来源批次(root), /未知|不完整/);
}));
function 创建前态(root) {
  const before = join(root, 'only-before'); put(before, target, item.原文); return before;
}
test('恢复1文件时仍严格检查其他9份前置，逐份未知或丢失均拒绝', () => fixture(root => {
  put(root, target, item.产物);
  for (const [path, value] of previous) {
    if (path === target) continue;
    put(root, path, 'unknown'); assert.throws(() => 检查请求转发批次(root), /不完整|未知/);
    assert.throws(() => 检查顶栏单来源批次(root), /不完整|未知/);
    rmSync(join(root, path)); assert.throws(() => 检查请求转发批次(root), /不完整|未知/);
    put(root, path, value.产物);
  }
  assert.equal(检查请求转发批次(root), true);
}));
test('符号链接根/父目录/文件及路径逃逸均拒绝', () => fixture(root => {
  assert.throws(() => 请求转发安全指纹(root, '../outside'), /逃逸/);
  const linked = join(root, 'linked'); symlinkSync(root, linked);
  assert.throws(() => 检查请求转发批次(linked), /符号链接/);
  rmSync(join(root, target)); symlinkSync(join(上游目录, 'web/src/stores/use-config-store.ts'), join(root, target));
  assert.throws(() => 检查请求转发批次(root), /符号链接/);
  rmSync(join(root, 'web/src/guan'), { recursive: true }); symlinkSync(join(root, 'web/src/components'), join(root, 'web/src/guan'));
  assert.throws(() => 检查请求转发批次(root), /符号链接/);
}));
for (const fault of ['before', 'after']) test('请求转发事务失败自动恢复原策略：' + fault, () => fixture(root => {
  const snapshot = join(root, 'snapshot');
  assert.throws(() => 事务写入(root, files, snapshot, {
    差异指纹: 请求转发差异SHA256,
    写入前: () => { if (fault === 'before') throw Error('合成失败'); },
    写后检查: () => { assert.equal(检查请求转发批次(root), true); if (fault === 'after') throw Error('合成失败'); },
  }), /合成失败/);
  assert.equal(readFileSync(join(root, target), 'utf8'), item.原文);
  assert.equal(检查请求转发批次(root), false);
  assert.equal(检查顶栏单来源批次(root), true);
  assert.equal(JSON.parse(readFileSync(join(snapshot, '事务.json'))).状态, '已回退');
}));
