import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openWorkspace } from '../扩展功能/本机存储/SQLite工作区.mjs';
import { createApplicationStorage } from '../扩展功能/本机存储/应用存储适配.mjs';
import { readFragmentGraph } from '../扩展功能/本机存储/分片值编码.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
function graph() {
  const documents = new Map();
  const part = body => {
    const value = { format: 'guan-app-fragment.v1', ...body }, id = 'app-part-' + hash(JSON.stringify(value));
    documents.set(id, { collection: 'extension', id, value, mediaIds: [] });
    return { id };
  };
  return { part, documents, readDocument: async (_collection, id) => documents.get(id) };
}
test('升级后读取旧多块数组、文本、单元素、对象及字段目录，损坏引用仍拒绝', async () => {
  const g = graph(), a = g.part({ kind: 'json', data: ['旧画布'] }), b = g.part({ kind: 'json', data: ['图片记录'] });
  const head = g.part({ kind: 'array', parts: [a, b] });
  assert.deepEqual(await readFragmentGraph({ ...g, head }), ['旧画布', '图片记录']);
  const text = g.part({ kind: 'text', parts: [g.part({ kind: 'json', data: 'x\ud83d' }), g.part({ kind: 'json', data: '\ude00y' })] });
  assert.equal(await readFragmentGraph({ ...g, head: text }), 'x😀y');
  assert.deepEqual(await readFragmentGraph({ ...g, head: g.part({ kind: 'single', part: text }) }), ['x😀y']);
  const entries = g.part({ kind: 'json', data: [['name', '旧产品']] });
  assert.deepEqual(await readFragmentGraph({ ...g, head: g.part({ kind: 'object', entries }) }), { name: '旧产品' });
  const typed = g.part({ kind: 'json', data: [['name', ['ref', g.part({ kind: 'json', data: ['string', '旧产品'] })]]] });
  assert.deepEqual(await readFragmentGraph({ ...g, head: g.part({ kind: 'typed-object', entries: typed }) }), ['object', [['name', ['string', '旧产品']]]]);
  g.documents.delete(a.id);
  await assert.rejects(readFragmentGraph({ ...g, head }), error => error.code === 'fragment_corrupt');
});
test('真实SQLite旧多块根可冷读，新保存单文档，伪造ACK保留原操作并可恢复', async () => {
  const root = mkdtempSync(join(tmpdir(), '工作台升级兼容-'));
  let workspace = openWorkspace({ dataRoot: root, initialize: true }), app;
  try {
    const namespace = 'app_state', id = 'app-' + hash(namespace), g = graph();
    const first = g.part({ kind: 'json', data: [['first', { tree: ['string', '原画布'], mediaIds: [] }]] });
    const second = g.part({ kind: 'json', data: [['second', { tree: ['number', 87], mediaIds: [] }]] });
    const head = g.part({ kind: 'array', parts: [first, second] });
    for (const document of g.documents.values()) workspace.writeDocument({ ...document, expectedRevision: 0, operationId: randomUUID() });
    workspace.writeDocument({ collection: 'extension', id, value: { format: 'guan-app-storage.v2', namespace, head, entryCount: 2 }, mediaIds: [], expectedRevision: 0, operationId: randomUUID() });
    workspace.close(); workspace = openWorkspace({ dataRoot: root });
    const requests = []; let loseAck = true;
    const client = { readDocument: (...args) => workspace.readDocument(...args), writeDocument(write) {
      requests.push(structuredClone(write));
      const ack = workspace.writeDocument(write);
      return loseAck ? { ...ack, hash: '0'.repeat(64) } : ack;
    } };
    app = createApplicationStorage({ client });
    const store = app.createInstance();
    assert.equal(await store.getItem('first'), '原画布');
    assert.equal(await store.getItem('second'), 87);
    await assert.rejects(store.setItem('first', '新画布'), error => error.code === 'invalid_ack');
    await assert.rejects(app.flush(), error => error.code === 'save_not_confirmed');
    loseAck = false; await app.retry(namespace); await app.flush();
    assert.deepEqual(requests[0], requests[1]);
    assert.equal(workspace.readDocument('extension', id).revision, 2);
    assert.equal(workspace.readDocument('extension', id).value.format, 'guan-app-storage.v1');
    assert.equal(await store.getItem('first'), '新画布');
    assert.equal(await store.getItem('second'), 87);
    app.close(); app = null;
  } finally { app?.close(); workspace.close(); rmSync(root, { recursive: true, force: true }); }
});
