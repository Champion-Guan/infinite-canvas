import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { mkdtempSync, readFileSync, rmSync, existsSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { 根目录 } from './公共.mjs';
import { ts } from './检查首批功能适配.mjs';
import * as ownership from '../扩展功能/本机存储/回收站归属.mjs';
import { openWorkspace } from '../扩展功能/本机存储/SQLite工作区.mjs';
import { createRecoverableShardedApplicationStorage } from '../扩展功能/本机存储/可恢复分片应用存储.mjs';
import { startDataService } from '../扩展功能/本机服务/数据服务.mjs';
import { createDataClient } from '../扩展功能/本机存储/浏览器适配.mjs';

const source = path => readFileSync(join(根目录, path), 'utf8');
function load(text, imports = {}) {
  const context = vm.createContext({ exports: {}, require(name) { if (!(name in imports)) throw Error('未知测试导入：' + name); return imports[name]; }, console });
  vm.runInContext(ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, context);
  return context.exports;
}
// 直接使用已装配服务中的真实递归收集函数，避免测试替身遗漏原图/交付图。
function collector(path, name) {
  const file = ts.createSourceFile(path, source(path), ts.ScriptTarget.Latest, true);
  return load(file.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(file))[name];
}
const collectImageStorageKeys = collector('.运行/3100源/画布副本/web/src/services/image-storage.ts', 'collectImageStorageKeys');
const collectMediaStorageKeys = collector('.运行/3100源/画布副本/web/src/services/file-storage.ts', 'collectMediaStorageKeys');
const mediaNode = (key, extra = {}) => ({ id: key, metadata: { storageKey: key, ...extra } });
function state() {
  return { hydrated: true, projects: [{ id: 'active', nodes: [mediaNode('image:shared')] }],
    deletedProjects: [{ id: 'deleted', deletedAt: '2026-10-27', project: { id: 'deleted', nodes: [mediaNode('image:delivery', { originalStorageKey: 'image:original' }), mediaNode('image:shared'), mediaNode('video:deleted'), mediaNode('audio:deleted')] } }],
    guanWorkbooks: { contract: { productSets: [{ id: 'live-book' }], products: [{ id: 'deleted', productSetId: 'live-book' }],
      tasks: [{ id: 'task', productId: 'deleted' }], runs: [{ id: 'run', taskId: 'task' }], providerAttempts: [{ id: 'attempt', runId: 'run' }], assets: [{ id: 'result', providerAttemptId: 'attempt', storageKey: 'image:result' }] },
      recycledWorkbooks: [{ id: 'book', deletedAt: '2026-10-27', workbook: { id: 'book' }, projects: [{ id: 'book-product', nodes: [mediaNode('video:book')] }], records: { tasks: [{ id: 'book-task', productId: 'book-product' }] } }] } };
}

test('活跃Excel内已回收产品按自身归属，任意合同顺序的任务链全部跟随', () => {
  const s = state(); s.guanWorkbooks.contract = Object.fromEntries(Object.entries(s.guanWorkbooks.contract).reverse());
  const own = ownership.recycleOwnership(s);
  for (const id of ['deleted', 'task', 'run', 'attempt', 'result']) assert.equal(own.productIds.has(id), true, id);
  assert.equal(own.activeIds.has('deleted'), false);
  assert.equal(ownership.recycleCategory(s.guanWorkbooks.contract.products[0], own), 'product_recycle');
  assert.equal(ownership.recycleCategory({ runId: 'run' }, own), 'product_recycle');
  assert.equal(ownership.recycleCategory({ taskId: 'book-task' }, own), 'workbook_recycle');
  assert.equal(ownership.recycleCategory({ productId: 'active', runId: 'run' }, own), 'workspace');
  assert.equal(ownership.recycleCategory({ projectId: 'deleted', taskId: 'book-task' }, own), 'shared');
  s.projects.push({ id: 'deleted', nodes: [] });
  assert.equal(ownership.recycleCategory({ runId: 'run' }, ownership.recycleOwnership(s)), 'workspace', '恢复的活跃产品保护全部后代');
});

async function fixture(t, fn) {
  const root = mkdtempSync(join(tmpdir(), 'guan-recycle-'));
  const workspace = openWorkspace({ dataRoot: root, initialize: true });
  const controls = { failPurge: false, failWrite: false, failNamespace: '', afterIds: null, rootWrites: {} };
  const client = {
    readDocument: (...args) => workspace.readDocument(...args),
    writeDocument(input) { if (controls.failWrite || controls.failNamespace && input.value?.namespace === controls.failNamespace) throw Error('synthetic save failure'); if (input.value?.namespace) controls.rootWrites[input.value.namespace] = (controls.rootWrites[input.value.namespace] ?? 0) + 1; return workspace.writeDocument(input); },
    async writeMedia(blob) { return workspace.writeMedia(Buffer.from(await blob.arrayBuffer()), blob.type); },
    readMedia(id) { const item = workspace.readMedia(id); return new Blob([item.bytes], { type: item.mime }); },
    purgeMedia(ids) { if (controls.failPurge) throw Error('synthetic purge failure'); return workspace.purgeMedia(ids); },
  };
  const app = createRecoverableShardedApplicationStorage({ client, requestLimit: 0 });
  let canvas = state(), assets = { hydrated: true, assets: [{ id: 'saved', metadata: { projectId: 'deleted' }, data: { storageKey: 'image:saved' } }], replaceAssets(value) { assets = { ...assets, assets: value }; persist(); } };
  const writes = new Set();
  function enqueue(promise) { writes.add(promise); promise.catch(() => {}); promise.finally(() => writes.delete(promise)).catch(() => {}); }
  function persist() {
    const store = app.createInstance({ storeName: 'app_state' });
    enqueue(store.setItem('infinite-canvas:canvas_store', JSON.stringify({ state: canvas })));
    enqueue(store.setItem('infinite-canvas:asset_store', JSON.stringify({ state: { assets: assets.assets } })));
  }
  async function flush() { while (writes.size) await Promise.allSettled([...writes]); await app.flush(); }
  const api = load(source('扩展功能/存储界面/回收站存储操作.ts'), {
    '../本机存储/上游浏览器存储桥': { sqliteForage: app, flushSQLiteStorage: flush, retrySQLiteStorage: () => app.retryPending(),
      async recycleMediaIds(groups) { const ids = await app.mediaIdsForKeys(groups); controls.afterIds?.(); return ids; }, purgeRecycleMedia: ids => app.purgeMedia(ids) },
    '@/services/image-storage': { collectImageStorageKeys }, '@/services/file-storage': { collectMediaStorageKeys },
    '@/stores/canvas/use-canvas-store': { useCanvasStore: { getState: () => canvas, setState(value) { canvas = { ...canvas, ...value }; persist(); } } },
    '@/stores/use-asset-store': { useAssetStore: { getState: () => assets } }, '../本机存储/回收站归属.mjs': ownership,
  });
  const ids = {}, blobs = {};
  try {
    for (const key of ['image:delivery', 'image:original', 'image:shared', 'image:result', 'image:saved', 'image:log', 'video:deleted', 'audio:deleted', 'video:book']) {
      const type = key.startsWith('video:') ? 'video/mp4' : key.startsWith('audio:') ? 'audio/ogg' : 'image/png';
      const blob = new Blob([key], { type });
      blobs[key] = blob;
      ids[key] = (await client.writeMedia(blob)).id;
      await app.createInstance({ storeName: key.startsWith('image:') ? 'image_files' : 'media_files' }).setItem(key, blob);
    }
    await app.createInstance({ storeName: 'image_previews' }).setItem('image:delivery', { version: 1, blob: new Blob(['preview'], { type: 'image/webp' }) });
    await app.createInstance({ storeName: 'image_generation_logs' }).setItem('log', { id: 'log', runId: 'run', storageKey: 'image:log' });
    persist(); await flush();
    t.mock.timers.enable({ apis: ['Date'], now: Date.now() }); t.mock.timers.tick(16_000);
    await fn({ api, app, workspace, ids, blobs, root, controls, canvas: () => canvas, setCanvas(value) { canvas = value; persist(); }, flush });
  } finally {
    controls.failWrite = false; controls.failNamespace = ''; await app.retryPending().catch(() => {}); await flush().catch(() => {});
    app.close(); workspace.close(); t.mock.timers.reset(); rmSync(root, { recursive: true, force: true });
  }
}
const row = (usage, kind) => usage.databases[0].stores.find(item => item.name === kind);

test('同一批多素材索引删除只提交一个根版本；重复删除不增加写入', t => fixture(t, async f => {
  const store = f.app.createInstance({ storeName: 'image_files' });
  const before = f.controls.rootWrites.image_files;
  await store.removeItems(['image:delivery', 'image:original', 'image:saved']);
  assert.equal(f.controls.rootWrites.image_files - before, 1);
  assert.equal(await store.getItem('image:delivery'), null);
  assert.ok(await store.getItem('image:shared'));
  await store.removeItems(['image:delivery', 'image:original', 'image:saved']);
  assert.equal(f.controls.rootWrites.image_files - before, 1);
}));

test('v2容量包括原图/交付图/预览/音视频、合同产物与日志，共享只计一次且总量守恒', t => fixture(t, async f => {
  const usage = await f.workspace.readDetailedUsage();
  assert.equal(row(usage, 'product_recycle').records, 1); assert.equal(row(usage, 'workbook_recycle').records, 1);
  const keys = ['image:delivery', 'image:original', 'image:result', 'image:saved', 'image:log', 'video:deleted', 'audio:deleted'];
  assert.equal(row(usage, 'product_recycle').mediaBytes, keys.reduce((sum, key) => sum + Buffer.byteLength(key), 7));
  assert.equal(row(usage, 'workbook_recycle').mediaBytes, Buffer.byteLength('video:book'));
  assert.equal(row(usage, 'shared').mediaBytes, Buffer.byteLength('image:shared'));
  assert.ok(row(usage, 'product_recycle').documentBytes > 0);
  assert.equal(usage.databases[0].stores.reduce((sum, item) => sum + item.bytes, 0), usage.contentBytes);
}));

test('清空产品回收站实删专属文件和日志，保护活跃共享图、Excel回收站及工作簿', t => fixture(t, async f => {
  const result = await f.api.clearRecycleStorage('product_recycle'); assert.equal(result.pending, false);
  assert.equal(f.canvas().deletedProjects.length, 0); assert.equal(f.canvas().guanWorkbooks.contract.products.length, 0);
  assert.equal(f.canvas().guanWorkbooks.contract.productSets.length, 1); assert.equal(f.canvas().guanWorkbooks.recycledWorkbooks.length, 1);
  for (const [key, id] of Object.entries(f.ids)) assert.equal(existsSync(join(f.root, '媒体', id)), ['image:shared', 'video:book'].includes(key), key);
  assert.equal(await f.app.createInstance({ storeName: 'image_generation_logs' }).getItem('log'), null);
  assert.equal(row(await f.workspace.readDetailedUsage(), 'product_recycle').records, 0);
  assert.equal(await f.api.pendingRecycleCleanup(), null);
  await f.api.clearRecycleStorage('workbook_recycle');
  assert.equal(existsSync(join(f.root, '媒体', f.ids['video:book'])), false);
  assert.equal(existsSync(join(f.root, '媒体', f.ids['image:shared'])), true);
  await f.app.createInstance({ storeName: 'image_files' }).setItem('image:delivery', f.blobs['image:delivery']);
  assert.equal(existsSync(join(f.root, '媒体', f.ids['image:delivery'])), true, '重新导入同一Blob对象也会重传已删除内容');
}));

test('committed阶段逻辑索引保存失败，重试先恢复原队列再完成媒体清理', t => fixture(t, async f => {
  f.controls.failNamespace = 'image_files';
  await assert.rejects(f.api.clearRecycleStorage('product_recycle'));
  assert.equal(f.canvas().deletedProjects.length, 0);
  f.controls.failNamespace = '';
  await f.api.clearRecycleStorage('product_recycle');
  assert.equal(await f.api.pendingRecycleCleanup(), null);
  assert.equal(existsSync(join(f.root, '媒体', f.ids['image:delivery'])), false);
}));

test('两类回收站共用媒体时先清其中一类保留，最后一个所有者删除后才释放', t => fixture(t, async f => {
  const s = f.canvas();
  f.setCanvas({ ...s, guanWorkbooks: { ...s.guanWorkbooks, recycledWorkbooks: s.guanWorkbooks.recycledWorkbooks.map(book => ({ ...book, projects: [...book.projects, { id: 'second', nodes: [mediaNode('image:delivery')] }] })) } });
  await f.flush();
  await f.api.clearRecycleStorage('product_recycle');
  assert.equal(existsSync(join(f.root, '媒体', f.ids['image:delivery'])), true);
  await f.api.clearRecycleStorage('workbook_recycle');
  assert.equal(existsSync(join(f.root, '媒体', f.ids['image:delivery'])), false);
}));

test('物理清理失败有持久重试清单；重试保留后来恢复产品引用的图', t => fixture(t, async f => {
  f.controls.failPurge = true;
  await assert.rejects(f.api.clearRecycleStorage('product_recycle'), /synthetic purge failure/);
  assert.equal(await f.api.pendingRecycleCleanup(), 'product_recycle');
  const s = f.canvas(); f.setCanvas({ ...s, projects: [...s.projects, { id: 'restored', nodes: [mediaNode('image:result')] }] });
  await f.app.createInstance({ storeName: 'image_files' }).setItem('image:result', new Blob(['image:result'], { type: 'image/png' }));
  f.controls.failPurge = false; await f.api.clearRecycleStorage('product_recycle');
  assert.equal(existsSync(join(f.root, '媒体', f.ids['image:result'])), true);
  assert.equal(await f.api.pendingRecycleCleanup(), null);
}));

test('保存失败重试原队列后继续，扫描期间恢复/编辑不会被覆盖', t => fixture(t, async f => {
  f.controls.afterIds = () => { f.controls.afterIds = null; f.setCanvas({ ...f.canvas(), projects: [...f.canvas().projects, { id: 'new', nodes: [] }] }); };
  await assert.rejects(f.api.clearRecycleStorage('product_recycle'), /发生变化/);
  assert.equal(f.canvas().deletedProjects.length, 1); assert.equal(f.canvas().projects.at(-1).id, 'new');
  f.controls.afterIds = () => { f.controls.afterIds = null; f.controls.failWrite = true; };
  await assert.rejects(f.api.clearRecycleStorage('product_recycle'));
  f.controls.failWrite = false;
  await assert.rejects(f.api.clearRecycleStorage('product_recycle'), /上次删除未提交/);
  assert.equal(f.canvas().deletedProjects.length, 1);
  await f.api.clearRecycleStorage('product_recycle');
  assert.equal(f.canvas().deletedProjects.length, 0); assert.equal(await f.api.pendingRecycleCleanup(), null);
}));

test('后端近期上传延后、SQL引用保护、幂等重试及链接拒绝', t => fixture(t, async f => {
  const recent = f.workspace.writeMedia(Buffer.from('recent'), 'image/png');
  assert.deepEqual(f.workspace.purgeMedia([recent.id]).deferred, [recent.id]);
  t.mock.timers.tick(16_000);
  f.workspace.writeDocument({ collection: 'extension', id: 'protected', value: {}, mediaIds: [recent.id], expectedRevision: 0, operationId: randomUUID() });
  assert.deepEqual(f.workspace.purgeMedia([recent.id]).retained, [recent.id]);
  const free = f.workspace.writeMedia(Buffer.from('free'), 'image/png'); t.mock.timers.tick(16_000);
  assert.deepEqual(f.workspace.purgeMedia([free.id, free.id]).deleted, [free.id]);
  assert.deepEqual(f.workspace.purgeMedia([free.id]).deleted, [free.id]);
  const linked = f.workspace.writeMedia(Buffer.from('linked'), 'image/png'); t.mock.timers.tick(16_000);
  const target = join(f.root, 'outside'); writeFileSync(target, 'keep', { mode: 0o600 });
  rmSync(join(f.root, '媒体', linked.id)); symlinkSync(target, join(f.root, '媒体', linked.id));
  assert.throws(() => f.workspace.purgeMedia([linked.id])); assert.equal(readFileSync(target, 'utf8'), 'keep');
  rmSync(join(f.root, '媒体', linked.id));
}));

test('真实HTTP删除保留Origin/Bearer/CSRF门禁，客户端验证完整回执', t => fixture(t, async f => {
  const origin = 'http://localhost:49121', service = await startDataService({ workspace: f.workspace, allowedOrigins: [origin], rateLimit: 0 });
  const session = service.issueSession(origin), path = service.url + '/v1/workspaces/' + f.workspace.workspaceId + '/media-cleanup';
  const headers = { Origin: origin, Authorization: 'Bearer ' + session.token, 'Content-Type': 'application/json' };
  try {
    assert.equal((await fetch(path, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{"ids":[]}' })).status, 401);
    assert.equal((await fetch(path, { method: 'POST', headers, body: '{"ids":[]}' })).status, 403);
    assert.equal((await fetch(path, { method: 'POST', headers: { ...headers, 'X-Guan-CSRF': session.csrf }, body: '{"ids":["invalid"]}' })).status, 400);
    const client = createDataClient({ url: service.url, session, fetchImpl: (url, options) => fetch(url, { ...options, headers: { ...options.headers, Origin: origin } }) });
    assert.deepEqual(await client.purgeMedia([f.ids['image:shared']]), { deleted: [], retained: [f.ids['image:shared']], deferred: [] });
    client.close(); service.revokeSession(session.token);
    assert.equal((await fetch(path, { method: 'POST', headers: { ...headers, 'X-Guan-CSRF': session.csrf }, body: '{"ids":[]}' })).status, 401);
  } finally { await service.close(); }
}));
