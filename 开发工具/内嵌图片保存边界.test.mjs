import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createValueCodec } from '../扩展功能/本机存储/应用值编码.mjs';
import { variantModules } from './产品变体生成夹具.mjs';

test('带稳定文件键的Base64图存入媒体，编辑后不重复编码图片；独立文本原样保留', async () => {
    const bytes = Buffer.alloc(4 * 1024 ** 2, 65), id = createHash('sha256').update(bytes).digest('hex');
    const url = 'data:' + 'image/png;base64,' + bytes.toString('base64');
    let writes = 0;
    const codec = createValueCodec({ client: {
        async writeMedia(blob) { writes++; assert.deepEqual(Buffer.from(await blob.arrayBuffer()), bytes); return { id, size: bytes.length }; },
        async readMedia() { return new Blob([bytes], { type: 'image/png' }); },
    }, createObjectURL: () => 'blob:restored-exact-image', revokeObjectURL() {} });
    try {
        const image = { storageKey: 'stable', url, bytes: bytes.length, mimeType: 'image/png' };
        const saved = await codec.encode({ images: [image], title: 'before' });
        assert.ok(JSON.stringify(saved.tree).length < 500);
        assert.deepEqual(saved.mediaIds, [id]);
        const restored = await codec.decode(saved.tree);
        assert.equal(restored.images[0].url, 'blob:restored-exact-image');
        await codec.encode({ images: [image], title: 'after' });
        assert.equal(writes, 1);
        assert.equal((await codec.encode(url)).tree[1], url);
    } finally { codec.close(); }
});

test('策划来源快照保留稳定文件键，不把Base64原图重复塞入文本；无文件键仍保留原引用', () => {
    const { productPlanningParameters } = variantModules().load('Excel画布/商品提示词规则.ts');
    const url = 'data:' + 'image/png;base64,' + 'YQ=='.repeat(1000);
    const value = JSON.parse(productPlanningParameters({ productMainImages: [
        { id: 'one', storageKey: 'stable', url }, { id: 'two', url },
    ] }));
    assert.equal(value.productMainImages[0].url, undefined);
    assert.equal(value.productMainImages[0].storageKey, 'stable');
    assert.equal(value.productMainImages[1].url, url);
});
