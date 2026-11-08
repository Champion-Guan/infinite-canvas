import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { 根目录 } from './公共.mjs';
import { 运行目录, 哈希 } from './检查运行副本.mjs';
import { 生成审查差异 } from './检查首批功能适配.mjs';
import { 工作台HTML授权候选, 生成SQLite工作台授权候选, 授权入口模块, 授权入口审查名 } from './预审SQLite工作台授权入口.mjs';

test('授权只改HTML模块入口，锚点漂移/重复应用均拒绝', () => {
  const html = '<div id="root"></div><script type="module" src="/src/main.tsx"></script>';
  const result = 工作台HTML授权候选(html);
  assert.equal(result.replace('/src/guan/sqlite/启动工作台.mjs', '/src/main.tsx'), html);
  assert.throws(() => 工作台HTML授权候选(result), /锚点/);
  assert.throws(() => 工作台HTML授权候选(html + html), /锚点/);
});

test('候选9文件包含8份逐字自有模块，原main和布局不改、不写3100', () => {
  const path = join(运行目录, 'web/index.html'), before = readFileSync(path), { delta, prerequisite, combined } = 生成SQLite工作台授权候选();
  assert.equal(delta.size, 9); assert.equal(delta.has('web/src/main.tsx'), false);
  assert.equal(delta.get('web/index.html').原文, prerequisite.get('web/index.html').产物);
  assert.equal(combined.get('web/src/main.tsx').产物, prerequisite.get('web/src/main.tsx').产物);
  for (const name of 授权入口模块) assert.equal(delta.get('web/src/guan/sqlite/' + name).产物, readFileSync(join(根目录, '扩展功能/本机存储', name), 'utf8'));
  assert.deepEqual(readFileSync(path), before);
});

test('审查JSON与patch若已存在必须与候选精确一致，不修改历史快照', () => {
  const { delta } = 生成SQLite工作台授权候选();
  const manifest = JSON.parse(readFileSync(join(根目录, '上游适配/待审查', 授权入口审查名 + '.json')));
  const patch = readFileSync(join(根目录, '上游适配/待审查', 授权入口审查名 + '.patch'), 'utf8');
  assert.equal(manifest.状态, '待具体9文件差异批准，未应用任何运行副本');
  assert.equal(生成审查差异(delta), patch); assert.equal(哈希(patch), manifest.差异SHA256);
  for (const item of manifest.文件) assert.equal(哈希(delta.get(item.文件).产物), item.候选SHA256);
});
