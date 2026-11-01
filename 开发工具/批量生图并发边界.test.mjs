import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformWithEsbuild } from '../.运行/3100源/画布副本/web/node_modules/vite/dist/node/index.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function load() {
    const file = resolve(root, '扩展功能/画布生成/批量生成操作.ts');
    const { code } = await transformWithEsbuild(readFileSync(file, 'utf8'), file, {
        loader: 'ts', format: 'cjs', target: 'es2022', tsconfigRaw: '{}',
    });
    const module = { exports: {} };
    const settleActivityGroup = async operations => {
        const settled = await Promise.allSettled(operations);
        const failure = settled.find(item => item.status === 'rejected');
        if (failure) throw failure.reason;
        return settled.map(item => item.value);
    };
    new Function('require', 'module', 'exports', code)(id => {
        const dependencies = {
            react: { useCallback: value => value, useRef: value => ({ current: value }) },
            '@/types/canvas': { CanvasNodeType: { Text: 'text', Config: 'config', Image: 'image', Video: 'video', Audio: 'audio' } },
            '@/constant/canvas': { getNodeSpec: () => ({ width: 340, height: 240 }) },
            '@/lib/canvas/canvas-node-factory': { createCanvasNode: (type, position, metadata) => ({ id: 'created', type, position, width: 340, height: 240, metadata }) },
            '@/lib/canvas/canvas-generation-helpers': { getGenerationCount: value => value || '1' },
            nanoid: { nanoid: () => 'batch-id' },
            './生成参数继承': { promptGenerationPatch: () => ({}), generationSettingsFromNode: () => ({}) },
            '../安全与批量/prompt-generation-mode': { promptGenerationMode: () => 'image' },
            '../安全与批量/settle-activity-group': { settleActivityGroup },
            '../画布布局/卡片自动避让': { placeCanvasNode: node => node },
            '../画布布局/批量结果排布': { planBatchResultColumn: nodes => new Map(nodes.map(item => [item.source.id, { batchId: 'batch', column: 0, index: 0 }])) },
            './批量保存协调': { beginBatchCanvasSave() {}, completeBatchCanvasSave() {}, finishBatchCanvasSave: () => null },
        };
        assert.ok(Object.hasOwn(dependencies, id), `未声明依赖：${id}`);
        return dependencies[id];
    }, module, module.exports);
    return module.exports;
}

function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
}

function node(id, mode = 'image') {
    return { id, type: 'config', title: id, position: { x: 0, y: 0 }, width: 340, height: 240, metadata: { generationMode: mode, status: 'idle', prompt: id } };
}

async function fixture(nodes) {
    const { useCanvasBatchGeneration } = await load();
    const gate = deferred(), calls = [], messages = [];
    let activeImage = 0, activeBounded = 0, maxImage = 0, maxBounded = 0;
    const nodesRef = { current: nodes };
    const api = useCanvasBatchGeneration({
        projectId: 'product', nodesRef, connectionsRef: { current: [] }, effectiveConfig: {},
        setNodes: () => {}, setConnections: () => {}, setSelectedNodeIds: () => {}, setSelectedConnectionId: () => {},
        handleGenerateNode: async (id, mode) => {
            calls.push({ id, mode });
            if (mode === 'image') { activeImage++; maxImage = Math.max(maxImage, activeImage); }
            else { activeBounded++; maxBounded = Math.max(maxBounded, activeBounded); }
            await gate.promise;
            if (mode === 'image') activeImage--;
            else activeBounded--;
        }, message: Object.fromEntries(['info', 'success', 'warning', 'error'].map(key => [key, value => messages.push([key, value])])),
    });
    return { api, calls, messages, gate, get maxImage() { return maxImage; }, get maxBounded() { return maxBounded; }, get activeImage() { return activeImage; }, get activeBounded() { return activeBounded; } };
}

test('超过3个生图任务全部立即并行启动，不受视频文本音频的3路限制影响', async () => {
    const f = await fixture(Array.from({ length: 7 }, (_, index) => node(`image-${index}`)));
    const running = f.api.generateAllConfigNodes();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.calls.length, 7);
    assert.equal(f.maxImage, 7);
    assert.equal(f.activeImage, 7);
    assert.match(f.messages[0][1], /生图任务立即并行执行/);
    f.gate.resolve();
    await running;
    assert.equal(f.activeImage, 0);
});

test('混合批量中生图不设上限，但视频等模式继续最多3路', async () => {
    const f = await fixture([
        ...Array.from({ length: 5 }, (_, index) => node(`image-${index}`)),
        ...Array.from({ length: 5 }, (_, index) => node(`video-${index}`, 'video')),
    ]);
    const running = f.api.generateAllConfigNodes();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.calls.filter(item => item.mode === 'image').length, 5);
    assert.equal(f.maxImage, 5);
    assert.equal(f.maxBounded, 3);
    assert.equal(f.activeBounded, 3);
    f.gate.resolve();
    await running;
    assert.equal(f.calls.length, 10);
    assert.equal(f.activeBounded, 0);
});
