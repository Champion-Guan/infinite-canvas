import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createValueCodec } from '../扩展功能/本机存储/应用值编码.mjs';
import { serializeDocument, MAX_APPLICATION_VALUE_DEPTH, MAX_APPLICATION_DOCUMENT_DEPTH } from '../扩展功能/本机存储/协议.mjs';
import { createRecoverableApplicationStorage } from '../扩展功能/本机存储/可恢复应用存储.mjs';
import { openWorkspace } from '../扩展功能/本机存储/SQLite工作区.mjs';
import { variantModules } from './产品变体生成夹具.mjs';

const rootId = 'app-' + createHash('sha256').update('app_state').digest('hex');
const key = 'infinite-canvas:canvas_store';
const envelope = encoded => ({ format: 'guan-app-storage.v1', namespace: 'app_state', entries: [[key, encoded]] });
const depth = value => value && typeof value === 'object' ? 1 + Math.max(0, ...Object.values(value).map(depth)) : 0;
function nested(levels) { let value = 'leaf'; while (levels--) value = { child: value }; return value; }

test('编码文档预算覆盖业务对象完整32层，普通文档仍保持40层限制', async () => {
  const codec = createValueCodec({ client: {} });
  try {
    const source = nested(MAX_APPLICATION_VALUE_DEPTH);
    const encoded = await codec.encode(source);
    const document = envelope(encoded);
    assert.ok(depth(document) > 40);
    assert.ok(depth(document) <= MAX_APPLICATION_DOCUMENT_DEPTH);
    assert.doesNotThrow(() => serializeDocument('extension', rootId, document));
    assert.deepEqual(await codec.decode(encoded.tree), source);
    await assert.rejects(codec.encode(nested(MAX_APPLICATION_VALUE_DEPTH + 1)), { code: 'value_too_deep' });
    assert.throws(() => serializeDocument('extension', 'ordinary', nested(41)), { code: 'invalid_document' });
    assert.throws(() => serializeDocument('extension', rootId, { ...document, extra: nested(MAX_APPLICATION_DOCUMENT_DEPTH + 1) }), { code: 'invalid_document' });
  } finally { codec.close(); }
});

test('编码文档放宽展开层级后仍拒绝循环、非法数字、凭据字段及临时URL', () => {
  for (const [extra, code] of [[{ value: Infinity }, 'invalid_document'], [{ password: 'not-allowed' }, 'credential_field_rejected'],
    [{ url: 'blob:transient' }, 'transient_media_url'], [{ value: new Map() }, 'invalid_document']]) {
    assert.throws(() => serializeDocument('extension', rootId, { ...envelope({ tree: ['null'], mediaIds: [] }), extra }), { code });
  }
  const cycle = {}; cycle.self = cycle;
  assert.throws(() => serializeDocument('extension', rootId, { ...envelope({ tree: ['null'], mediaIds: [] }), cycle }), { code: 'invalid_document' });
});

test('完整参数卡复制、删除、恢复、再次删除及产品回收快照可保存并冷重开', async () => {
  const temporary = mkdtempSync(join(tmpdir(), '参数回收保存深度-'));
  let workspace, app;
  try {
    const loader = variantModules();
    const recycle = loader.load('画布回收/画布节点回收.ts');
    const copy = loader.load('画布布局/节点复制操作.ts');
    workspace = openWorkspace({ dataRoot: join(temporary, '数据'), initialize: true });
    const client = {
      readDocument: async (collection, id) => workspace.readDocument(collection, id),
      writeDocument: async input => workspace.writeDocument(input),
    };
    const parameter = { id: 'parameter', type: 'guan:prompt-variables', title: '产品参数设置',
      position: { x: 0, y: 0 }, width: 340, height: 800, metadata: {
        productImagePlan: { pendingFacts: ['承重'], confirmations: [{ id: 'load', scopes: [{ value: 'whole', chinese: '整架', english: 'whole rack' }] }] },
        productConfirmations: [{ factId: 'load', value: '10', images: [{ id: 'photo', name: '证据', storageKey: 'image:proof' }] }],
      } };
    const duplicated = copy.prepareCopiedNodes({ nodes: [parameter], connections: [] }, { x: 800, y: 0 }, [parameter], () => 'copy').nodes[0];
    let project = { id: 'product', title: '产品', nodes: [parameter, duplicated], connections: [], deletedNodeBatches: [] };
    const original = JSON.parse(JSON.stringify(duplicated.metadata));
    for (let round = 0; round < 3; round++) {
      const deleted = recycle.recycleCanvasNodes(project.nodes, project.connections, new Set(['copy']), project.deletedNodeBatches);
      project = { ...project, nodes: deleted.nodes, connections: deleted.connections, deletedNodeBatches: deleted.batches };
      for (const productRecycled of [false, true]) {
        const snapshot = { state: { projects: productRecycled ? [] : [project],
          deletedProjects: productRecycled ? [{ id: 'trash-product', project: structuredClone(project) }] : [] } };
        const text = JSON.stringify(snapshot);
        app = createRecoverableApplicationStorage({ client });
        await app.createInstance({ storeName: 'app_state' }).setItem(key, text);
        await app.flush(); app.close();
        workspace.close();
        workspace = openWorkspace({ dataRoot: join(temporary, '数据'), initialize: false });
        app = createRecoverableApplicationStorage({ client });
        const restored = JSON.parse(await app.createInstance({ storeName: 'app_state' }).getItem(key));
        assert.deepEqual(restored, JSON.parse(text));
        const saved = productRecycled ? restored.state.deletedProjects[0].project : restored.state.projects[0];
        assert.deepEqual(saved.deletedNodeBatches.at(-1).nodes[0].metadata, original);
        assert.ok(depth(workspace.readDocument('extension', rootId).value) > 40);
        app.close(); app = null;
      }
      const batch = project.deletedNodeBatches.at(-1);
      const restored = recycle.restoreCanvasNodes(project.nodes, project.connections, batch);
      project = { ...project, nodes: restored.nodes, connections: restored.connections, deletedNodeBatches: [] };
      assert.equal(project.nodes.length, 2);
    }
  } finally {
    app?.close(); workspace?.close();
    rmSync(temporary, { recursive: true, force: true });
  }
});
