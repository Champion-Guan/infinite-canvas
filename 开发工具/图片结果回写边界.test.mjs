import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformWithEsbuild } from '../.运行/3100源/画布副本/web/node_modules/vite/dist/node/index.js';
import { runCanvasImageTask } from '../扩展功能/画布生成/图片任务衔接.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const samples = JSON.parse(readFileSync(resolve(root, '开发工具/图片回写原行为样例.json'), 'utf8')).样例;
async function load(name, dependencies = {}) {
    const file = resolve(root, name);
    const { code } = await transformWithEsbuild(readFileSync(file, 'utf8'), file, { loader: 'ts', format: 'cjs', target: 'es2022', tsconfigRaw: '{}' });
    const module = { exports: {} };
    new Function('require', 'module', 'exports', code)(id => {
        assert.ok(Object.hasOwn(dependencies, id), '未声明依赖：' + id);
        return dependencies[id];
    }, module, module.exports);
    return module.exports;
}
const types = { CanvasNodeType: { Image: 'image', Text: 'text', Config: 'config', Video: 'video', Audio: 'audio', Group: 'group' } };
const size = await load('.运行/3100源/画布副本/web/src/lib/canvas/canvas-node-size.ts');
const constants = await load('.运行/3100源/画布副本/web/src/constant/canvas.ts', {
    '@/i18n': { default: { t: key => key } }, '@/types/canvas': types,
    '@/lib/canvas/node-registry': { getNodeSpec: () => { throw Error('本检查不使用插件节点'); } },
});
const factory = await load('.运行/3100源/画布副本/web/src/lib/canvas/canvas-node-factory.ts', {
    '@/constant/canvas': constants, '@/lib/canvas/canvas-node-size': size, '@/types/canvas': types,
});
const layout = await load('扩展功能/画布布局/卡片自动避让.ts');
const columns = await load('扩展功能/画布布局/批量结果排布.ts', { './卡片自动避让': layout });
const results = await load('扩展功能/媒体交付/图片结果回写.ts', {
    '../画布布局/批量结果排布': columns,
    '@/constant/canvas': constants, '@/lib/canvas/canvas-node-size': size,
    '@/lib/canvas/canvas-node-factory': factory, '@/types/canvas': types,
});
const normalize = value => JSON.parse(JSON.stringify(value));
for (const sample of samples) test('与拆分前原回调一致：' + sample.名称, () => {
    const node = structuredClone(sample.原节点), before = structuredClone(node);
    const input = { slotId: sample.槽位, uploaded: sample.上传结果, receipt: sample.回执, requestedSize: sample.图片.deliverySize, upstreamSize: sample.图片.upstreamSize };
    const actual = sample.模式 === 'batch' ? results.applyBatchImageResult(node, input)
        : results.applyRetriedImageResult(node, input, { imageId: sample.重试槽位, prompt: sample.提示词, generationMetadata: sample.生成快照 });
    assert.deepEqual(normalize(actual), sample.原回调结果);
    assert.deepEqual(node, before, '原节点不能被就地修改');
    assert.equal(actual.title, node.title, '稳定编号不能改变');
    assert.equal(actual.metadata.images.find(item => item.id === sample.槽位).name, node.metadata.images.find(item => item.id === sample.槽位).name);
});

async function fixture(options = {}) {
    const sample = structuredClone(samples[0]), order = [];
    let uploads = 0, saves = 0, applied = 0;
    const port = {
        projectId: 'product', nodesRef: { current: [sample.原节点, { id: 'config', type: 'config', metadata: { status: 'loading' } }] },
        restoredProjectIdRef: { current: 'product' }, surfaceRef: { current: { projectId: 'product', mounted: true, active: true } },
        setNodes: update => { order.push('apply'); port.nodesRef.current = update(port.nodesRef.current); },
    };
    const { useCanvasImageResults } = await load('扩展功能/媒体交付/图片结果保存操作.ts', {
        react: { useCallback: callback => callback }, './图片结果回写': results,
        '@/services/image-storage': { uploadImage: async (_input, { signal }) => {
            uploads++; order.push('upload'); assert.equal(signal, request.signal);
            if (options.uploadGate) await options.uploadGate;
            if (options.uploadError) throw Error('图片落盘失败');
            return sample.上传结果;
        } },
        '../产品/产品操作': { saveProductCanvas: async id => {
            saves++; order.push('save'); assert.equal(id, 'product');
            if (options.saveError) throw Error('画布保存失败');
        } },
    });
    const controller = new AbortController();
    const request = { mode: 'batch', nodeId: 'result', slotId: 'one', image: sample.图片, receipt: sample.回执,
        signal: controller.signal, sourceConfigId: 'config', onApplied: () => { applied++; order.push('applied'); } };
    return { port, request, controller, order, run: useCanvasImageResults(port), counts: () => ({ uploads, saves, applied }) };
}

