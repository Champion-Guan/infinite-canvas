import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { 检查适配内容, 检查副本路径, 哈希 } from './检查运行副本.mjs';

const 原文 = Buffer.from('样式\n content: { height: 100 }\n');
const 新文 = Buffer.from('样式\n container: { height: 100 }\n');
const 声明 = { 原始SHA256: 哈希(原文), 适配SHA256: 哈希(新文), 替换前: 'content:', 替换后: 'container:' };

test('批准适配生成精确内容，已应用时幂等，不写任何文件', () => {
  assert.deepEqual(检查适配内容(原文, 原文, 声明), { 已适配: false, 新文 });
  assert.deepEqual(检查适配内容(原文, 新文, 声明), { 已适配: true, 新文 });
});
test('未知原版或目标改动拒绝覆盖', () => {
  assert.throws(() => 检查适配内容(Buffer.from('其他源码'), 原文, 声明), /原版文件指纹/);
  assert.throws(() => 检查适配内容(原文, Buffer.from('用户改动'), 声明), /未知改动/);
});
test('重复替换位置和伪造产物指纹拒绝应用', () => {
  const 重复 = Buffer.concat([原文, 原文]);
  assert.throws(() => 检查适配内容(重复, 重复, { ...声明, 原始SHA256: 哈希(重复) }), /不唯一/);
  assert.throws(() => 检查适配内容(原文, 原文, { ...声明, 适配SHA256: '0'.repeat(64) }), /产物指纹/);
});
test('实际批准清单只改变一行语义名称，样式值不变', () => {
  const 清单 = JSON.parse(readFileSync(new URL('../上游适配/模型编辑器语义.json', import.meta.url)));
  const 源 = readFileSync(new URL('../../infinite-canvas-upstream/' + 清单.文件, import.meta.url));
  const 结果 = 检查适配内容(源, 源, 清单);
  assert.equal(结果.新文.toString().replace(清单.替换后, 清单.替换前), 源.toString());
});
test('真实路径在副本之外或仅具有相似前缀时拒绝，防止符号链接逃逸', () => {
  assert.doesNotThrow(() => 检查副本路径('/mock/runtime', '/mock/runtime/web/src/test.tsx'));
  assert.throws(() => 检查副本路径('/mock/runtime', '/mock/upstream/web/src/test.tsx'), /副本之外/);
  assert.throws(() => 检查副本路径('/mock/runtime', '/mock/runtime-other/web/src/test.tsx'), /副本之外/);
});
