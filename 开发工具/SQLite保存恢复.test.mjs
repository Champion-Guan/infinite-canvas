import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { 根目录, 基线 } from './公共.mjs';
import { openWorkspace } from '../扩展功能/本机存储/SQLite工作区.mjs';
import { createRecoverableApplicationStorage } from '../扩展功能/本机存储/可恢复应用存储.mjs';
import { StorageError } from '../扩展功能/本机存储/协议.mjs';

const code = expected => error => error.code === expected, roots = [];
function fixture(fault = async action => action(), options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'guan-save-recovery-')); roots.push(root);
  const workspace = openWorkspace({ dataRoot: join(root, '数据'), initialize: true }), requests = [];
  const client = { readDocument: async (collection, id) => workspace.readDocument(collection, id),
    writeDocument: async input => { requests.push(structuredClone(input)); return fault(() => workspace.writeDocument(input), input); },
    writeMedia: async blob => workspace.writeMedia(Buffer.from(await blob.arrayBuffer()), blob.type),
    readMedia: async id => { const media = workspace.readMedia(id); return new Blob([media.bytes], { type: media.mime }); },
    readUsage: async () => workspace.readUsage() };
  const app = createRecoverableApplicationStorage({ client, ...options });
  return { root, app, client, workspace, requests, store: app.createInstance({ storeName: 'app_state' }), close: () => workspace.close() };
}
function document(f) { return f.workspace.readDocument('extension', f.workspace.listDocuments('extension')[0].id); }
test('正常并行保存有真实ACK且快照不随调用方变化；立即读取和排空可用', async () => {
  const f = fixture();
  try {
    const value = { title: '最初内容' }, first = f.store.setItem('x', value); value.title = '调用后改动';
    await Promise.all([first, f.store.setItem('y', '二')]);
    assert.equal((await f.store.getItem('x')).title, '最初内容'); assert.equal(await f.store.length(), 2);
    assert.equal((await f.app.flush()).state, 'saved'); f.app.close();
  } finally { f.close(); }
});
test('ACK丢失后保留后续编辑，同一原操作先核实，之后按顺序提交，不重复落盘', async () => {
  let lose = true;
  const f = fixture(async action => { const ack = await action(); if (lose) { lose = false; throw Error('合成ACK丢失'); } return ack; });
  try {
    await assert.rejects(f.store.setItem('x', '第一稿'));
    await assert.rejects(f.store.setItem('x', '第二稿'), code('pending_write_unresolved'));
    await assert.rejects(f.store.setItem('y', '新增内容'), code('pending_write_unresolved'));
    assert.equal(f.app.getStatus().pending, 3); assert.equal(document(f).revision, 1);
    await assert.rejects(f.app.flush(), code('save_not_confirmed')); assert.throws(() => f.app.close(), code('save_not_confirmed'));
    await f.app.retryPending(); await f.app.flush();
    assert.deepEqual(f.requests[0], f.requests[1], '首次重试必须复用完整原请求');
    assert.equal(document(f).revision, 3); assert.equal(await f.store.getItem('x'), '第二稿'); assert.equal(await f.store.getItem('y'), '新增内容');
    assert.equal(f.app.getStatus().state, 'saved');
  } finally { f.close(); }
});
test('断线发生在提交前，多次重试不生成新operationId；恢复后仅提交一次', async () => {
  let offline = true;
  const f = fixture(async action => { if (offline) throw Error('合成断线'); return action(); });
  try {
    await assert.rejects(f.store.setItem('x', '离线编辑'));
    await assert.rejects(f.app.retryPending(), code('save_not_confirmed'));
    assert.equal(f.workspace.listDocuments('extension').length, 0); assert.equal(f.app.getStatus().state, 'error');
    offline = false; await f.app.retryPending();
    assert.equal(f.requests.length, 3); assert.ok(f.requests.every(value => value.operationId === f.requests[0].operationId));
    assert.equal(document(f).revision, 1); assert.equal(await f.store.getItem('x'), '离线编辑');
  } finally { f.close(); }
});
test('失败期间的修改、删除和clear保留顺序，不丢字段或恢复已删除内容', async () => {
  let fail = true;
  const f = fixture(async action => { if (fail) throw Error('合成断线'); return action(); });
  try {
    await assert.rejects(f.store.setItem('old', '旧记录'));
    await assert.rejects(f.store.removeItem('old')); await assert.rejects(f.store.setItem('mid', '中间记录'));
    await assert.rejects(f.store.clear()); await assert.rejects(f.store.setItem('last', { futureField: 42 }));
    fail = false; await f.app.retryPending();
    assert.deepEqual(await f.store.keys(), ['last']); assert.equal((await f.store.getItem('last')).futureField, 42); assert.equal(document(f).revision, 5);
  } finally { f.close(); }
});
test('重试期间新增编辑也要ACK，重复点击合并同一恢复流程', async () => {
  let offline = true, release, entered;
  const gate = new Promise(done => { entered = done; }), wait = new Promise(done => { release = done; });
  const f = fixture(async action => { if (offline) throw Error('合成断线'); entered(); await wait; return action(); });
  try {
    await assert.rejects(f.store.setItem('x', '先前稿')); offline = false;
    const first = f.app.retryPending(), second = f.app.retryPending(); assert.equal(first, second); await gate;
    await assert.rejects(f.store.setItem('x', '重试时新稿')); release(); await first; await f.app.flush();
    assert.equal(await f.store.getItem('x'), '重试时新稿'); assert.equal(document(f).revision, 2);
  } finally { release(); f.close(); }
});
test('不同命名空间独立；一处失败不把全局状态误报已保存', async () => {
  let fail = true;
  const f = fixture(async (action, input) => { if (fail && input.value.namespace === 'app_state') throw Error('合成断线'); return action(); });
  try {
    await assert.rejects(f.store.setItem('x', '待恢复'));
    const prefs = f.app.createInstance({ storeName: 'preferences' }); await prefs.setItem('width', '480');
    assert.equal(f.app.getStatus().state, 'error'); assert.deepEqual(f.app.getStatus().errors, ['app_state']);
    fail = false; await f.app.retryPending(); assert.equal(await f.store.getItem('x'), '待恢复'); assert.equal(await prefs.getItem('width'), '480');
  } finally { f.close(); }
});
test('版本冲突继续阻止覆盖；重试不采纳远端版本生成强制覆盖请求', async () => {
  const f = fixture(), other = createRecoverableApplicationStorage({ client: f.client });
  try {
    const b = other.createInstance({ storeName: 'app_state' }); await f.store.getItem('x'); await b.getItem('x');
    await f.store.setItem('x', '其他窗口已保存'); await assert.rejects(b.setItem('x', '本页未确认'), code('revision_conflict'));
    await assert.rejects(other.retryPending(), code('save_not_confirmed'));
    assert.equal(other.getStatus().failures[0].code, 'revision_conflict');
    assert.equal(await f.store.getItem('x'), '其他窗口已保存'); assert.equal(document(f).revision, 1);
    assert.deepEqual(f.requests.at(-1), f.requests.at(-2));
  } finally { f.close(); }
});
test('预发送凭据/容量/快照错误不会被重试按钮清除，不能报告已保存', async () => {
  const f = fixture();
  try {
    const actions = [() => f.store.setItem('bad', () => {}), () => f.store.setItem('token', '合成非真实密钥')];
    for (const action of actions) await assert.rejects(action());
    await assert.rejects(f.app.retryPending(), code('save_not_confirmed')); assert.equal(f.app.getStatus().state, 'error');
    assert.equal(f.workspace.listDocuments('extension').length, 0); assert.equal(f.requests.length, 0);
    const g = fixture();
    try { await assert.rejects(g.store.setItem('too-large', 'x'.repeat(3 * 1024 * 1024)), code('document_too_large')); await assert.rejects(g.app.retryPending()); assert.equal(g.app.getStatus().state, 'error'); }
    finally { g.close(); }
  } finally { f.close(); }
});
test('状态观察器故障不改变ACK；状态里不包含值、路径、操作ID或原始异常', async () => {
  const f = fixture(async () => { throw new StorageError('synthetic', '合成敏感异常/路径/secret'); }, { onStatus() { throw Error('UI故障'); } });
  try {
    const off = f.app.subscribe(() => { throw Error('UI故障'); });
    await assert.rejects(f.store.setItem('private-title', '合成客户内容'));
    assert.doesNotMatch(JSON.stringify(f.app.getStatus()), /private-title|合成客户内容|敏感异常|secret|operationId/); off();
  } finally { f.close(); }
});
test('含图片的失败保存重试保留媒体引用，随后新编辑和重开均可读取原Blob', async () => {
  let lose = true;
  const f = fixture(async action => { const ack = await action(); if (lose) { lose = false; throw Error('合成ACK丢失'); } return ack; });
  try {
    const images = f.app.createInstance({ storeName: 'image_files' });
    await assert.rejects(images.setItem('image:one', new Blob(['synthetic-picture'], { type: 'image/png' })));
    await assert.rejects(images.setItem('image:two', new Blob(['another-picture'], { type: 'image/png' })));
    await f.app.retryPending(); await f.app.flush();
    const reopened = createRecoverableApplicationStorage({ client: f.client }), restored = reopened.createInstance({ storeName: 'image_files' });
    assert.equal(await (await restored.getItem('image:one')).text(), 'synthetic-picture');
    assert.equal(await (await restored.getItem('image:two')).text(), 'another-picture');
    assert.equal(document(f).revision, 2); assert.equal(document(f).mediaIds.length, 2); reopened.close();
  } finally { f.close(); }
});

