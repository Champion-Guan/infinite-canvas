import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createValueCodec } from '../扩展功能/本机存储/应用值编码.mjs';
import { restoreCanvasMedia, sameDeferredCanvasMedia, retainCanvasMedia, hasDeferredCanvasMedia } from '../扩展功能/本机存储/画布媒体延迟恢复.mjs';
import { createApplicationStorage } from '../扩展功能/本机存储/应用存储适配.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openWorkspace } from '../扩展功能/本机存储/SQLite工作区.mjs';

test('冷恢复不读其他产品图片，保存保持媒体字节与全部引用；当前产品并发恢复共用原读取', async () => {
  const blobs = [new Blob(['one'], { type: 'image/png' }), new Blob(['two'], { type: 'image/png' })];
  const ids = blobs.map((_, i) => createHash('sha256').update(i ? 'two' : 'one').digest('hex'));
  const reads = [], codec = createValueCodec({ client: { readMedia: async id => { reads.push(id); return blobs[ids.indexOf(id)]; } } });
  const media = i => ['blob-url', { mime: 'image/png', size: 3, id: ids[i] }];
  const object = fields => ['object', Object.entries(fields)];
  const project = i => object({
    id: ['string', `p${i}`],
    nodes: ['array', [object({ content: media(i), storageKey: ['string', `image:${i}`] })]],
  });
  const tree = object({ state: object({ projects: ['array', [project(0), project(1)]] }) });
  try {
    const value = await codec.decode(tree, { deferMediaUrls: true });
    assert.deepEqual(reads, []);
    const saved = await codec.encode(value);
    assert.deepEqual(saved.tree, tree); assert.deepEqual(saved.mediaIds, [...ids].sort());
    const original = value.state.projects[0];
    const [a, b] = await Promise.all([restoreCanvasMedia(original), restoreCanvasMedia(original)]);
    assert.deepEqual(reads, [ids[0]]);
    assert.equal(a.nodes[0].content, b.nodes[0].content);
    assert.ok(sameDeferredCanvasMedia(original.nodes[0].content, a.nodes[0].content));
    assert.ok(!sameDeferredCanvasMedia(original.nodes[0].content, 'blob:unrelated'));
    const savedOpened = await codec.encode({ state: { projects: [a, value.state.projects[1]] } });
    assert.deepEqual(savedOpened.tree, tree);
    codec.invalidateMedia();
    assert.deepEqual((await codec.encode(value)).tree, tree);
    assert.deepEqual(reads, [ids[0]]);
  } finally { codec.close(); }
});

test('失败的媒体恢复可重读，同步校验仍拒绝坏描述；无媒体的产品保留对象身份', async () => {
  let reads = 0;
  const codec = createValueCodec({ client: { readMedia: async () => { if (++reads === 1) throw Error('断线'); return new Blob(['x']); } } });
  const tree = ['object', [['content', ['blob-url', { mime: 'image/png', size: 1, id: 'a'.repeat(64) }]]]];
  try {
    const value = await codec.decode(tree, { deferMediaUrls: true });
    await assert.rejects(restoreCanvasMedia(value), /断线/);
    assert.match((await restoreCanvasMedia(value)).content, /^blob:/);
    assert.equal(reads, 2);
    const noMedia = { nodes: [{ text: '保留' }] };
    assert.equal(await restoreCanvasMedia(noMedia), noMedia);
    await assert.rejects(codec.decode(['blob-url', { mime: 'image/png', size: 1, id: 'bad' }], { deferMediaUrls: true }), e => e.code === 'invalid_value');
  } finally { codec.close(); }
});

