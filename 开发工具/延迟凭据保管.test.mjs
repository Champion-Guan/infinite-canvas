import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { openWorkspace } from '../扩展功能/本机存储/SQLite工作区.mjs';
import { openSQLiteCredentialVault } from '../扩展功能/本机凭据/SQLite凭据保管.mjs';
import { createDeferredCredentialVault } from '../扩展功能/本机凭据/延迟凭据保管.mjs';

test('钥匙串暂不可用不阻断普通画布保存；密文引用保留，真实凭据读写仍拒绝并合并重试', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), '延迟凭据验收-'))), key = randomBytes(32);
  const workspace = openWorkspace({ dataRoot: join(root, '数据'), initialize: true });
  let vault, lazy, calls = 0, now = 10000, failing = true;
  try {
    const originalProvider = { read: async () => Buffer.from(key), create: async () => Buffer.from(key) };
    vault = await openSQLiteCredentialVault({ workspace, keyProvider: originalProvider, initialize: true });
    const ref = await vault.store('synthetic-api-secret'); vault.close(); vault = null;
    const before = JSON.stringify(workspace.readDocument('extension', ref));
    lazy = await createDeferredCredentialVault({ workspace, keyProvider: { ...originalProvider, async read() { calls++; if (failing) throw Error('钥匙串不可用'); return Buffer.from(key); } } }, { now: () => now });
    assert.equal(calls, 0); assert.equal(await lazy.inspect(ref), 'guan-vault:' + ref); assert.equal(calls, 0);
    workspace.writeDocument({ collection: 'canvas', id: 'save-check', value: { id: 'save-check', title: '保存检查', nodes: [], connections: [] }, expectedRevision: 0, operationId: randomUUID() });
    assert.ok(workspace.readDocument('canvas', 'save-check'));
    await assert.rejects(lazy.read(ref), { code: 'credential_unavailable' });
    await assert.rejects(lazy.store('another-synthetic'), { code: 'credential_unavailable' }); assert.equal(calls, 1);
    assert.equal(JSON.stringify(workspace.readDocument('extension', ref)), before);
    now += 5001; failing = false;
    assert.equal(await lazy.read(ref), 'synthetic-api-secret'); assert.equal(calls, 2);
    assert.equal(lazy.getStatus().state, 'ready'); assert.equal(JSON.stringify(workspace.readDocument('extension', ref)), before);
  } finally { lazy?.close(); vault?.close(); workspace.close(); key.fill(0); rmSync(root, { recursive: true, force: true }); }
});
