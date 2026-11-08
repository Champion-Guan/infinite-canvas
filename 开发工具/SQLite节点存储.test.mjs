import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { 根目录, 基线 } from './公共.mjs';
import { SQLite批准产物 } from './接入SQLite隔离副本.mjs';
import { 节点存储路径, 节点存储惰性候选 } from './预审SQLite节点存储.mjs';

const ts = createRequire(join(根目录, '.运行', 基线.提交, 'web/package.json'))('typescript');
const original = SQLite批准产物().get(节点存储路径).产物;
let version = 0;
async function moduleOf(source, sqliteForage) {
  globalThis.__guanSQLitePluginUnit = sqliteForage;
  const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replace(/import[^\n]+from "@\/guan\/上游浏览器存储桥";/, 'const localforage = globalThis.__guanSQLitePluginUnit;');
  try { return await import('data:text/javascript;base64,' + Buffer.from(javascript + '\n// test-' + version++).toString('base64')); }
  finally { delete globalThis.__guanSQLitePluginUnit; }
}

test('复现已批准25文件候选的真实边界缺陷：组装内置节点上下文就尝试开插件库', async () => {
  let attempts = 0;
  const source = await moduleOf(original, { createInstance() { attempts++; throw Error('namespace_denied'); } });
  assert.throws(() => source.createPluginStorage('builtin'), /namespace_denied/);
  assert.equal(attempts, 1);
});

test('候选只延后初始化，内置节点组装不打开任何数据库', async () => {
  let attempts = 0;
  const source = await moduleOf(节点存储惰性候选(original), { createInstance() { attempts++; throw Error('namespace_denied'); } });
  const storage = source.createPluginStorage('builtin');
  assert.equal(typeof storage.get, 'function'); assert.equal(attempts, 0);
  source.createPluginStorage('text'); source.createPluginStorage('image');
  assert.equal(attempts, 0);
});

test('候选未重新启用任意插件；实际get/set/remove仍异步拒绝，不回退浏览器', async () => {
  const denied = Object.assign(Error('未授权插件'), { code: 'namespace_denied' });
  const source = await moduleOf(节点存储惰性候选(original), { createInstance(options) { assert.equal(options.name, 'infinite-canvas-plugins'); throw denied; } });
  const storage = source.createPluginStorage('disabled-plugin');
  await assert.rejects(storage.get('k'), { code: 'namespace_denied' });
  await assert.rejects(storage.set('k', 'v'), { code: 'namespace_denied' });
  await assert.rejects(storage.remove('k'), { code: 'namespace_denied' });
});

test('候选保留已有异步存储契约及按pluginId实例缓存（仅合成允许端口）', async () => {
  const values = new Map(); let instances = 0;
  const source = await moduleOf(节点存储惰性候选(original), { createInstance() { instances++; return { async getItem(key) { return values.get(key) ?? null; }, async setItem(key, value) { values.set(key, value); }, async removeItem(key) { values.delete(key); } }; } });
  const one = source.createPluginStorage('synthetic-only'), two = source.createPluginStorage('synthetic-only');
  assert.equal(instances, 0); await one.set('k', 1); assert.equal(await two.get('k'), 1); await two.remove('k'); assert.equal(await one.get('k'), null); assert.equal(instances, 1);
});
