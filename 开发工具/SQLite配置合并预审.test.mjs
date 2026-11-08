import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { 根目录 } from './公共.mjs';
import { 哈希 } from './检查运行副本.mjs';
import { ts } from './检查首批功能适配.mjs';
import { 配置合并存储表达式, 构建配置合并候选 } from './预审SQLite配置合并保存.mjs';
import { 读取保存恢复批准 } from '../上游适配/SQLite保存恢复批准.mjs';
import { openWorkspace } from '../扩展功能/本机存储/SQLite工作区.mjs';
import { openSQLiteCredentialVault } from '../扩展功能/本机凭据/SQLite凭据保管.mjs';
import { createRecoverableShardedApplicationStorage } from '../扩展功能/本机存储/可恢复分片应用存储.mjs';

const key = 'infinite-canvas:ai_config_store', secret = 'synthetic-' + 'coalesced-only';
async function fixture() {
  const source = readFileSync(join(根目录, '扩展功能/本机存储/保存恢复存储桥.ts'), 'utf8');
  assert.equal(哈希(source), 读取保存恢复批准().文件.find(item => item.文件 === 'web/src/guan/上游浏览器存储桥.ts').候选SHA256);
  const bridge = await import('data:text/javascript;base64,' + Buffer.from(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText + '\n//' + crypto.randomUUID()).toString('base64'));
  const root = mkdtempSync(join(tmpdir(), 'guan-config-coalesce-')), workspace = openWorkspace({ dataRoot: join(root, '数据'), initialize: true }), master = randomBytes(32);
  const vault = await openSQLiteCredentialVault({ workspace, keyProvider: { read: async () => Buffer.from(master), create: async () => Buffer.from(master) }, initialize: true });
  let offline = false, credentialCalls = 0;
  const client = { readDocument: async (...args) => workspace.readDocument(...args), writeDocument: async input => workspace.writeDocument(input) };
  const app = createRecoverableShardedApplicationStorage({ client, secretPort: { store(value) { credentialCalls++; if (offline) throw Error('合成凭据离线'); return vault.store(value); }, read: ref => vault.read(ref) } });
  const previousWindow = globalThis.window, page = new EventTarget(); page.__guanSQLiteHost = { initialize: async () => app }; globalThis.window = page;
  await bridge.initializeSQLiteApplication();
  // 只执行精确候选里的存储表达式，不加载/伪造React应用；此项不是UI验收。
  const adapter = new Function('sqliteStateStorage', 'scheduleStateSave', 'flushSQLiteStorage', 'return ' + 配置合并存储表达式)(bridge.sqliteStateStorage, bridge.scheduleStateSave, bridge.flushSQLiteStorage);
  return { root, workspace, app, bridge, adapter, calls: () => credentialCalls, offline(value) { offline = value; }, async close() { globalThis.window = previousWindow; app.close(); vault.close(); workspace.close(); master.fill(0); } };
}
const value = index => JSON.stringify({ state: { config: { name: '最终配置' + index, apiKey: secret, channels: [{ apiKey: secret }] } }, version: 0 });
test('1文件候选仅切换配置存储端口；不改权限/限流/上游保存逻辑', () => {
  const delta = 构建配置合并候选(); assert.equal(delta.size, 1);
  const item = [...delta.values()][0]; assert.match(item.产物, /setItem: scheduleStateSave/);
  assert.equal(item.产物.includes('rateLimit'), item.原文.includes('rateLimit'));
  const business = source => source.slice(source.indexOf('export const useConfigStore'), source.indexOf('storage: createJSONStorage'));
  assert.equal(business(item.产物), business(item.原文));
});
test('40次同步配置更新只提交最后完整快照，两处凭据正常加密，flush不等400ms', async () => {
  const f = await fixture();
  try {
    const jobs = Array.from({ length: 40 }, (_, i) => f.adapter.setItem(key, value(i)));
    assert.equal(f.bridge.storageStatus().state, 'saving'); assert.equal(f.calls(), 0);
    await f.bridge.flushSQLiteStorage(); await Promise.all(jobs);
    assert.equal(f.calls(), 2); assert.equal(f.adapter.getItem(key), value(39)); assert.equal(f.bridge.storageStatus().state, 'saved');
    const root = f.workspace.listDocuments('extension').filter(row => row.id.startsWith('app-') && !row.id.startsWith('app-part-'));
    assert.equal(root.length, 1); assert.equal(root[0].revision, 1);
    assert.equal(f.workspace.listDocuments('extension').filter(row => row.id.startsWith('secret:')).length, 1);
    for (const row of f.workspace.listDocuments('extension')) assert.equal(JSON.stringify(f.workspace.readDocument('extension', row.id)).includes(secret), false);
  } finally { await f.close(); }
});
test('合并后的凭据失败仍可见；只在原队列重试确认后报告保存', async () => {
  const f = await fixture();
  try {
    f.offline(true); const pending = f.adapter.setItem(key, value(1));
    await assert.rejects(f.bridge.flushSQLiteStorage()); await assert.rejects(pending);
    assert.equal(f.bridge.storageStatus().state, 'error');
    f.offline(false); await f.bridge.retrySQLiteStorage(); await f.bridge.flushSQLiteStorage();
    assert.equal(f.bridge.storageStatus().state, 'saved'); assert.equal(f.adapter.getItem(key), value(1));
  } finally { await f.close(); }
});
test('配置删除先排空延迟保存，400ms后不会复活已删配置', async () => {
  const f = await fixture();
  try {
    const pending = f.adapter.setItem(key, value(2)); await f.adapter.removeItem(key); await pending;
    await new Promise(done => setTimeout(done, 450)); assert.equal(f.adapter.getItem(key), null); await f.bridge.flushSQLiteStorage();
    assert.equal(f.bridge.storageStatus().state, 'saved');
  } finally { await f.close(); }
});
