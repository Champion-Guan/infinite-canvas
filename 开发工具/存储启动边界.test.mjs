import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { 根目录, 基线 } from './公共.mjs';
import { openWorkspace } from '../扩展功能/本机存储/SQLite工作区.mjs';
import { createRecoverableShardedApplicationStorage as createApplicationStorage } from '../扩展功能/本机存储/可恢复分片应用存储.mjs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const ts = createRequire(join(根目录, '.运行', 基线.提交, 'web/package.json'))('typescript');
const source = readFileSync(new URL('../扩展功能/本机存储/上游浏览器存储桥.ts', import.meta.url), 'utf8');
const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
let version = 0;
async function bridge() {
  return import('data:text/javascript;base64,' + Buffer.from(javascript + `\n// test-${version++}`).toString('base64'));
}
function windowFixture() {
  const target = new EventTarget();
  globalThis.window = { addEventListener: target.addEventListener.bind(target), dispatchEvent: target.dispatchEvent.bind(target) };
}
function databaseFixture() {
  const root = mkdtempSync(join(tmpdir(), 'guan-stage6-bootstrap-'));
  const workspace = openWorkspace({ dataRoot: root, initialize: true });
  const client = {
    async readDocument(collection, id) { return workspace.readDocument(collection, id); },
    async writeDocument(input) { return workspace.writeDocument(input); },
    async readUsage() { return workspace.readUsage(); },
  };
  const app = createApplicationStorage({ client });
  console.log(JSON.stringify({ syntheticBootstrapRoot: root }));
  return { workspace, client, app };
}

test('无本机授权时失败关闭，不能读取默认值或偷偷写浏览器存储', async () => {
  windowFixture(); const b = await bridge();
  await assert.rejects(b.initializeSQLiteApplication(), /尚未授权接入/);
  assert.throws(() => b.sqlitePreferences.getItem('locale'), /尚未初始化/);
  assert.throws(() => b.sqliteStateStorage.setItem('x', '{}'), /尚未初始化/);
});

test('先预读偏好与Zustand快照再启动；内存身份不串到数据库', async () => {
  const f = databaseFixture(); windowFixture();
  try {
    await f.app.createInstance({ storeName: 'preferences' }).setItem('infinite-canvas:locale', 'en-US');
    await f.app.createInstance({ storeName: 'app_state' }).setItem('infinite-canvas:theme_store', JSON.stringify({ state: { mode: 'dark' }, version: 0 }));
    window.__guanSQLiteHost = { initialize: async () => f.app };
    const b = await bridge(); await b.initializeSQLiteApplication();
    assert.equal(b.sqlitePreferences.getItem('infinite-canvas:locale'), 'en-US');
    assert.equal(JSON.parse(b.sqliteStateStorage.getItem('infinite-canvas:theme_store')).state.mode, 'dark');
    b.sqlitePreferences.setItem('width', '420'); await b.flushSQLiteStorage();
    const reloaded = createApplicationStorage({ client: f.client });
    assert.equal(await reloaded.createInstance({ storeName: 'preferences' }).getItem('width'), '420');
    b.sessionMemory.setItem('canvas-agent-client-id', 'window-only');
    assert.equal(JSON.stringify(f.workspace.listDocuments('extension').map(row => f.workspace.readDocument('extension', row.id))).includes('window-only'), false);
    const usage = await b.readSQLiteUsage(); assert.equal(usage.quota, null); assert.ok(usage.usage > 0);
  } finally { f.workspace.close(); }
});

test('预读异常不发布半份设置，不允许默认值覆盖；可重新授权后再初始化', async () => {
  windowFixture(); const b = await bridge();
  let writes = 0;
  window.__guanSQLiteHost = { initialize: async () => ({ retryPending: async () => {}, subscribe() {}, createInstance({ storeName }) { return { async iterate(callback) { if (storeName === 'app_state') callback('{"state":{"kept":true}}', 'x'); else throw Error('synthetic unavailable'); }, async setItem() { writes++; } }; } }) };
  await assert.rejects(b.initializeSQLiteApplication(), /synthetic unavailable/);
  assert.throws(() => b.sqliteStateStorage.getItem('x'), /尚未初始化/); assert.equal(writes, 0);
  const f = databaseFixture();
  try { window.__guanSQLiteHost = { initialize: async () => f.app }; await b.initializeSQLiteApplication(); assert.equal(b.sqliteStateStorage.getItem('x'), null); }
  finally { f.workspace.close(); }
});

test('80ms且最长250ms合并保存可以显式排空；beforeunload仅提醒未保存状态', async () => {
  const f = databaseFixture(); windowFixture();
  try {
    const b = await bridge(); window.__guanSQLiteHost = { initialize: async () => f.app }; await b.initializeSQLiteApplication();
    const key = 'infinite-canvas:canvas_store';
    const one = b.scheduleStateSave(key, JSON.stringify({ state: { projects: [{ id: 'p1' }] }, version: 0 }));
    const two = b.scheduleStateSave(key, JSON.stringify({ state: { projects: [{ id: 'p2' }] }, version: 0 }));
    assert.equal(one, two); assert.equal(b.storageStatus().state, 'saving');
    const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); assert.equal(event.defaultPrevented, true);
    await b.flushSQLiteStorage(); await one;
    assert.equal(b.storageStatus().state, 'saved');
    const doc = f.workspace.readDocument('extension', f.workspace.listDocuments('extension')[0].id); assert.equal(doc.revision, 1);
    assert.match(await f.app.createInstance({ storeName: 'app_state' }).getItem(key), /p2/);
    const savedEvent = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(savedEvent); assert.equal(savedEvent.defaultPrevented, false);
  } finally { f.workspace.close(); }
});

test('异步保存失败不显示已保存，退出提醒和flush持续失败', async () => {
  windowFixture(); const b = await bridge();
  window.__guanSQLiteHost = { initialize: async () => ({ retryPending: async () => {}, subscribe() {}, createInstance() { return { async iterate() {}, async setItem() { throw Error('synthetic disk full'); } }; }, async flush() {}, getStatus() { return { state: 'idle' }; } }) };
  await b.initializeSQLiteApplication(); b.sqlitePreferences.setItem('width', '460');
  await assert.rejects(b.flushSQLiteStorage()); await Promise.resolve();
  assert.equal(b.storageStatus().state, 'error'); await assert.rejects(b.flushSQLiteStorage(), /保存尚未确认/);
  const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); assert.equal(event.defaultPrevented, true);
});

test.after(() => { delete globalThis.window; });
