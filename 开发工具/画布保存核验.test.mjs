import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { createValueCodec } from '../扩展功能/本机存储/应用值编码.mjs';
import { buildFragmentPlan } from '../扩展功能/本机存储/分片值编码.mjs';
import { createSavedCanvasVerifier } from '../扩展功能/生成任务/画布保存核验.mjs';
import { generationFixture } from './生成网关隔离夹具.mjs';

const rootId = 'app-' + createHash('sha256').update('app_state').digest('hex');
async function save(f, job, { sharded = true, productId = job.productId, nodeId = job.nodeId, status = 'success', responseHash = job.result.id } = {}) {
  const codec = createValueCodec({ client: {} });
  const encoded = await codec.encode({ state: { projects: [{ id: productId, nodes: [{ id: nodeId, metadata: { status, gatewayGenerationReceipts: [{ taskId: job.id, responseHash }] } }] }] }, version: 0 });
  const entries = [['infinite-canvas:canvas_store', encoded]];
  let value = { format: 'guan-app-storage.v1', namespace: 'app_state', entries };
  if (sharded) {
    const plan = await buildFragmentPlan(entries);
    for (const part of plan.fragments.values()) if (!f.workspace.readDocument('extension', part.id)) f.workspace.writeDocument({ collection: 'extension', id: part.id, value: part.value, expectedRevision: 0, operationId: randomUUID() });
    value = { format: 'guan-app-storage.v2', namespace: 'app_state', entryCount: entries.length, head: plan.head };
  }
  const before = f.workspace.readDocument('extension', rootId);
  const ack = f.workspace.writeDocument({ collection: 'extension', id: rootId, value, expectedRevision: before?.revision || 0, operationId: randomUUID() });
  return { rootRevision: ack.revision, rootHash: ack.hash };
}
for (const sharded of [false, true]) test('真实SQLite的' + (sharded ? 'v2分片' : 'v1兼容') + '根核验原产品/节点/响应摘要，不读取凭据', async () => {
  const f = await generationFixture();
  try {
    const b = await f.bind(), input = f.submit(b.binding); await f.tasks.submit(input); await f.tasks.drain();
    const job = f.tasks.get(input.id), verify = createSavedCanvasVerifier({ workspace: f.workspace });
    const checkpoint = await save(f, job, { sharded });
    assert.equal(await verify(job, checkpoint), true);
    assert.equal(await verify({ ...job, productId: 'product-B' }, checkpoint), false);
    assert.equal(await verify({ ...job, nodeId: 'node-B' }, checkpoint), false);
    assert.equal(await verify({ ...job, result: { ...job.result, id: 'a'.repeat(64) } }, checkpoint), false);
    assert.equal(await verify(job, { saved: true }), false);
    const newer = await save(f, job, { sharded, status: 'loading' });
    assert.equal(await verify(job, checkpoint), false); assert.equal(await verify(job, newer), false);
  } finally { await f.close(); }
});
test('丢失或损坏分片不能当成空画布或保存成功', async () => {
  const f = await generationFixture();
  try {
    const value = { format: 'guan-app-storage.v2', namespace: 'app_state', entryCount: 1, head: { id: 'app-part-' + 'a'.repeat(64) } };
    const ack = f.workspace.writeDocument({ collection: 'extension', id: rootId, value, expectedRevision: 0, operationId: randomUUID() });
    const verify = createSavedCanvasVerifier({ workspace: f.workspace });
    await assert.rejects(verify({ id: randomUUID(), productId: 'p', nodeId: 'n', result: { id: 'a'.repeat(64) } }, { rootRevision: ack.revision, rootHash: ack.hash }));
  } finally { await f.close(); }
});
