import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openWorkspace } from '../扩展功能/本机存储/SQLite工作区.mjs';
import { createValueCodec } from '../扩展功能/本机存储/应用值编码.mjs';
import { buildFragmentPlan } from '../扩展功能/本机存储/分片值编码.mjs';
import { createRecoverableApplicationStorage } from '../扩展功能/本机存储/可恢复应用存储.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');

test('冷读旧v2分片后，新保存只覆写命名空间根文档', async () => {
  const parent = mkdtempSync(join(tmpdir(), 'guan-sqlite-single-document-'));
  let workspace;
  try {
    workspace = openWorkspace({ dataRoot: join(parent, '数据'), initialize: true });
    const namespace = 'app_state';
    const rootId = 'app-' + sha(namespace);
    const key = 'infinite-canvas:canvas_store';
    const initial = JSON.stringify({ state: { projects: [{ id: 'legacy', title: '旧分片画布', nodes: [], connections: [] }] } });
    const codec = createValueCodec({ client: {}, readBlobUrl: async () => { throw Error('unexpected media'); } });
    const encoded = await codec.encode(JSON.parse(initial));
    codec.close();
    const plan = await buildFragmentPlan([[key, encoded]]);
    for (const part of plan.fragments.values()) {
      workspace.writeDocument({ collection: 'extension', id: part.id, value: part.value, expectedRevision: 0,
        operationId: randomUUID(), mediaIds: [] });
    }
    workspace.writeDocument({ collection: 'extension', id: rootId,
      value: { format: 'guan-app-storage.v2', namespace, entryCount: 1, head: plan.head },
      expectedRevision: 0, operationId: randomUUID(), mediaIds: [] });
    const beforeFragments = workspace.listDocuments('extension').filter(row => row.id.startsWith('app-part-')).length;
    const client = {
      async readDocument(collection, id, options) {
        const document = workspace.readDocument(collection, id);
        if (!document && !options?.allowMissing) throw Object.assign(Error('missing'), { code: 'document_not_found', status: 404 });
        return document;
      },
      async readNamespace(name) {
        return { root: workspace.readDocument('extension', 'app-' + sha(name)), fragments: [...plan.fragments.values()].map(part =>
          workspace.readDocument('extension', part.id)) };
      },
      async writeDocument(input) { return workspace.writeDocument(input); },
      async readUsage() { return workspace.readUsage(); },
    };
    const app = createRecoverableApplicationStorage({ client });
    const store = app.createInstance({ name: 'infinite-canvas', storeName: namespace });
    assert.equal(await store.getItem(key), initial);

    const next = JSON.stringify({ state: { projects: [{ id: 'legacy', title: '直接单文档保存', nodes: [], connections: [] }] } });
    await store.setItem(key, next);
    await app.flush();
    assert.equal(workspace.readDocument('extension', rootId).value.format, 'guan-app-storage.v1');
    assert.equal(workspace.listDocuments('extension').filter(row => row.id.startsWith('app-part-')).length, beforeFragments);
    app.close();

    const cold = createRecoverableApplicationStorage({ client });
    assert.equal(await cold.createInstance({ name: 'infinite-canvas', storeName: namespace }).getItem(key), next);
    await cold.flush();
    cold.close();
  } finally {
    workspace?.close();
    rmSync(parent, { recursive: true, force: true });
  }
});
