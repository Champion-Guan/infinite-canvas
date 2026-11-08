import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { 构建Excel行高候选, Excel行高目标 } from './预审Excel弹窗行高.mjs';
import { 核验SQLite会话恢复完整包 } from './接入SQLite会话恢复隔离副本.mjs';
import { 生成审查差异 } from './检查首批功能适配.mjs';

const preview = 构建Excel行高候选(), item = preview.delta.get(Excel行高目标);
test('唯一产物是自有Excel样式，没有作者核心或业务改动', () => {
  assert.deepEqual([...preview.delta.keys()], [Excel行高目标]);
  assert.equal(item.产物, item.原文 + '\n' + preview.boundary);
});
test('所有旧CSS原字节保留，边界只有行高和字体平滑两条声明', () => {
  assert.ok(item.产物.startsWith(item.原文));
  assert.equal(preview.boundary.match(/\{/g).length, 1);
  assert.equal(preview.boundary.match(/;/g).length, 2);
  assert.match(preview.boundary, /\.guan-excel-scope \.guan-dc-excel-import-modal \{\n {2}line-height: 1\.5;/);
  assert.match(preview.boundary, /-webkit-font-smoothing: antialiased;/);
  assert.doesNotMatch(preview.boundary, /!important|(?:^|\n)(?:html|body|\*)\b/);
});
test('差异只追加局部行高，没有删除、React或数据协议改动', () => {
  const patch = 生成审查差异(preview.delta);
  assert.equal(patch.split('\n').filter(line => line.startsWith('-') && !line.startsWith('---')).length, 0);
  assert.match(patch, /line-height: 1\.5/);
  assert.doesNotMatch(patch, /use-canvas-store|Excel导入面板|受控会话|globals\.css/);
});
test('预审没有修改完整批准前置磁盘包', () => {
  assert.equal(readFileSync(join(preview.integration.副本, Excel行高目标), 'utf8'), item.原文);
  核验SQLite会话恢复完整包(preview.integration.组合包, true);
});
