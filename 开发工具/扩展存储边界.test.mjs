import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { createExtensionStorage } from '../扩展功能/扩展边界/存储端口.mjs';

test('自有扩展按固定命名空间读写，不导出底层客户端', async () => {
  const calls = [], client = { readDocument: async (...args) => calls.push(args), writeDocument: async args => { calls.push(args); return { persisted: true }; } };
  const a = createExtensionStorage({ extensionId: 'excel-import', client }), b = createExtensionStorage({ extensionId: 'product-space', client });
  await a.read('settings'); await b.read('settings');
  assert.deepEqual(calls, [['extension', 'excel-import::settings'], ['extension', 'product-space::settings']]);
  const operationId = randomUUID(); assert.deepEqual(await a.write({ id: 'settings', value: { schemaVersion: 1 }, operationId, expectedRevision: 0 }), { persisted: true });
  assert.equal(calls[2].operationId, operationId); assert.equal(a.client, undefined); assert.equal(Object.isFrozen(a), true);
  assert.throws(() => a.read('../other')); assert.throws(() => a.read('other::settings'));
  assert.throws(() => createExtensionStorage({ extensionId: 'evil::id', client }));
});

test('存储及服务实现不反向导入原作者、运行副本、React或浏览器数据库', () => {
  for (const folder of ['本机存储', '本机服务', '扩展边界']) {
    const root = new URL(`../扩展功能/${folder}/`, import.meta.url);
    for (const name of readdirSync(root)) {
      const source = readFileSync(new URL(name, root), 'utf8');
      for (const match of source.matchAll(/(?:from\s+|import\s*\()['"]([^'"]+)['"]/g)) {
        assert.equal(/infinite-canvas-upstream|\.运行|@\/|react|localforage|zustand/.test(match[1]), false, `${name}越过边界`);
      }
      assert.equal(/(?:localStorage|sessionStorage)\.setItem|indexedDB\.open/.test(source), false, `${name}不得静默回退浏览器存储`);
    }
  }
});
