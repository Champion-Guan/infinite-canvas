import test from 'node:test';
import assert from 'node:assert/strict';
import { canvasSemanticSnapshot, validRefreshTimes } from './原画布存储语义比较.mjs';

function canvas(url) { return { state: { projects: [{ id: 'test', title: '临时产品', updatedAt: '2026-10-18T00:00:00Z', nodes: [{ id: 'n', type: 'image', x: 1, metadata: { content: url, text: '尺寸', storageKey: 'image:test' } }] }], deletedProjects: [] }, version: 0 }; }
test('临时URL虽不同仍严格比对真实媒体哈希、类型与字节，原输入不修改', async () => {
  const a = URL.createObjectURL(new Blob(['image-a'], { type: 'image/png' })), b = URL.createObjectURL(new Blob(['image-a'], { type: 'image/png' })), c = URL.createObjectURL(new Blob(['image-b'], { type: 'image/png' }));
  try {
    const original = canvas(a), next = canvas(b); next.state.projects[0].updatedAt = '2026-10-18T00:01:00Z'; next.state.projects[0].nodes[0].metadata.images = [];
    const before = await canvasSemanticSnapshot(original), after = await canvasSemanticSnapshot(next);
    assert.deepEqual(before.value, after.value); assert.equal(validRefreshTimes(before.projectTimes, after.projectTimes), true); assert.equal(before.media.length, 1);
    assert.equal(original.state.projects[0].nodes[0].metadata.content, a); assert.equal(Object.hasOwn(original.state.projects[0].nodes[0].metadata, 'images'), false);
    assert.notDeepEqual(before.value, (await canvasSemanticSnapshot(canvas(c))).value);
    const changedMime = URL.createObjectURL(new Blob(['image-a'], { type: 'image/jpeg' }));
    try { assert.notDeepEqual(before.value, (await canvasSemanticSnapshot(canvas(changedMime))).value); } finally { URL.revokeObjectURL(changedMime); }
  } finally { for (const url of [a, b, c]) URL.revokeObjectURL(url); }
});
test('卡片标题、文字、位置、媒体引用或非空图片列表变化均不被豁免', async () => {
  const original = canvas('https://invalid.example/image.png'), before = (await canvasSemanticSnapshot(original)).value;
  for (const mutate of [value => { value.state.projects[0].title = '改变'; }, value => { value.state.projects[0].nodes[0].x = 2; },
    value => { value.state.projects[0].nodes[0].metadata.text = '卖点'; }, value => { value.state.projects[0].nodes[0].metadata.storageKey = 'image:other'; },
    value => { value.state.projects[0].nodes[0].metadata.images = ['改变']; }]) {
    const changed = structuredClone(original); mutate(changed); assert.notDeepEqual(before, (await canvasSemanticSnapshot(changed)).value);
  }
});
test('损坏临时媒体、无效时间与更新时间倒退必须失败', async () => {
  await assert.rejects(canvasSemanticSnapshot(canvas('blob:nodedata:missing')));
  const invalid = canvas(''); invalid.state.projects[0].updatedAt = '无效'; await assert.rejects(canvasSemanticSnapshot(invalid), /时间无效/);
  assert.equal(validRefreshTimes({ p: '2026-10-18T00:01:00Z' }, { p: '2026-10-18T00:00:00Z' }), false);
  assert.equal(validRefreshTimes({ p: '2026-10-18T00:00:00Z' }, {}), false);
});