const ts = createRequire(join(根目录, '.运行', 基线.提交, 'web/package.json'))('typescript');
const source = readFileSync(new URL('../扩展功能/本机存储/保存恢复存储桥.ts', import.meta.url), 'utf8');
let version = 0;
async function bridge(app) {
  const events = new EventTarget(); globalThis.window = { __guanSQLiteHost: { initialize: async () => app }, addEventListener: events.addEventListener.bind(events), dispatchEvent: events.dispatchEvent.bind(events) };
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = await import('data:text/javascript;base64,' + Buffer.from(js + `\n// ${version++}`).toString('base64'));
  await module.initializeSQLiteApplication(); return module;
}
test('真实存储桥失败Map与底层pending一起恢复；本页新编辑先保留，flush及关闭提醒准确', async () => {
  let offline = true;
  const f = fixture(async action => { if (offline) throw Error('合成断线'); return action(); });
  try {
    const b = await bridge(f.app), key = 'infinite-canvas:canvas_store', value = title => JSON.stringify({ state: { projects: [{ id: 'p', title }] }, version: 0 });
    await assert.rejects(b.sqliteStateStorage.setItem(key, value('第一稿')));
    await assert.rejects(b.sqliteStateStorage.setItem(key, value('后续编辑'))); await Promise.resolve();
    assert.match(b.sqliteStateStorage.getItem(key), /后续编辑/); assert.equal(b.storageStatus().state, 'error');
    let event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); assert.equal(event.defaultPrevented, true);
    await assert.rejects(b.flushSQLiteStorage()); offline = false; await b.retrySQLiteStorage(); await b.flushSQLiteStorage();
    assert.equal(b.storageStatus().state, 'saved'); assert.equal(document(f).revision, 2);
    assert.match(await f.store.getItem(key), /后续编辑/);
    event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); assert.equal(event.defaultPrevented, false);
  } finally { delete globalThis.window; f.close(); }
});
test('恢复期间新增400ms合并保存，最新快照收到ACK后才清除桥失败状态', async () => {
  let fail = true, release, entered;
  const gate = new Promise(done => { entered = done; }), wait = new Promise(done => { release = done; });
  const f = fixture(async action => { if (fail) throw Error('合成断线'); entered(); await wait; return action(); });
  try {
    const b = await bridge(f.app), key = 'infinite-canvas:canvas_store', value = x => JSON.stringify({ state: { x }, version: 0 });
    await assert.rejects(b.sqliteStateStorage.setItem(key, value(1))); fail = false;
    const retry = b.retrySQLiteStorage(); await gate; const pending = b.scheduleStateSave(key, value(2));
    assert.equal(b.storageStatus().state, 'error'); release(); await retry; await pending;
    assert.equal(b.storageStatus().state, 'saved'); assert.equal(JSON.parse(await f.store.getItem(key)).state.x, 2);
  } finally { release(); delete globalThis.window; f.close(); }
});
test.after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });
