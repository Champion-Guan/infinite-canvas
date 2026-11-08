import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { 根目录 } from './公共.mjs';
import { 精简主题批准产物 } from './接入精简离线与三态主题.mjs';
import { 全局恢复批准产物 } from './接入全局界面恢复.mjs';
import { 生成首页顶栏候选 } from './生成首页顶栏候选.mjs';
import { 生成脚本来源候选 } from './预审脚本与提示词来源.mjs';
import { 读取精简主题批准, 核验精简主题批准, 检查精简主题批次, 精简主题差异SHA256 } from '../上游适配/精简离线与三态主题批准.mjs';
import { 检查全局恢复批次 } from '../上游适配/全局界面恢复批准.mjs';
import { 读取脚本来源批准, 检查脚本来源批次 } from '../上游适配/脚本与提示词来源批准.mjs';
import { 读取顶栏批准, 检查顶栏批次 } from '../上游适配/首页顶栏批准.mjs';
import { 事务写入 } from './接入用户功能.mjs';

const files = 精简主题批准产物();
const put = (root, path, content) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), content); };
function before(root) {
  for (const [path, item] of new Map([...生成首页顶栏候选(), ...生成脚本来源候选(), ...全局恢复批准产物()])) put(root, path, item.产物);
  for (const [path, item] of files) if (item.原文 !== null) put(root, path, item.原文);
}

test('精简主题精确21文件、JSON/patch篡改拒绝，保留历史审批', () => {
  assert.equal(files.size, 21);
  assert.equal(读取精简主题批准().文件.length, 21);
  const json = readFileSync(join(根目录, '上游适配/待审查/精简离线与三态主题.json'));
  const patch = readFileSync(join(根目录, '上游适配/待审查/精简离线与三态主题.patch'));
  assert.throws(() => 核验精简主题批准(Buffer.concat([json, Buffer.from(' ')]), patch), /指纹/);
  assert.throws(() => 核验精简主题批准(json, Buffer.concat([patch, Buffer.from(' ')])), /指纹/);
});

test('完整前后态可识别；半批/未知拒绝；前几批只接受完整精确后继', () => {
  const root = mkdtempSync(join(tmpdir(), 'guan-offline-guard-'));
  try {
    before(root);
    assert.equal(检查精简主题批次(root), false);
    const [first, item] = files.entries().next().value;
    put(root, first, item.产物);
    assert.throws(() => 检查精简主题批次(root), /不完整/);
    assert.throws(() => 检查全局恢复批次(root), /不完整/);
    assert.throws(() => 检查脚本来源批次(root, 读取脚本来源批准()), /不完整/);
    for (const [path, value] of files) put(root, path, value.产物);
    assert.equal(检查精简主题批次(root), true);
    assert.equal(检查全局恢复批次(root), true);
    assert.equal(检查脚本来源批次(root, 读取脚本来源批准()), true);
    assert.equal(检查顶栏批次(root, 读取顶栏批准()), true);
    put(root, first, '未知');
    assert.throws(() => 检查精简主题批次(root), /不完整/);
    put(root, first, item.产物);
    put(root, 'web/src/guan/三态主题状态.ts', '未知');
    assert.throws(() => 检查精简主题批次(root), /未知/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('精简主题拒绝根/父目录/文件符号链接及逃逸路径', () => {
  const temp = mkdtempSync(join(tmpdir(), 'guan-offline-links-'));
  const root = join(temp, 'runtime'); mkdirSync(root);
  try {
    before(root);
    for (const [path, value] of files) put(root, path, value.产物);
    const path = 'web/src/guan/三态主题状态.ts';
    rmSync(join(root, path)); symlinkSync(join(root, 'web/index.html'), join(root, path));
    assert.throws(() => 检查精简主题批次(root), /符号链接/);
    rmSync(join(root, 'web/src/guan'), { recursive: true });
    symlinkSync(root, join(root, 'web/src/guan'));
    assert.throws(() => 检查精简主题批次(root), /符号链接/);
    symlinkSync(root, join(temp, 'linked-root'));
    assert.throws(() => 检查精简主题批次(join(temp, 'linked-root')), /符号链接/);
    assert.throws(() => 检查精简主题批次(root, { 文件: [{ 文件: '../outside' }] }), /逃逸/);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

for (const fault of ['middle', 'after']) test('21文件事务途中/写后失败恢复17份原文件且移除4份新产物：' + fault, () => {
  const temp = mkdtempSync(join(tmpdir(), 'guan-offline-rollback-'));
  const root = join(temp, 'runtime'); mkdirSync(root);
  try {
    before(root);
    // 新模块先写，验证失败时它们确实会被撤销。
    const ordered = new Map([...files].sort(([, a], [, b]) => Number(a.原文 !== null) - Number(b.原文 !== null)));
    assert.throws(() => 事务写入(root, ordered, join(temp, 'snapshot'), {
      差异指纹: 精简主题差异SHA256,
      写入前: (_, count) => { if (fault === 'middle' && count === 11) throw Error('合成途中失败'); },
      写后检查: () => { assert.equal(检查精简主题批次(root), true); if (fault === 'after') throw Error('合成写后失败'); },
    }), /合成/);
    for (const [path, item] of files) {
      if (item.原文 === null) assert.equal(existsSync(join(root, path)), false);
      else assert.equal(readFileSync(join(root, path), 'utf8'), item.原文);
    }
    assert.equal(检查精简主题批次(root), false);
    assert.equal(检查全局恢复批次(root), true);
    assert.equal(JSON.parse(readFileSync(join(temp, 'snapshot/事务.json'))).状态, '已回退');
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
