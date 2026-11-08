import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openWorkspace, restoreBackup } from '../扩展功能/本机存储/SQLite工作区.mjs';
import { openSQLiteCredentialVault } from '../扩展功能/本机凭据/SQLite凭据保管.mjs';
import { createRecoverableShardedApplicationStorage } from '../扩展功能/本机存储/可恢复分片应用存储.mjs';
import { CREDENTIAL_FORMAT } from '../扩展功能/本机凭据/凭据协议.mjs';

const code = expected => error => error?.code === expected;
const roots = [];
function masterFixture() {
  const keys = new Map(); let creates = 0, reads = 0;
  return { keys, get counts() { return { creates, reads }; }, provider: {
    async create(id) { creates++; if (!keys.has(id)) keys.set(id, randomBytes(32)); return Buffer.from(keys.get(id)); },
    async read(id) { reads++; if (!keys.has(id)) throw Error('合成系统锁定，不是真实Keychain'); return Buffer.from(keys.get(id)); },
  } };
}
async function fixture({ initialize = true, wrap = value => value } = {}) {
  const parent = mkdtempSync(join(tmpdir(), 'guan-credentials-test-')), dataRoot = join(parent, '数据'); roots.push(parent);
  const workspace = openWorkspace({ dataRoot, initialize: true }), master = masterFixture();
  try {
    const vault = await openSQLiteCredentialVault({ workspace: wrap(workspace), keyProvider: master.provider, initialize });
    return { parent, dataRoot, workspace, master, vault, close() { vault.close(); workspace.close(); } };
  } catch (error) { workspace.close(); throw error; }
}
function assertNoPlaintext(root, value) {
  for (const item of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, item.name);
    if (item.isDirectory()) assertNoPlaintext(path, value);
    else assert.equal(readFileSync(path).includes(Buffer.from(value)), false, '数据/WAL/备份不得包含虚构密钥明文');
  }
}

test('AES-GCM密文落盘、同值复用、不同值隔离、重开后可读，密钥不在SQLite/WAL', async () => {
  const f = await fixture();
  try {
    const value = 'synthetic-api-key-非真实-' + randomUUID(), ref = await f.vault.store(value);
    assert.match(ref, /^secret:[0-9a-f]{64}$/); assert.equal(await f.vault.store(value), ref);
    assert.notEqual(ref.slice(7), createHash('sha256').update(value).digest('hex'));
    const other = await f.vault.store(value + '-2'); assert.notEqual(other, ref);
    assert.equal(await f.vault.read(ref), value); assert.equal(f.workspace.readDocument('extension', ref).revision, 1);
    assertNoPlaintext(f.dataRoot, value);
    f.vault.close();
    const reopened = await openSQLiteCredentialVault({ workspace: f.workspace, keyProvider: f.master.provider });
    assert.equal(await reopened.read(ref), value); assert.deepEqual(f.master.counts, { creates: 1, reads: 1 }); reopened.close();
  } finally { f.close(); }
});

test('同一虚构密钥在不同工作区引用和密文不同', async () => {
  const a = await fixture(), b = await fixture();
  try {
    const value = 'synthetic-same-not-real', x = await a.vault.store(value), y = await b.vault.store(value);
    assert.notEqual(x, y); assert.notDeepEqual(a.workspace.readDocument('extension', x).value, b.workspace.readDocument('extension', y).value);
    await assert.rejects(b.vault.read(x), code('secret_not_found'));
  } finally { a.close(); b.close(); }
});

test('首次未显式初始化与非空业务库拒绝创建主密钥', async () => {
  await assert.rejects(fixture({ initialize: false }), code('credential_initialization_required'));
  const parent = mkdtempSync(join(tmpdir(), 'guan-credential-nonempty-')); roots.push(parent);
  const workspace = openWorkspace({ dataRoot: join(parent, '数据'), initialize: true }), master = masterFixture();
  try {
    workspace.writeDocument({ collection: 'extension', id: 'existing', value: { preserved: true }, expectedRevision: 0, operationId: randomUUID() });
    await assert.rejects(openSQLiteCredentialVault({ workspace, keyProvider: master.provider, initialize: true }), code('credential_initialization_denied'));
    assert.equal(master.counts.creates, 0); assert.deepEqual(workspace.readDocument('extension', 'existing').value, { preserved: true });
  } finally { workspace.close(); }
});

