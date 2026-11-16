import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformWithEsbuild } from '../.运行/3100源/画布副本/web/node_modules/vite/dist/node/index.js';

test('后台线程按核心数量并行复用，失败降级后继续处理，空闲线程可释放', async () => {
    const source = readFileSync('扩展功能/媒体交付/缩略图后台生成.ts', 'utf8');
    const { code } = await transformWithEsbuild(source, '缩略图后台生成.ts', {
        loader: 'ts', format: 'cjs', target: 'es2022', define: { 'import.meta.url': '"file:///test/entry.ts"' },
    });
    const workers = [], timers = new Map();
    class Worker {
        constructor() { workers.push(this); }
        postMessage(value) { this.input = value; }
        terminate() { this.terminated = true; }
    }
    const module = { exports: {} };
    let timerId = 0;
    new Function('module', 'exports', 'Worker', 'OffscreenCanvas', 'navigator', 'setTimeout', 'clearTimeout', code)(
        module, module.exports, Worker, class {}, { hardwareConcurrency: 8 },
        callback => { timers.set(++timerId, callback); return timerId; }, id => timers.delete(id));
    const { createImageThumbnailInBackground: make, imagePreviewParallelism } = module.exports;
    assert.equal(imagePreviewParallelism(), 4);
    let fallbacks = 0;
    const jobs = Array.from({ length: 6 }, () => make(new Blob(['original']), async () => {
        fallbacks++; return new Blob(['fallback']);
    }));
    assert.equal(workers.length, 4);
    workers[0].onmessage({ data: { error: 'decode failure' } });
    assert.equal(workers[0].terminated, true);
    for (const worker of workers.slice(1)) worker.onmessage({ data: { blob: new Blob(['preview']) } });
    const active = workers.find(worker => !worker.terminated && worker.input);
    active.onmessage({ data: { blob: new Blob(['preview']) } });
    const results = await Promise.all(jobs);
    assert.equal(results.length, 6); assert.equal(fallbacks, 1);
    for (const callback of [...timers.values()]) callback();
    assert.ok(workers.every(worker => worker.terminated));
});

test('后台解码和缩放遵守768边长，编码前关闭原位图，结束释放画布', async () => {
    const helperSource = readFileSync('.运行/3100源/画布副本/web/src/lib/image-thumbnail.ts', 'utf8');
    const helperCode = (await transformWithEsbuild(helperSource, 'image-thumbnail.ts', { loader: 'ts', format: 'cjs' })).code;
    const helper = { exports: {} };
    new Function('module', 'exports', helperCode)(helper, helper.exports);
    const source = readFileSync('扩展功能/媒体交付/缩略图生成工作线程.ts', 'utf8');
    const { code } = await transformWithEsbuild(source, '缩略图生成工作线程.ts', { loader: 'ts', format: 'cjs' });
    let closed = 0, canvas;
    const messages = [], scope = { postMessage: value => messages.push(value) };
    class OffscreenCanvas {
        constructor(width, height) { this.width = width; this.height = height; canvas = this; }
        getContext() { return { drawImage(_bitmap, _x, _y, width, height) {
            assert.deepEqual([width, height], [512, 768]);
        } }; }
        async convertToBlob() { assert.equal(closed, 1); return new Blob(['preview'], { type: 'image/webp' }); }
    }
    const module = { exports: {} };
    new Function('module', 'exports', 'require', 'globalThis', 'OffscreenCanvas', 'createImageBitmap', code)(
        module, module.exports, () => helper.exports, scope, OffscreenCanvas,
        async () => ({ width: 2000, height: 3000, close() { closed++; } }));
    await scope.onmessage({ data: { blob: new Blob(['image']), maxEdge: 768 } });
    assert.equal(messages[0].blob.type, 'image/webp'); assert.equal(closed, 1);
    assert.deepEqual([canvas.width, canvas.height], [0, 0]);
});
