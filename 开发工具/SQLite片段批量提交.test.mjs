import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openWorkspace } from '../扩展功能/本机存储/SQLite工作区.mjs';
import { createShardedApplicationStorage } from '../扩展功能/本机存储/分片应用存储.mjs';
import { buildFragmentPlan } from '../扩展功能/本机存储/分片值编码.mjs';
import { createDataClient } from '../扩展功能/本机存储/浏览器适配.mjs';
import { MAX_FRAGMENT_BATCH_COUNT } from '../扩展功能/本机存储/协议.mjs';
import { startDataService } from '../扩展功能/本机服务/数据服务.mjs';

const rootId = name => 'app-' + createHash('sha256').update(name).digest('hex');
const testRoots = [];
function temporaryRoot(prefix) {
  const root = mkdtempSync(join(tmpdir(), prefix)); testRoots.push(root); return root;
}
function largeValue() {
  const content = Array.from({ length: 4200 }, (_, index) => `${index.toString(36).padStart(6, '0')}-${'x'.repeat(1000)}`).join('');
  return { content };
}

test('片段批次在HTTP ACK丢失后沿用原操作ID重试，再单独CAS发布完整根', async () => {
  const root = temporaryRoot('guan-fragment-batch-http-'), origin = 'http://localhost:43121';
  const workspace = openWorkspace({ dataRoot: root, initialize: true });
  const service = await startDataService({ workspace, allowedOrigins: [origin], rateLimit: 0 });
  let dropOneAck = true, batchRequests = 0, rootWrites = 0;
  const uniqueFragmentIds = new Set();
  const fetchImpl = async (url, init = {}) => {
    const isBatch = url.endsWith('/fragments');
    if (isBatch) {
      batchRequests++;
      for (const fragment of JSON.parse(init.body).fragments) uniqueFragmentIds.add(fragment.id);
    }
    if (url.includes('/documents/extension/app-') && init.method === 'PUT') rootWrites++;
    const response = await fetch(url, { ...init, headers: { ...init.headers, Origin: origin } });
    if (isBatch && dropOneAck) {
      dropOneAck = false;
      await response.text();
      throw Error('合成回执丢失');
    }
    return response;
  };
  const client = createDataClient({ url: service.url, session: service.issueSession(origin),
    fetchImpl });
  const storage = createShardedApplicationStorage({ client, requestLimit: 0 });
  const instance = storage.createInstance();
  try {
    const value = largeValue(), plan = await buildFragmentPlan(value);
    assert.ok(plan.fragments.size > 4, '样本必须覆盖多个受限批次');
    const requestsBefore = batchRequests;

    await assert.rejects(instance.setItem('large', value), /回执丢失/);
    assert.equal(workspace.readDocument('extension', rootId('app_state')), null, '全部片段确认前不得发布根目录');
    await storage.retry('app_state');
    await storage.flush();

    const rootDocument = workspace.readDocument('extension', rootId('app_state'));
    assert.equal(rootDocument.value.format, 'guan-app-storage.v2');
    assert.deepEqual(await instance.getItem('large'), value);
    assert.ok(uniqueFragmentIds.size > 4);
    assert.ok(batchRequests - requestsBefore <= Math.ceil(uniqueFragmentIds.size / MAX_FRAGMENT_BATCH_COUNT) + 1, 'HTTP批次数应远小于分片数，额外1次用于丢失回执重试');
    assert.equal(rootWrites, 1, '仅在重试取得所有片段ACK后写一次根目录');
    const revisions = [...uniqueFragmentIds].map(id => workspace.readDocument('extension', id).revision);
    assert.ok(revisions.every(revision => revision === 1), '丢失回执重试不能重复增加分片版本');
    storage.close(); client.close();
  } finally {
    try { storage.close(); } catch {}
    try { client.close(); } catch {}
    try { service.close(); } catch {}
    workspace.close();
  }
});

test('批次中的任一提交前故障会回滚全部片段', async () => {
  let failBeforeCommit = false;
  const root = temporaryRoot('guan-fragment-batch-rollback-');
  const workspace = openWorkspace({ dataRoot: root, initialize: true, beforeCommit() {
    if (failBeforeCommit) { failBeforeCommit = false; throw Error('合成事务故障'); }
  } });
  try {
    const plan = await buildFragmentPlan(largeValue()), fragments = [...plan.fragments.values()].slice(0, MAX_FRAGMENT_BATCH_COUNT)
      .map(part => ({ id: part.id, value: part.value, operationId: randomUUID() }));
    assert.equal(fragments.length, MAX_FRAGMENT_BATCH_COUNT);
    failBeforeCommit = true;
    assert.throws(() => workspace.writeFragments(fragments), /合成事务故障/);
    for (const fragment of fragments) assert.equal(workspace.readDocument('extension', fragment.id), null);
  } finally { workspace.close(); }
});

test.after(() => { for (const root of testRoots) rmSync(root, { recursive: true, force: true }); });