test('锁定/丢失/错误主密钥均拒绝，不自动创建替代或覆盖标记', async () => {
  const f = await fixture();
  try {
    const ref = await f.vault.store('synthetic-before-lock'), marker = f.workspace.readDocument('extension', 'guan-credential-vault');
    f.vault.close(); const original = Buffer.from(f.master.keys.get(f.workspace.workspaceId));
    f.master.keys.delete(f.workspace.workspaceId);
    await assert.rejects(openSQLiteCredentialVault({ workspace: f.workspace, keyProvider: f.master.provider, initialize: true }), code('credential_unavailable'));
    f.master.keys.set(f.workspace.workspaceId, randomBytes(32));
    await assert.rejects(openSQLiteCredentialVault({ workspace: f.workspace, keyProvider: f.master.provider, initialize: true }), code('credential_master_mismatch'));
    assert.deepEqual(f.workspace.readDocument('extension', 'guan-credential-vault'), marker); assert.equal(f.master.counts.creates, 1);
    f.master.keys.set(f.workspace.workspaceId, original);
    const recovered = await openSQLiteCredentialVault({ workspace: f.workspace, keyProvider: f.master.provider });
    assert.equal(await recovered.read(ref), 'synthetic-before-lock'); recovered.close();
  } finally { f.close(); }
});

for (const kind of ['iv', 'tag', 'sealed', 'workspaceId', 'format', 'extra', 'revision', 'media']) test('密文篡改拒绝且不改写：' + kind, async () => {
  const f = await fixture();
  try {
    const ref = await f.vault.store('synthetic-tamper-test'), original = f.workspace.readDocument('extension', ref);
    const wrapped = { ...f.workspace, readDocument(collection, id) {
      const doc = f.workspace.readDocument(collection, id);
      if (id !== ref) return doc;
      const next = structuredClone(doc);
      if (kind === 'iv' || kind === 'tag' || kind === 'sealed') next.value[kind] = (next.value[kind][0] === '0' ? '1' : '0') + next.value[kind].slice(1);
      if (kind === 'workspaceId') next.value.workspaceId = randomUUID();
      if (kind === 'format') next.value.format = 'future';
      if (kind === 'extra') next.value.other = 'injected';
      if (kind === 'revision') next.revision = 2;
      if (kind === 'media') next.mediaIds = ['0'.repeat(64)];
      return next;
    } };
    const vault = await openSQLiteCredentialVault({ workspace: wrapped, keyProvider: f.master.provider });
    await assert.rejects(vault.read(ref), code('credential_corrupt')); vault.close();
    assert.deepEqual(f.workspace.readDocument('extension', ref), original);
  } finally { f.close(); }
});

test('跨引用拷贝密文即使同库仍拒绝，缺失/非法引用不读其他内容', async () => {
  const f = await fixture();
  try {
    const a = await f.vault.store('synthetic-a'), b = await f.vault.store('synthetic-b');
    const wrapper = { ...f.workspace, readDocument(collection, id) { const doc = f.workspace.readDocument(collection, id); return id === a ? { ...doc, value: f.workspace.readDocument(collection, b).value } : doc; } };
    const vault = await openSQLiteCredentialVault({ workspace: wrapper, keyProvider: f.master.provider });
    await assert.rejects(vault.read(a), code('credential_corrupt')); vault.close();
    assert.throws(() => f.vault.read('../other'), code('invalid_secret_ref'));
    await assert.rejects(f.vault.read('secret:' + '0'.repeat(64)), code('secret_not_found'));
  } finally { f.close(); }
});

test('字节上限、空串、未知类型和破损Unicode失败，合法边界与特殊字符精确恢复', async () => {
  const f = await fixture();
  try {
    for (const value of ['', null, {}, 42, '\ud800', 'x'.repeat(2049), '中'.repeat(683)]) assert.throws(() => f.vault.store(value), code('invalid_credential'));
    for (const value of ['x'.repeat(2048), '中'.repeat(682), '\u0000\r\n"\\😀']) assert.equal(await f.vault.read(await f.vault.store(value)), value);
  } finally { f.close(); }
});

for (const phase of ['before', 'after', 'ack']) test('凭据写入故障后重复store核实持久化，不覆盖或重复revision：' + phase, async () => {
  let once = true;
  const f = await fixture({ wrap: workspace => ({ ...workspace, writeDocument(input) {
    if (!input.id.startsWith('secret:') || !once) return workspace.writeDocument(input);
    once = false;
    if (phase === 'before') throw Error('合成提交前失败');
    const ack = workspace.writeDocument(input);
    if (phase === 'after') throw Error('合成丢ACK');
    return { ...ack, operationId: randomUUID() };
  } }) });
  try {
    await assert.rejects(f.vault.store('synthetic-retry-only'), code(phase === 'ack' ? 'credential_ack_invalid' : 'credential_unavailable'));
    const ref = await f.vault.store('synthetic-retry-only');
    assert.equal(await f.vault.read(ref), 'synthetic-retry-only'); assert.equal(f.workspace.readDocument('extension', ref).revision, 1);
    assert.equal(f.workspace.listDocuments('extension').filter(row => row.id.startsWith('secret:')).length, 1);
  } finally { f.close(); }
});

