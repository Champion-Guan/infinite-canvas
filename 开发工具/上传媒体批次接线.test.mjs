import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createShardedApplicationStorage } from '../扩展功能/本机存储/分片应用存储.mjs';

test('分片应用存储经请求调度器保留媒体批量写入', async () => {
  let batchCalls = 0, singleCalls = 0, documentCalls = 0;
  const media = new Map();
  const client = {
    async readDocument() { return null; },
    async readMedia(id) { return media.get(id); },
    async writeMedia() { singleCalls++; throw Error('不应退化成单媒体写入'); },
    async writeMediaBatch(items) {
      batchCalls++;
      return items.map((item, index) => {
        const id = createHash('sha256').update(`合成媒体-${batchCalls}-${index}`).digest('hex');
        media.set(id, item.blob);
        return { id, size: item.blob.size };
      });
    },
    async writeDocument(write) {
      documentCalls++;
      return {
        persisted: true,
        collection: write.collection,
        id: write.id,
        operationId: write.operationId,
        revision: write.expectedRevision + 1,
        hash: createHash('sha256').update(JSON.stringify(write.value)).digest('hex'),
      };
    },
  };
  const storage = createShardedApplicationStorage({ client, requestLimit: 0 });
  try {
    const store = storage.createInstance({ storeName: 'media_files' });
    await store.setItem('two-images', [
      new Blob(['first image'], { type: 'image/png' }),
      new Blob(['second image'], { type: 'image/png' }),
    ]);
    assert.equal(batchCalls, 1);
    assert.equal(singleCalls, 0);
    assert.ok(documentCalls > 0, '媒体批次得到回执后仍需提交应用记录');
    assert.equal((await store.getItem('two-images')).length, 2);
    assert.deepEqual(storage.getStatus(), { state: 'saved', pending: 0, reads: 0, errors: [], failures: [] });
  } finally {
    storage.close();
  }
});