test('图片先落盘、再同步回写结果及源配置、最后保存原产品', async () => {
    const api = await fixture(); await api.run(api.request);
    assert.deepEqual(api.order, ['upload', 'apply', 'applied', 'save']);
    assert.deepEqual(api.counts(), { uploads: 1, saves: 1, applied: 1 });
    const [image, config] = api.port.nodesRef.current;
    assert.equal(config.metadata.status, 'success');
    assert.equal(image.metadata.originalStorageKey, 'image:原图');
    assert.equal(image.metadata.deliveryStorageKey, 'image:交付');
    assert.deepEqual(image.metadata.gatewayGenerationReceipts.filter(item => item.taskId === 'task'), [api.request.receipt]);
});

test('结果卡、槽位缺失或任务已更换时，落盘前停止且不保存', async () => {
    for (const change of ['deleted', 'slot', 'task']) {
        const api = await fixture();
        if (change === 'deleted') api.port.nodesRef.current = [];
        if (change === 'slot') api.port.nodesRef.current[0].metadata.images = [];
        if (change === 'task') api.port.nodesRef.current[0].metadata.gatewayGenerationTasks = [{ slotId: 'one', taskId: 'new-task' }];
        await assert.rejects(api.run(api.request), /删除|新任务/);
        assert.deepEqual(api.counts(), { uploads: 0, saves: 0, applied: 0 });
    }
});

test('落盘期间关闭画布、删除卡片或槽位、改变产品或替换任务时不应用旧响应', async () => {
    for (const change of ['unmount', 'deleted', 'slot', 'product', 'restore', 'task']) {
        let release; const api = await fixture({ uploadGate: new Promise(resolve => { release = resolve; }) });
        const pending = api.run(api.request);
        if (change === 'unmount') api.port.surfaceRef.current.mounted = false;
        if (change === 'deleted') api.port.nodesRef.current = [];
        if (change === 'slot') api.port.nodesRef.current[0].metadata.images = [];
        if (change === 'product') api.port.surfaceRef.current.projectId = 'other';
        if (change === 'restore') api.port.restoredProjectIdRef.current = 'other';
        if (change === 'task') api.port.nodesRef.current[0].metadata.gatewayGenerationTasks = [{ slotId: 'one', taskId: 'new-task' }];
        release(); await assert.rejects(pending, /关闭|切换|删除|新任务/);
        assert.deepEqual(api.counts(), { uploads: 1, saves: 0, applied: 0 }, change);
        assert.deepEqual(api.order, ['upload']);
    }
});

test('产品页隐藏但原画布仍挂载时允许后台完成并保存到原产品', async () => {
    const api = await fixture(); api.port.surfaceRef.current.active = false;
    await api.run(api.request); assert.deepEqual(api.counts(), { uploads: 1, saves: 1, applied: 1 });
});

test('取消发生在落盘前或期间时，不回写和保存已取消响应', async () => {
    const early = await fixture(); early.controller.abort();
    await assert.rejects(early.run(early.request), error => error.name === 'AbortError');
    assert.equal(early.counts().uploads, 0);
    let release; const late = await fixture({ uploadGate: new Promise(resolve => { release = resolve; }) });
    const pending = late.run(late.request); late.controller.abort(); release();
    await assert.rejects(pending, error => error.name === 'AbortError');
    assert.deepEqual(late.counts(), { uploads: 1, saves: 0, applied: 0 });
});

