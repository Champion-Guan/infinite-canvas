import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { 根目录, 基线 } from './公共.mjs';
import { openWorkspace } from '../扩展功能/本机存储/SQLite工作区.mjs';
import { createRecoverableApplicationStorage as createApplicationStorage } from '../扩展功能/本机存储/可恢复应用存储.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as upgradeState from '../扩展功能/软件更新/升级页面状态.mjs';

const ts = createRequire(join(根目录, '.运行', 基线.提交, 'web/package.json'))('typescript');
const source = readFileSync(new URL('../扩展功能/本机存储/上游浏览器存储桥.ts', import.meta.url), 'utf8');
const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
async function bridge() {
  const module = { exports: {} };
  new Function('module', 'exports', 'require', javascript)(module, module.exports, id => {
    assert.equal(id, '../软件更新/升级页面状态.mjs'); return upgradeState;
  });
  return module.exports;
}
function windowFixture() {
  const target = new EventTarget();
  globalThis.window = { addEventListener: target.addEventListener.bind(target), dispatchEvent: target.dispatchEvent.bind(target) };
}
const syntheticRoots = [];
function databaseFixture(fault = async action => action()) {
  const root = mkdtempSync(join(tmpdir(), 'guan-stage6-bootstrap-')); syntheticRoots.push(root);
  const workspace = openWorkspace({ dataRoot: root, initialize: true });
  const client = {
    async readDocument(collection, id) { return workspace.readDocument(collection, id); },
    async writeDocument(input) { return fault(() => workspace.writeDocument(input), input); },
    async readUsage() { return workspace.readUsage(); },
  };
  const app = createApplicationStorage({ client, requestLimit: 0 });
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
    let encodings = 0;
    const one = b.scheduleStateSave(key, () => { encodings++; return JSON.stringify({ state: { projects: [{ id: 'p1' }] }, version: 0 }); });
    const two = b.scheduleStateSave(key, () => { encodings++; return JSON.stringify({ state: { projects: [{ id: 'p2' }] }, version: 0 }); });
    assert.equal(one, two); assert.equal(b.storageStatus().state, 'saving');
    assert.equal(encodings, 0);
    const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); assert.equal(event.defaultPrevented, true);
    await b.flushSQLiteStorage(); await one;
    assert.equal(b.storageStatus().state, 'saved'); assert.equal(encodings, 1);
    const doc = f.workspace.readDocument('extension', f.workspace.listDocuments('extension')[0].id); assert.equal(doc.revision, 1);
    assert.match(await f.app.createInstance({ storeName: 'app_state' }).getItem(key), /p2/);
    const reopened = createApplicationStorage({ client: f.client });
    try {
      assert.match(await reopened.createInstance({ storeName: 'app_state' }).getItem(key), /p2/);
    } finally { reopened.close(); }
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

test('延迟编码的画布丢失SQLite回执后只恢复原操作，不重复编码或落盘', async () => {
  const requests = []; let loseAck = true, encodings = 0;
  const f = databaseFixture(async (action, input) => {
    requests.push(structuredClone(input));
    const ack = await action();
    if (loseAck) { loseAck = false; throw Error('合成回执丢失'); }
    return ack;
  });
  windowFixture();
  try {
    window.__guanSQLiteHost = { initialize: async () => f.app };
    const b = await bridge(); await b.initializeSQLiteApplication();
    const key = 'infinite-canvas:canvas_store', value = '{"state":{"projects":[{"id":"original"}]},"version":0}';
    const save = b.scheduleStateSave(key, () => { encodings++; return value; });
    const flushing = b.flushSQLiteStorage();
    await Promise.all([assert.rejects(save), assert.rejects(flushing)]);
    assert.equal(b.storageStatus().state, 'error');
    await b.retrySQLiteStorage(); await b.flushSQLiteStorage();
    assert.equal(encodings, 1); assert.equal(requests.length, 2);
    assert.deepEqual(requests[0], requests[1], '恢复须复用原operationId、值和版本');
    assert.equal(f.workspace.readDocument(requests[0].collection, requests[0].id).revision, 1);
    const reopened = createApplicationStorage({ client: f.client });
    try { assert.equal(await reopened.createInstance({ storeName: 'app_state' }).getItem(key), value); }
    finally { reopened.close(); }
    assert.equal(b.storageStatus().state, 'saved');
  } finally { f.workspace.close(); }
});

test.after(() => { delete globalThis.window; for (const root of syntheticRoots) rmSync(root, { recursive: true, force: true }); });
