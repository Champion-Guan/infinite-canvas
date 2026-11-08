import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { 根目录 } from './公共.mjs';
import { 哈希 } from './检查运行副本.mjs';
import { 构建分片候选, 自动入口分片候选, 预审分片存储 } from './预审SQLite分片存储.mjs';
import { 保存恢复差异SHA256, 核验保存恢复自有依赖 } from '../上游适配/SQLite保存恢复批准.mjs';

test('分片候选仅四文件：入口单行import及三份新模块，完整批准前置保持原字节', () => {
  const { delta, prerequisite, combined } = 构建分片候选(); assert.equal(delta.size, 4);
  assert.deepEqual([...delta.keys()], ['web/src/guan/sqlite/工作台自动入口.mjs', 'web/src/guan/sqlite/分片值编码.mjs', 'web/src/guan/sqlite/分片应用存储.mjs', 'web/src/guan/sqlite/可恢复分片应用存储.mjs']);
  for (const [path, item] of prerequisite) if (!delta.has(path)) assert.deepEqual(combined.get(path), item);
  for (const [path, item] of delta) {
    if (path.endsWith('/工作台自动入口.mjs')) assert.equal(item.产物, item.原文.replace("import { createRecoverableApplicationStorage as createApplicationStorage } from './可恢复应用存储.mjs';", "import { createRecoverableShardedApplicationStorage as createApplicationStorage } from './可恢复分片应用存储.mjs';"));
    else { assert.equal(item.原文, null); assert.equal(item.产物, readFileSync(join(根目录, '扩展功能/本机存储', path.split('/').at(-1)), 'utf8')); }
  }
  核验保存恢复自有依赖(根目录);
});
test('分片入口拒绝缺失或重复前态，不提供应用/生产选项', () => {
  const source = "import { createRecoverableApplicationStorage as createApplicationStorage } from './可恢复应用存储.mjs';";
  assert.throws(() => 自动入口分片候选('export{}'));
  assert.throws(() => 自动入口分片候选(source + '\n' + source));
  assert.throws(() => execFileSync(process.execPath, ['开发工具/预审SQLite分片存储.mjs', '--应用已批准差异'], { cwd: 根目录, stdio: 'pipe' }));
});
test('分片预审清单与具体diff锁定完整历史前置，审查快照存在时须逐字一致', () => {
  const manifest = 预审分片存储(); assert.equal(manifest.前置保存恢复差异SHA256, 保存恢复差异SHA256); assert.equal(manifest.文件.length, 4);
  assert.match(manifest.状态, /待用户批准/);
  const json = join(根目录, '上游适配/待审查/SQLite分片存储.json'), patch = join(根目录, '上游适配/待审查/SQLite分片存储.patch');
  if (existsSync(json) || existsSync(patch)) { assert.deepEqual(JSON.parse(readFileSync(json, 'utf8')), manifest); assert.equal(哈希(readFileSync(patch)), manifest.差异SHA256); }
});