test('真实SQLite按需恢复后等值保存不增加版本；修改一处再冷读仍保留未打开产品图片', async () => {
  const root = mkdtempSync(join(tmpdir(), '画布媒体延迟-'));
  const workspace = openWorkspace({ dataRoot: root, initialize: true });
  let reads = 0, writes = 0, app, reopened, last;
  const client = {
    readDocument: async (...args) => workspace.readDocument(...args),
    writeDocument: async value => { writes++; return workspace.writeDocument(value); },
    writeMedia: async blob => workspace.writeMedia(Buffer.from(await blob.arrayBuffer()), blob.type),
    readMedia: async id => { reads++; const media = workspace.readMedia(id); return new Blob([media.bytes], { type: media.mime }); },
  };
  try {
    app = createApplicationStorage({ client, readBlobUrl: async url => new Blob([url], { type: 'image/png' }) });
    const key = 'infinite-canvas:canvas_store';
    const original = { state: { projects: [
      { id: 'one', title: '原文', nodes: [{ content: 'blob:one' }] },
      { id: 'two', title: '未打开', nodes: [{ content: 'blob:two' }] },
    ] } };
    await app.createInstance().setItem(key, JSON.stringify(original));
    app.close();
    reopened = createApplicationStorage({ client, deferCanvasMedia: true });
    const store = reopened.createInstance();
    const value = JSON.parse(await store.getItem(key));
    assert.equal(reads, 0);
    const opened = await restoreCanvasMedia(value.state.projects[0]);
    assert.equal(reads, 1);
    value.state.projects[0] = opened;
    const before = writes;
    await store.setItem(key, JSON.stringify(value));
    assert.equal(writes, before, '仅显示地址改变不增加文档版本');
    value.state.projects[0].title = '编辑后';
    await store.setItem(key, JSON.stringify(value));
    assert.equal(writes, before + 1);
    reopened.close();
    last = createApplicationStorage({ client });
    const restored = JSON.parse(await last.createInstance().getItem(key));
    assert.equal(restored.state.projects[0].title, '编辑后');
    assert.equal(restored.state.projects[1].title, '未打开');
    assert.equal(await (await fetch(restored.state.projects[0].nodes[0].content)).text(), 'blob:one');
    assert.equal(await (await fetch(restored.state.projects[1].nodes[0].content)).text(), 'blob:two');
  } finally {
    for (const item of [app, reopened, last]) { try { item?.close(); } catch {} }
    workspace.close(); rmSync(root, { recursive: true, force: true });
  }
});

test('图片节点推迟到视区恢复；共享媒体等最后一个画布卸载后释放，旧历史可再恢复', async () => {
  let reads = 0, sequence = 0;
  const revoked = [];
  const codec = createValueCodec({
    client: { readMedia: async () => { reads++; return new Blob(['x'], { type: 'image/png' }); } },
    createObjectURL: () => `blob:actual-${++sequence}`, revokeObjectURL: value => revoked.push(value),
  });
  const tree = ['object', [
    ['type', ['string', 'image']],
    ['metadata', ['object', [['storageKey', ['string', 'image:key']], ['content', ['blob-url', { id: 'a'.repeat(64), mime: 'image/png', size: 1 }]]]]],
  ]];
  try {
    const node = await codec.decode(tree, { deferMediaUrls: true });
    const owner1 = retainCanvasMedia(node), owner2 = retainCanvasMedia(node);
    assert.equal(await restoreCanvasMedia(node, { deferImageNodes: true }), node);
    assert.equal(reads, 0); assert.equal(hasDeferredCanvasMedia(node), true);
    const opened = await restoreCanvasMedia(node);
    assert.equal(reads, 1); assert.equal(hasDeferredCanvasMedia(opened), false);
    owner1(); await Promise.resolve();
    assert.deepEqual(revoked, []);
    owner2(); await Promise.resolve();
    assert.deepEqual(revoked, ['blob:actual-1']);
    assert.equal(hasDeferredCanvasMedia(opened), true);
    const owner3 = retainCanvasMedia(opened);
    const reloaded = await restoreCanvasMedia(opened);
    assert.equal(reads, 2); assert.equal(reloaded.metadata.content, 'blob:actual-2');
    assert.equal(sameDeferredCanvasMedia(node.metadata.content, reloaded.metadata.content), true);
    assert.deepEqual((await codec.encode(opened)).tree, tree, '已释放历史地址仍保存原媒体描述');
    owner3(); await Promise.resolve();
    assert.deepEqual(revoked, ['blob:actual-1', 'blob:actual-2']);
  } finally { codec.close(); }
});