test('落盘失败不改变节点；保存失败向任务协议抛出，已回写回执保留', async () => {
    const badUpload = await fixture({ uploadError: true }), before = structuredClone(badUpload.port.nodesRef.current);
    await assert.rejects(badUpload.run(badUpload.request), /落盘失败/);
    assert.deepEqual(badUpload.port.nodesRef.current, before);
    assert.deepEqual(badUpload.counts(), { uploads: 1, saves: 0, applied: 0 });
    const badSave = await fixture({ saveError: true });
    await assert.rejects(badSave.run(badSave.request), /保存失败/);
    assert.deepEqual(badSave.counts(), { uploads: 1, saves: 1, applied: 1 });
    assert.equal(badSave.port.nodesRef.current[0].metadata.gatewayGenerationReceipts.at(-1).taskId, 'task');
});

test('旧单图没有批次槽位时仍可整卡重试；尺寸回落到原请求快照', async () => {
    const api = await fixture(); delete api.port.nodesRef.current[0].metadata.images;
    await api.run({ ...api.request, mode: 'retry', image: { dataUrl: api.request.image.dataUrl }, requestedSize: '900x1200',
        prompt: '用户提示词', generationMetadata: { size: '900x1200', quality: 'high' } });
    const node = api.port.nodesRef.current[0];
    assert.equal(node.metadata.requestedSize, '900x1200'); assert.equal(node.metadata.quality, 'high');
    assert.equal(node.metadata.images, undefined); assert.equal(node.metadata.primaryImageId, 'one');
    assert.deepEqual(node.position, { x: 20, y: 40 });
    assert.equal(api.counts().saves, 1); assert.equal(api.counts().applied, 0);
});

test('图片保存与原任务确认链联通，保存失败不确认也不重新提交上游', async () => {
    for (const saveError of [false, true]) {
        const api = await fixture({ saveError }), taskId = crypto.randomUUID();
        const scope = { productId: 'product', nodeId: 'result', slotId: 'one' };
        let checkpoints = 0, confirmed = 0;
        const job = { id: taskId, ...scope, state: 'succeeded', applied: false, result: { id: 'h'.repeat(64) } };
        const host = {
            get: async () => job,
            submit: async () => assert.fail('已有成功响应不能重新提交模型'),
            checkpoint: async () => { assert.equal(api.counts().saves, 1); checkpoints++; return {}; },
            deliver: async (_task, { applyAndSave }) => { await applyAndSave(job); confirmed++; },
        };
        const pending = runCanvasImageTask({ host, scope,
            previous: { taskId, slotId: 'one', binding: 'provider:' + 'a'.repeat(64), requestHash: 'b'.repeat(64) },
            prepare: () => assert.fail('已有成功响应不能准备新请求'), bind: () => assert.fail('已有成功响应不能重绑'),
            recordTask: () => assert.fail('已有任务不应重建记录'), signal: api.request.signal,
            applyAndSave: (_saved, receipt) => api.run({ ...api.request, receipt }),
        });
        if (saveError) { await assert.rejects(pending, /保存失败/); assert.equal(checkpoints, 0); assert.equal(confirmed, 0); }
        else { await pending; assert.equal(checkpoints, 1); assert.equal(confirmed, 1); }
    }
});

test('整批图片完成与空主图重试保留批次左边线及垂直中心', () => {
    const sample = structuredClone(samples[0]);
    const node = { ...sample.原节点, metadata: { ...sample.原节点.metadata, generationBatchId: 'aligned-batch', primaryImageId: undefined, content: undefined } };
    const result = { slotId: sample.槽位, uploaded: { ...sample.上传结果, width: 900, height: 1200 }, receipt: sample.回执 };
    for (const actual of [results.applyBatchImageResult(node, result), results.applyRetriedImageResult(node, result, { imageId: sample.槽位, prompt: '重试', generationMetadata: {} })]) {
        assert.equal(actual.position.x, node.position.x);
        assert.equal(actual.position.y + actual.height / 2, node.position.y + node.height / 2);
        assert.equal(actual.metadata.generationBatchId, 'aligned-batch');
    }
});
