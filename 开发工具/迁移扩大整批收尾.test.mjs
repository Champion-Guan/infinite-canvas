import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ts } from './检查首批功能适配.mjs';
import { 根目录 } from './公共.mjs';
import { 构建迁移扩大整批收尾候选 } from './预审迁移扩大整批收尾.mjs';
import { decodeInlineImage } from '../扩展功能/画布迁移扩展/内嵌图片解码.mjs';

const preview = 构建迁移扩大整批收尾候选();
const changedStorage = preview.delta.get('画布副本/web/src/services/image-storage.ts');
const bytes = readFileSync(join(根目录, '开发工具/测试数据/迁移扩大整批合成参考.png'));
const data = 'data:image/png;base64,' + bytes.toString('base64');
function storageFixture(source, failSave = false) {
  const stores = new Map(); let fetches = 0, writes = 0;
  class ImageFixture {
    naturalWidth = 1; naturalHeight = 1;
    set src(_value) { queueMicrotask(() => this.onload?.()); }
  }
  const exports = {}, code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const modules = {
    '@/guan/上游浏览器存储桥': { sqliteForage: { createInstance({ storeName }) {
      if (!stores.has(storeName)) stores.set(storeName, new Map()); const state = stores.get(storeName);
      return { getItem: async key => state.get(key), async setItem(key, value) { writes++; if (failSave) throw Error('SYNTHETIC_SAVE_FAILURE'); state.set(key, value); return value; }, removeItem: async key => state.delete(key) };
    } } },
    nanoid: { nanoid: () => 'synthetic-id' }, '@/guan/media/内嵌图片解码.mjs': { decodeInlineImage },
    '@/guan/recovery/persistence-checkpoint': { createPersistenceCheckpoint: () => ({ run: (_key, action) => action() }) },
    '@/guan/recovery/settle-activity-group': { settleActivityGroup: async actions => Promise.all(actions) },
    '@/i18n': { default: { t: key => key } }, '@/stores/use-config-store': { withLocalProxy: value => value },
    '@/lib/image-thumbnail': { createImageThumbnail: async () => undefined },
  };
  const context = vm.createContext({ exports, module: { exports }, Blob, URL, Uint8Array, AbortController, AbortSignal, DOMException, Error,
    window: { setTimeout, clearTimeout }, Image: ImageFixture, queueMicrotask, console,
    fetch: async () => { fetches++; throw Error('SYNTHETIC_CSP_BLOCK'); },
    require(name) { if (!(name in modules)) throw Error('Unexpected module: ' + name); return modules[name]; },
  });
  vm.runInContext(code, context);
  return { api: exports, stores, counters: () => ({ fetches, writes }) };
}
test('复现旧管线的CSP拒绝；候选在禁止全部fetch时仍保存原PNG字节', async () => {
  const old = storageFixture(changedStorage.原文);
  await assert.rejects(old.api.uploadImage(data), /SYNTHETIC_CSP_BLOCK/);
  const fixed = storageFixture(changedStorage.产物), result = await fixed.api.uploadImage(data);
  assert.equal(result.width, 1); assert.equal(result.height, 1); assert.equal(result.mimeType, 'image/png');
  const saved = fixed.stores.get('image_files').get(result.storageKey);
  assert.deepEqual(Buffer.from(await saved.arrayBuffer()), bytes);
  assert.equal(fixed.counters().fetches, 0);
});
test('内嵌图片取消、空数据和损坏编码均不写媒体或回退网络', async () => {
  const f = storageFixture(changedStorage.产物), controller = new AbortController(); controller.abort();
  await assert.rejects(f.api.uploadImage(data, { signal: controller.signal }), { name: 'AbortError' });
  for (const invalid of ['data:image/png;base64,', 'data:image/png;base64,A', 'data:image/png;base64,%%%']) await assert.rejects(f.api.uploadImage(invalid));
  assert.deepEqual(f.counters(), { fetches: 0, writes: 0 });
  for (const invalid of ['data:text/html;base64,YQ==', 'https://example.com/a.png']) assert.throws(() => decodeInlineImage(invalid));
});
test('候选保存失败向上抛出并清理半写记录，不重新请求', async () => {
  const f = storageFixture(changedStorage.产物, true);
  await assert.rejects(f.api.uploadImage(data), /SYNTHETIC_SAVE_FAILURE/);
  assert.equal(f.counters().fetches, 0); assert.equal(f.stores.get('image_files').size, 0);
});
test('Blob输入继续保存，HTTP输入继续走原路径；仅包含五文件具体后继', async () => {
  const f = storageFixture(changedStorage.产物), blob = new Blob([bytes], { type: 'image/png' });
  const saved = await f.api.uploadImage(blob); assert.equal(saved.bytes, bytes.length);
  const remote = await f.api.uploadImage('https://invalid.fixture.example/a.png');
  assert.equal(remote.url, 'https://invalid.fixture.example/a.png'); assert.equal(remote.bytes, 0);
  assert.equal(f.counters().fetches, 1); assert.equal(preview.delta.size, 5);
  assert.equal([...preview.delta.values()].filter(item => item.原文 === null).length, 1);
});
