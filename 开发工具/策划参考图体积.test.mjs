import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { variantModules } from './产品变体生成夹具.mjs';
import { runCanvasImageTask } from '../扩展功能/画布生成/图片任务衔接.mjs';

const require = createRequire(import.meta.url);
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const dataPrefix = 'data:' + 'image/png;base64,';

test('12张高分辨率主图仅在超出预算时压缩分析副本，真实解码后比例保持，请求低于100MiB', async t => {
    const source = createCanvas(2400, 3200), context = source.getContext('2d');
    const pixels = context.createImageData(2400, 3200);
    let seed = 123456;
    for (let index = 0; index < pixels.data.length; index += 4) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        pixels.data[index] = seed & 255; pixels.data[index + 1] = seed >>> 8 & 255;
        pixels.data[index + 2] = seed >>> 16 & 255; pixels.data[index + 3] = 255;
    }
    context.putImageData(pixels, 0, 0);
    const original = dataPrefix + source.toBuffer('image/png').toString('base64');
    assert.ok(original.length * 12 > 100 * 1024 ** 2);
    const oldBitmap = globalThis.createImageBitmap, oldDocument = globalThis.document;
    let closed = 0, cleared = 0;
    globalThis.createImageBitmap = async blob => {
        const image = await loadImage(Buffer.from(await blob.arrayBuffer()));
        return { width: image.width, height: image.height, image, close() { closed++; } };
    };
    globalThis.document = { createElement: () => {
        const canvas = createCanvas(1, 1);
        return {
            get width() { return canvas.width; }, set width(value) { if (!value) cleared++; canvas.width = Math.max(1, value); },
            get height() { return canvas.height; }, set height(value) { canvas.height = Math.max(1, value); },
            getContext: () => ({ drawImage: (bitmap, ...args) => canvas.getContext('2d').drawImage(bitmap.image, ...args) }),
            toDataURL: (type, quality) => canvas.toDataURL(type, quality),
        };
    } };
    t.after(() => { globalThis.createImageBitmap = oldBitmap; globalThis.document = oldDocument; });
    const loader = variantModules({ '@/services/image-storage': { imageToDataUrl: async () => original } });
    const { readPlanningReference, planningImageLimit } = loader.load('Excel画布/策划参考图读取.ts');
    const image = { id: 'photo', storageKey: 'original-key', name: '主图.png' }, before = structuredClone(image);
    const analysis = await readPlanningReference(image, 12, new AbortController().signal);
    assert.ok(analysis.length <= planningImageLimit(12));
    const decoded = await loadImage(Buffer.from(analysis.slice(analysis.indexOf(',') + 1), 'base64'));
    assert.ok(decoded.width > 0 && decoded.height > 0);
    assert.equal(decoded.width / decoded.height, 3 / 4);
    assert.ok(Math.max(decoded.width, decoded.height) <= 2048);
    assert.deepEqual(image, before);
    assert.equal(closed, 1); assert.equal(cleared, 1);
    const protocol = loader.load('画布生成/文本生成协议.ts');
    const messages = [{ role: 'user', content: Array.from({ length: 12 }, () => ({ type: 'image_url', image_url: { url: analysis } })) }];
    const wire = protocol.prepareTextRequest({ apiFormat: 'openai', model: 'synthetic', baseUrl: 'https://example.com',
        systemPrompt: '', reasoningEffort: 'medium' }, messages);
    assert.ok(Buffer.from(wire.body, 'base64').byteLength <= 100 * 1024 ** 2);
});

test('小图片原样使用，预取消不读取，文本请求超限在保存任务身份前明确拒绝', async () => {
    let reads = 0;
    const loader = variantModules({ '@/services/image-storage': { imageToDataUrl: async () => { reads++; return dataPrefix + 'YWJj'; } } });
    const { readPlanningReference, planningImageLimit, PLANNING_IMAGE_BUDGET } = loader.load('Excel画布/策划参考图读取.ts');
    assert.equal(await readPlanningReference({ name: 'small' }, 12, new AbortController().signal), dataPrefix + 'YWJj');
    const controller = new AbortController(); controller.abort();
    await assert.rejects(readPlanningReference({ name: 'small' }, 12, controller.signal));
    assert.equal(reads, 1);
    assert.ok(planningImageLimit(100) * 100 <= PLANNING_IMAGE_BUDGET);
    const protocol = loader.load('画布生成/文本生成协议.ts');
    assert.throws(() => protocol.prepareTextRequest({ apiFormat: 'openai', model: 'synthetic', baseUrl: 'https://example.com',
        systemPrompt: '', reasoningEffort: 'medium' }, [{ role: 'user', content: 'x'.repeat(100 * 1024 ** 2) }]),
    error => error.code === 'generation_request_too_large' && /未创建或提交/.test(error.message));
    const calls = [];
    await assert.rejects(runCanvasImageTask({
        host: { submit: () => calls.push('submit'), get() {}, deliver() {}, checkpoint() {} },
        scope: { productId: 'test-product', nodeId: 'test-parameter', slotId: 'plan' },
        prepare: () => protocol.prepareTextRequest({ apiFormat: 'openai', model: 'synthetic', baseUrl: 'https://example.com',
            systemPrompt: '', reasoningEffort: 'medium' }, [{ role: 'user', content: 'x'.repeat(100 * 1024 ** 2) }]),
        bind: () => { calls.push('bind'); }, recordTask: () => { calls.push('record'); }, applyAndSave() {},
    }), error => error.code === 'generation_request_too_large');
    assert.deepEqual(calls, []);
});

test('12张各4MiB的参考图不再受旧32MiB限制且保持原图', async () => {
    const original = dataPrefix + Buffer.alloc(4 * 1024 ** 2, 65).toString('base64');
    const loader = variantModules({ '@/services/image-storage': { imageToDataUrl: async () => original } });
    const { readPlanningReference } = loader.load('Excel画布/策划参考图读取.ts');
    const image = await readPlanningReference({ name: 'original' }, 12, new AbortController().signal);
    assert.equal(image, original);
    const protocol = loader.load('画布生成/文本生成协议.ts');
    const request = protocol.prepareTextRequest({ apiFormat: 'openai', model: 'synthetic', baseUrl: 'https://example.com',
        systemPrompt: '', reasoningEffort: 'medium' }, [{ role: 'user', content: Array.from({ length: 12 },
        () => ({ type: 'image_url', image_url: { url: image } })) }]);
    const size = Buffer.from(request.body, 'base64').length;
    assert.ok(size > 64 * 1024 ** 2 && size < 100 * 1024 ** 2);
});
