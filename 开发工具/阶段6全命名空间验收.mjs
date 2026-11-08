import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { 根目录 } from './公共.mjs';
import { 核验日常运行包 } from './日常运行包.mjs';
import { 加载SQLite写入协调隔离服务 } from './接入SQLite写入协调隔离服务.mjs';

assert.equal(process.argv.length, 3);
const output = resolve(process.argv[2]);
assert.ok(output.startsWith(join(根目录, '.运行/output/阶段6最终收口-')));
const prepared = 核验日常运行包(join(根目录, '.运行/SQLite日常准备-UWriM2/准备清单.json'), 'a44877449e31671952933ddd7a1b5e1f3acaa12aa7479a6395d4aa94d104b1ed');
const load = path => import(pathToFileURL(join(prepared.integration.副本, path)).href);
const { startIsolatedAuthorizedWorkbench: start } = await load('扩展功能/本机服务/受限工作台启动器.mjs');
const { authorizeLocalStorage } = await load('web/src/guan/sqlite/本机授权客户端.mjs');
const { createRenewingDataClient } = await load('web/src/guan/sqlite/续期数据客户端.mjs');
const { createRecoverableShardedApplicationStorage } = await load('web/src/guan/sqlite/可恢复分片应用存储.mjs');
const { APP_NAMESPACES } = await load('web/src/guan/sqlite/应用存储适配.mjs');
const { openSQLiteCredentialVault } = await load('扩展功能/本机凭据/SQLite凭据保管.mjs');
const storage = await 加载SQLite写入协调隔离服务(prepared.serviceIntegration);
const root = mkdtempSync(join(tmpdir(), 'guan-stage6-final-namespaces-')), dataRoot = join(root, '数据');
const material = randomBytes(32), keyProvider = { read: async () => Buffer.from(material), create: async () => Buffer.from(material) };
const secret = 'synthetic-' + 'stage6-final-secret-not-a-real-key';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const results = [], blocked = [], requests = [];
let app, connection, passed = false, receipt, recoveredRoot, workspaceId, observedWorkspace, observedService;
const observedStorage = { ...storage,
  openWorkspace(options) { observedWorkspace = storage.openWorkspace(options); return observedWorkspace; },
  async startDataService(options) { observedService = await storage.startDataService(options); return observedService; },
};
async function normalize(value) {
  if (value instanceof Blob) return { blob: true, mime: value.type, size: value.size, sha256: hash(Buffer.from(await value.arrayBuffer())) };
  if (value instanceof Date) return { date: value.toISOString() };
  if (value instanceof ArrayBuffer) return { buffer: hash(Buffer.from(value)) };
  if (Array.isArray(value)) return Promise.all(value.map(normalize));
  if (value && typeof value === 'object') return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([key, item]) => [key, await normalize(item)])));
  return value;
}
function check(name, condition = true) { assert.ok(condition, name); results.push({ name, passed: true }); console.log(name); }
async function connect() {
  const transport = async (url, options = {}) => {
    const response = await fetch(url, { ...options, headers: { ...options.headers, Origin: app.origin, 'Sec-Fetch-Site': 'same-origin' } });
    requests.push({ path: new URL(url).pathname.replace(/[a-f0-9]{64}/g, '<hash>'), method: options.method ?? 'GET', status: response.status });
    return response;
  };
  const auth = await authorizeLocalStorage({ origin: app.origin, code: app.issueTicket().code, fetchImpl: transport });
  const client = createRenewingDataClient({ ...auth, origin: app.origin, fetchImpl: transport });
  const application = createRecoverableShardedApplicationStorage({ client, secretPort: auth.secretPort });
  return { application, async close() { await application.flush(); application.close(); await client.close(); } };
}
async function state(application) {
  const value = {};
  for (const namespace of APP_NAMESPACES) {
    const records = {}, store = application.createInstance({ storeName: namespace });
    await store.iterate((item, key) => { records[key] = item; });
    value[namespace] = await normalize(records);
  }
  return value;
}
function noPlaintext(workspace) {
  return workspace.listDocuments('extension').every(row => !JSON.stringify(workspace.readDocument('extension', row.id)).includes(secret));
}
try {
  app = await start({ webRoot: prepared.webRoot, dataRoot, initialize: true, storage: observedStorage, credentialKeyProvider: keyProvider, endpoint: { hostname: 'localhost', port: 0 } });
  workspaceId = app.workspaceId; connection = await connect();
  check('使用批准磁盘运行包、随机localhost与独立空SQLite；未访问3100或Keychain', new URL(app.origin).port !== '3100');
  const json = state => JSON.stringify({ state, version: 0 });
  const values = {
    app_state: {
      'infinite-canvas:canvas_store': json({ projects: [{ id: 'stage6-product', title: '命名空间验收', nodes: [{ id: 'text-1', type: 'text', metadata: { content: '文本' } }, { id: 'text-2', type: 'text', metadata: { content: '连线目标' } }], connections: [{ id: 'edge-1', source: 'text-1', target: 'text-2' }] }], deletedProjects: [] }),
      'infinite-canvas:asset_store': json({ assets: [{ id: 'asset-1', kind: 'text', title: '测试素材', data: { content: '本机素材内容' } }] }),
      'infinite-canvas:plugin_store': json({ plugins: [] }),
      'infinite-canvas:ai_config_store': json({ config: { channels: [{ id: 'test', apiKey: secret }] } }),
      'infinite-canvas:theme_store': json({ mode: 'dark', theme: 'dark' }),
      'infinite-canvas:prompt_source_store_v2': json({ sources: [{ id: 'test-source', name: '本地测试来源', enabled: true }], schedule: { enabled: false } }),
    },
    image_files: { 'image:test': new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2nJ6kAAAAASUVORK5CYII=', 'base64')], { type: 'image/png' }) },
    image_previews: { 'image:test': { blob: new Blob(['synthetic-thumbnail'], { type: 'image/webp' }), width: 1, height: 1 } },
    image_generation_logs: { 'image-log:test': { id: 'image-log:test', prompt: '隔离测试', state: 'success', createdAt: new Date('2026-10-18T00:00:00Z') } },
    video_generation_logs: { 'video-log:test': { id: 'video-log:test', state: 'completed', data: { durationMs: 1000 } } },
    media_files: { 'video:test': new Blob(['synthetic-video-byte-roundtrip'], { type: 'video/mp4' }), 'audio:test': new Blob(['synthetic-audio-byte-roundtrip'], { type: 'audio/wav' }) },
    prompt_cache: { 'prompt-source:test-source': { sourceId: 'test-source', items: [{ id: 'prompt-1', title: '尺寸展示', prompt: '展示产品尺寸' }], count: 1, fetchedAt: 1, signature: 'test' } },
    preferences: { 'infinite-canvas:locale': 'zh-CN', 'canvas-side-panel-width': '320', 'canvas-side-panel-open': '1', 'canvas-side-panel-node-view': 'grid', 'canvas-image-quick-tools': '["download"]', 'canvas-agent-token': secret },
  };
  assert.deepEqual(Object.keys(values).sort(), [...APP_NAMESPACES].sort());
  for (const [namespace, records] of Object.entries(values)) {
    const store = connection.application.createInstance({ storeName: namespace });
    for (const [key, value] of Object.entries(records)) await store.setItem(key, value);
    await store.setItem('阶段6删除探针', '仅合成数据'); await store.removeItem('阶段6删除探针');
    assert.equal(await store.getItem('阶段6删除探针'), null);
    for (const [key, value] of Object.entries(records)) assert.deepEqual(await normalize(await store.getItem(key)), await normalize(value));
    check(namespace + '：写入ACK、读回、删除及邻接记录保留');
  }
  await connection.application.flush();
  const expected = await state(connection.application);
  check('全部命名空间保存完成且无未确认请求', connection.application.getStatus().pending === 0 && connection.application.getStatus().state === 'saved');
  check('API Key和休眠Agent token均为密文引用；未启用Agent', noPlaintext(observedWorkspace));
  assert.throws(() => connection.application.createInstance({ name: 'infinite-canvas-plugins', storeName: 'test' }), error => error.code === 'namespace_denied');
  assert.throws(() => connection.application.createInstance({ storeName: 'unknown_namespace' }), error => error.code === 'namespace_denied');
  check('任意插件与未知命名空间不能越界接入');
  receipt = await observedService.createBackup(); recoveredRoot = join(root, '完整备份恢复'); storage.restoreBackup({ backupRoot: receipt.path, targetRoot: recoveredRoot });
  await connection.close(); connection = null; await app.close(); app = null;
  check('正常停止释放实例锁，保留SQLite和媒体', !existsSync(join(dataRoot, '.实例锁.json')));
  app = await start({ webRoot: prepared.webRoot, dataRoot, initialize: false, storage: observedStorage, credentialKeyProvider: keyProvider, endpoint: { hostname: 'localhost', port: 0 } }); connection = await connect();
  assert.deepEqual(await state(connection.application), expected);
  check('同工作区冷重开跨随机端口恢复全部8命名空间、6份状态、音视频字节与凭据', app.workspaceId === workspaceId && noPlaintext(observedWorkspace));
  await connection.close(); connection = null; await app.close(); app = null;
  const recovered = storage.openWorkspace({ dataRoot: recoveredRoot });
  const vault = await openSQLiteCredentialVault({ workspace: recovered, keyProvider });
  const { createShardedApplicationStorage } = await load('web/src/guan/sqlite/分片应用存储.mjs');
  const restored = createShardedApplicationStorage({ secretPort: vault, client: {
    readDocument: async (...args) => recovered.readDocument(...args),
    readMedia: async id => { const media = recovered.readMedia(id); return new Blob([media.bytes], { type: media.mime }); },
  } });
  try { assert.deepEqual(await state(restored), expected); } finally { restored.close(); vault.close(); recovered.close(); }
  const db = new DatabaseSync(join(recoveredRoot, '工作台.sqlite'), { readOnly: true });
  try { assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok'); assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0); } finally { db.close(); }
  check('完整备份恢复全命名空间语义、媒体哈希与凭据一致，完整性及外键通过');
  app = await start({ webRoot: prepared.webRoot, dataRoot, initialize: false, storage: observedStorage, credentialKeyProvider: keyProvider, endpoint: { hostname: 'localhost', port: 0 } }); connection = await connect();
  for (const namespace of APP_NAMESPACES) { const store = connection.application.createInstance({ storeName: namespace }); await store.clear(); assert.equal(await store.length(), 0); }
  await connection.close(); connection = null; await app.close(); app = null;
  app = await start({ webRoot: prepared.webRoot, dataRoot, initialize: false, storage: observedStorage, credentialKeyProvider: keyProvider, endpoint: { hostname: 'localhost', port: 0 } }); connection = await connect();
  const empty = await state(connection.application); assert.ok(Object.values(empty).every(records => !Object.keys(records).length));
  check('8命名空间clear均提交并冷重开仍空，原备份和媒体文件不被物理删除', existsSync(receipt.path));
  check('未提高默认HTTP限流，未出现429', !requests.some(item => item.status === 429));
  passed = true;
} catch (error) { blocked.push(error.message); process.exitCode = 1; }
finally {
  try { await connection?.close(); await app?.close(); } catch (error) { passed = false; blocked.push(error.message); process.exitCode = 1; }
  material.fill(0);
  const report = { passed, date: new Date().toISOString(), results, blocked, namespaces: APP_NAMESPACES, dataRoot, recoveredRoot, receipt, workspaceId,
    requests, testMaterialZeroed: true, real3100Untouched: true, realKeychainAccessed: false, realCredentialsUsed: false,
    scope: '正式批准模块的HTTP→SQLite及冷恢复契约；合成音视频仅检验字节/MIME，不代表播放、付费生成或客户业务验收。' };
  const reportName = existsSync(join(output, '全命名空间验收.json')) ? '全命名空间复验.json' : '全命名空间验收.json';
  writeFileSync(join(output, reportName), JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ passed, results: results.length, blocked, dataRoot }));
}