test('应用配置走真实加密端口，分片根只含引用；冷打开和包含媒体的备份恢复可用', async () => {
  const f = await fixture();
  const client = {
    readDocument: async (collection, id) => f.workspace.readDocument(collection, id),
    writeDocument: async input => f.workspace.writeDocument(input),
    writeMedia: async blob => f.workspace.writeMedia(Buffer.from(await blob.arrayBuffer()), blob.type),
    readMedia: async id => { const value = f.workspace.readMedia(id); return new Blob([value.bytes], { type: value.mime }); },
  };
  let app;
  try {
    app = createRecoverableShardedApplicationStorage({ client, secretPort: f.vault });
    const key = 'infinite-canvas:ai_config_store', value = JSON.stringify({ state: { apiKey: 'synthetic-config-key', channels: [{ apiKey: 'synthetic-channel-key' }], webdav: { password: 'synthetic-' + 'webdav-pass' } }, version: 0 });
    await app.createInstance().setItem(key, value);
    await app.createInstance({ storeName: 'image_files' }).setItem('image:one', new Blob(['synthetic-image'], { type: 'image/png' }));
    await app.flush(); app.close();
    assertNoPlaintext(f.dataRoot, 'synthetic-config-key'); assertNoPlaintext(f.dataRoot, 'synthetic-webdav-pass');
    const backup = await f.workspace.createBackup(); assertNoPlaintext(backup.path, 'synthetic-channel-key');
    const restoredRoot = join(f.parent, '冷恢复'); restoreBackup({ backupRoot: backup.path, targetRoot: restoredRoot });
    const restored = openWorkspace({ dataRoot: restoredRoot });
    try {
      const vault = await openSQLiteCredentialVault({ workspace: restored, keyProvider: f.master.provider });
      const reader = createRecoverableShardedApplicationStorage({ client: { readDocument: async (...args) => restored.readDocument(...args), readMedia: async id => { const media = restored.readMedia(id); return new Blob([media.bytes], { type: media.mime }); } }, secretPort: vault });
      const stored = JSON.parse(await reader.createInstance().getItem(key));
      assert.equal(stored.state.apiKey, 'guan-vault:' + await vault.store('synthetic-config-key'));
      assert.equal(stored.state.channels[0].apiKey, 'guan-vault:' + await vault.store('synthetic-channel-key'));
      assert.equal(stored.state.webdav.password, 'guan-vault:' + await vault.store('synthetic-webdav-pass'));
      assert.equal(JSON.stringify(stored).includes('synthetic-'), false);
      assert.equal(await (await reader.createInstance({ storeName: 'image_files' }).getItem('image:one')).text(), 'synthetic-image');
      await reader.flush(); reader.close(); vault.close();
      assert.equal(restored.readDocument('extension', 'guan-credential-vault').value.format, CREDENTIAL_FORMAT);
      const missing = masterFixture(); await assert.rejects(openSQLiteCredentialVault({ workspace: restored, keyProvider: missing.provider }), code('credential_unavailable'));
      assert.equal(missing.counts.creates, 0);
    } finally { restored.close(); }
  } finally { if (app?.getStatus().pending === 0) app.close(); f.close(); }
});

test('配置凭据失败保持旧根，恢复原FIFO队列后才能报告保存成功', async () => {
  const f = await fixture(); let offline = false;
  const app = createRecoverableShardedApplicationStorage({ client: { readDocument: async (...args) => f.workspace.readDocument(...args), writeDocument: async input => f.workspace.writeDocument(input) },
    secretPort: { store: value => { if (offline) throw Error('合成凭据服务不可用'); return f.vault.store(value); }, inspect: ref => f.vault.inspect(ref) } });
  try {
    const store = app.createInstance(), key = 'infinite-canvas:ai_config_store';
    await store.setItem(key, JSON.stringify({ state: { apiKey: 'synthetic-old' }, version: 0 })); await app.flush();
    offline = true;
    await assert.rejects(store.setItem(key, JSON.stringify({ state: { apiKey: 'synthetic-new' }, version: 0 })));
    assert.equal(app.getStatus().state, 'error'); await assert.rejects(app.flush(), code('save_not_confirmed'));
    offline = false; await app.retryPending(); await app.flush();
    assert.equal(JSON.parse(await store.getItem(key)).state.apiKey, 'guan-vault:' + await f.vault.store('synthetic-new')); app.close();
  } finally { f.close(); }
});

test('并发store保持一个条目，关闭时拒绝在途，结束后拒绝再操作', async () => {
  const f = await fixture();
  try {
    const saving = f.vault.store('synthetic-concurrent'); assert.throws(() => f.vault.close(), code('credential_busy'));
    const refs = await Promise.all([saving, f.vault.store('synthetic-concurrent'), f.vault.store('synthetic-concurrent')]);
    assert.equal(new Set(refs).size, 1); assert.equal(f.vault.getStatus().pending, 0); f.vault.close();
    assert.throws(() => f.vault.read(refs[0]), code('credential_closed'));
  } finally { f.close(); }
});

test.after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });
