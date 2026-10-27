import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { transformWithEsbuild } from '../.运行/3100源/画布副本/web/node_modules/vite/dist/node/index.js';

async function load(file, dependencies = {}) {
    const { code } = await transformWithEsbuild(readFileSync(file, 'utf8'), file, { loader: 'ts', format: 'cjs', target: 'es2022', tsconfigRaw: '{}' });
    const module = { exports: {} };
    new Function('require', 'module', 'exports', code)(id => {
        assert.ok(Object.hasOwn(dependencies, id), '未注入依赖：' + id);
        return dependencies[id];
    }, module, module.exports);
    return module.exports;
}
const layout = await load('扩展功能/画布布局/卡片自动避让.ts');
const columns = await load('扩展功能/画布布局/批量结果排布.ts', { './卡片自动避让': layout });
const box = (id, x, y, width = 340, height = 240, type = 'config', metadata = {}) => ({ id, type, position: { x, y }, width, height, metadata });
const slots = sources => sources.map(source => ({ source, width: 340, height: 240 }));
const centers = (nodes, placements) => nodes.forEach(node => {
    const result = columns.batchResultPosition(placements.get(node.id), { height: 240 });
    assert.equal(result.y + 120, node.position.y + node.height / 2);
});

test('空列共用水平位置，配置卡不齐时仍按各自实际尺寸中心对齐', () => {
    const nodes = [box('a', 0, 0), box('b', 70, 500, 420, 300)];
    const before = structuredClone(nodes), placements = columns.planBatchResultColumn(slots(nodes), nodes, 'batch');
    assert.deepEqual([...placements.values()].map(item => item.columnX), [538, 538]);
    centers(nodes, placements); assert.deepEqual(nodes, before);
});
test('只有一行被占用也整批右移，多层障碍持续避让且不移动旧节点', () => {
    const sources = [box('a', 0, 0), box('b', 0, 500)];
    const occupied = [...sources, box('old-a', 388, 500, 340, 240, 'image', { status: 'loading' }), box('old-b', 776, 0, 340, 240, 'image', { status: 'error' })];
    const before = structuredClone(occupied), placements = columns.planBatchResultColumn(slots(sources), occupied, 'batch');
    assert.deepEqual([...placements.values()].map(item => item.columnX), [1164, 1164]);
    centers(sources, placements); assert.deepEqual(occupied, before);
    for (const source of sources) {
        const result = { ...source, position: columns.batchResultPosition(placements.get(source.id), source) };
        assert.ok(occupied.every(node => !layout.nodesOverlap(result, node, 48)));
    }
});
test('连续批次另起一列，分组背景忽略但组内实际卡片仍参与避让', () => {
    const sources = [box('a', 0, 0), box('b', 0, 500)];
    const group = box('group', 0, -100, 3000, 1500, 'group');
    const first = columns.planBatchResultColumn(slots(sources), [...sources, group], 'one');
    assert.equal(first.get('a').columnX, 388);
    const results = sources.map(source => ({ ...source, id: source.id + '-result', type: 'image', position: columns.batchResultPosition(first.get(source.id), source), metadata: { groupId: 'group' } }));
    const second = columns.planBatchResultColumn(slots(sources), [...sources, group, ...results], 'two');
    assert.equal(second.get('a').columnX, 776); assert.equal(second.get('b').columnX, 776);
});
test('视频按最终最大高度预留，最终缩放保留共用列与垂直中心', () => {
    const source = box('video-config', 0, 0);
    const obstacle = box('near-bottom', 388, 310, 340, 100, 'text');
    const placements = columns.planBatchResultColumn([{ source, width: 420, height: 420 }], [source, obstacle], 'batch');
    assert.equal(placements.get(source.id).columnX, 776);
    const node = { ...source, width: 420, height: 236, position: columns.batchResultPosition(placements.get(source.id), { height: 236 }), metadata: { generationBatchId: 'batch' } };
    const position = columns.resizedResultPosition(node, { width: 236, height: 420 });
    assert.equal(position.x, 776); assert.equal(position.y + 210, source.position.y + 120);
});
test('通用自动避让不再逐卡打散已预留批次，普通新增卡片继续避让', () => {
    const existing = [box('old', 388, 0, 340, 240, 'image')];
    const batch = box('batch', 388, 0, 340, 240, 'image', { generationBatchId: 'batch', generationStartedAt: 1, status: 'loading' });
    assert.deepEqual(layout.placeNewCanvasNodes(existing, [...existing, batch]).at(-1), batch);
    const imported = { ...batch, id: 'imported', metadata: { ...batch.metadata, status: 'success' } };
    assert.ok(layout.placeNewCanvasNodes(existing, [...existing, imported]).at(-1).position.y > 0, '历史批次导入仍应普通避让');
    const normal = { ...batch, id: 'normal', metadata: {} };
    assert.ok(layout.placeNewCanvasNodes(existing, [...existing, normal]).at(-1).position.y > 0);
});
test('完成与拖动后的批次缩放保留当前位置，普通单卡仍按中心缩放', () => {
    const node = box('result', 900, 200, 340, 240, 'image');
    assert.deepEqual(columns.resizedResultPosition(node, { width: 120, height: 240 }), { x: 1010, y: 200 });
    const batch = { ...node, metadata: { generationBatchId: 'batch' } };
    assert.deepEqual(columns.resizedResultPosition(batch, { width: 120, height: 240 }), { x: 900, y: 200 });
});
test('空队列不生成位置，坏几何明确拒绝，坏旧障碍不污染结果', () => {
    assert.equal(columns.planBatchResultColumn([], [], 'batch').size, 0);
    assert.throws(() => columns.planBatchResultColumn(slots([box('bad', NaN, 0)]), [], 'batch'), /位置或尺寸无效/);
    const source = box('a', -500, -300);
    const result = columns.planBatchResultColumn(slots([source]), [box('bad', NaN, 0)], 'batch');
    assert.equal(result.get('a').columnX, -112);
});

// 直接执行装配后的真实生成回调；模型端口返回本地样本，禁止网络请求。
const project = readFileSync('.运行/3100源/画布副本/web/src/pages/canvas/project.tsx', 'utf8');
const start = project.indexOf('async (', project.indexOf('const handleGenerateNode = useCallback('));
const end = project.indexOf('\n        },\n        [completeVideoNodeTask', start) + '\n        }'.length;
assert.ok(start > 0 && end > start, '必须提取当前真实生成回调');
const { code: generateCode } = await transformWithEsbuild('export const generate = ' + project.slice(start, end), '真实生成回调.ts', { loader: 'ts', format: 'cjs', target: 'es2022', tsconfigRaw: '{}' });
const types = { Config: 'config', Image: 'image', Video: 'video', Audio: 'audio', Text: 'text' };
const sizes = { image: { width: 340, height: 240 }, config: { width: 340, height: 240 }, text: { width: 340, height: 240 }, video: { width: 420, height: 236 }, audio: { width: 340, height: 120 } };
function generatorFixture() {
    const sources = ['image', 'video', 'audio', 'text'].map((mode, i) => box(mode + '-config', 0, i * 600, 340, 240, 'config', { prompt: '验收提示词', generationMode: mode }));
    const nodesRef = { current: [...sources, box('old-result', 388, 0, 340, 240, 'image', { status: 'error' })] }, connectionsRef = { current: [] };
    let counter = 0;
    const errors = [], requests = [];
    const port = {
        CanvasNodeType: types, NODE_DEFAULT_SIZE: sizes, NODE_STATUS_LOADING: 'loading', NODE_STATUS_SUCCESS: 'success', NODE_STATUS_ERROR: 'error', NODE_STATUS_IDLE: 'idle',
        nodesRef, connectionsRef, effectiveConfig: {}, projectId: 'local-verification',
        ...columns, ...layout, nanoid: () => 'generated-' + ++counter,
        isGenerationModeEnabled: () => true, isAiConfigReady: () => true, getNodeDefinition: () => null,
        generationNodeForExecution: source => source, buildGenerationConfig: () => ({ model: 'local-sample', count: '1', size: '900x1200' }),
        hydrateNodeGenerationContext: async context => context, buildNodeGenerationContext: (_id, _nodes, _edges, prompt) => ({ prompt, referenceImages: [], referenceVideos: [], referenceAudios: [] }),
        startGenerationRequest: () => new AbortController(), finishGenerationRequest: () => {},
        setNodes: update => { nodesRef.current = layout.placeNewCanvasNodes(nodesRef.current, update(nodesRef.current)); },
        setConnections: update => { connectionsRef.current = update(connectionsRef.current); },
        setExpandedBatchNodeIds: () => {}, setRunningNodeId: () => {}, setSelectedNodeIds: () => {}, setSelectedConnectionId: () => {}, setDialogNodeId: () => {},
        getGenerationCount: value => Number(value), buildImageGenerationMetadata: () => ({}), generatedImageCardTitle: () => '验收图片', findGeneratedImageSourcePrompt: () => sources[0], numberGeneratedImages: nodes => nodes,
        requestCanvasImage: async input => { requests.push('image'); await input.applyAndSave({}, { taskId: 'local' }); },
        saveCanvasImageResult: async input => { input.onApplied(); },
        recordImageGatewayTask: () => {}, nodeSizeFromRatio: () => sizes.video, generationReferenceUrls: () => [],
        completeVideoNodeTask: async () => { requests.push('video'); },
        buildAudioGenerationMetadata: () => ({}), requestNodeAudio: async (_config, _prompt, apply) => { requests.push('audio'); apply({}); }, audioMetadata: () => ({ status: 'success' }),
        buildNodeResponseMessages: context => [{ role: 'user', content: context.prompt }], requestNodeText: async () => { requests.push('text'); return '本地验收文本'; },
        isGenerationCanceled: () => false, isVideoTaskFailed: () => false, message: { info: text => errors.push(text), error: text => errors.push(text) }, t: key => key,
    };
    const module = { exports: {} };
    new Function('port', 'module', 'exports', 'with (port) {' + generateCode + '}')(port, module, module.exports);
    return { sources, nodesRef, connectionsRef, errors, requests, generate: module.exports.generate };
}
test('真实回调四种生成模式均使用批次同列，完成状态不被通用避让打散', async () => {
    const fixture = generatorFixture();
    const slots = fixture.sources.map(source => ({ source, ...sizes[source.metadata.generationMode], ...(source.metadata.generationMode === 'video' ? { height: 420 } : {}) }));
    const placements = columns.planBatchResultColumn(slots, fixture.nodesRef.current, 'real-callback');
    await Promise.all(fixture.sources.map(source => fixture.generate(source.id, source.metadata.generationMode, source.metadata.prompt, placements.get(source.id))));
    assert.deepEqual(fixture.errors, []);
    assert.deepEqual([...fixture.requests].sort(), ['audio', 'image', 'text', 'video']);
    for (const source of fixture.sources) {
        const edge = fixture.connectionsRef.current.find(item => item.fromNodeId === source.id);
        const result = fixture.nodesRef.current.find(item => item.id === edge?.toNodeId);
        assert.ok(result, source.id + '应创建结果卡');
        assert.equal(result.position.x, placements.get(source.id).columnX);
        assert.equal(result.position.y + result.height / 2, source.position.y + source.height / 2);
        assert.equal(result.metadata.generationBatchId, 'real-callback');
    }
});
test('真实单卡入口不传批次参数时保持原有定位与重试兼容', async () => {
    const fixture = generatorFixture(), source = fixture.sources[0];
    await fixture.generate(source.id, 'image', source.metadata.prompt);
    assert.deepEqual(fixture.errors, []);
    const edge = fixture.connectionsRef.current.find(item => item.fromNodeId === source.id);
    const result = fixture.nodesRef.current.find(item => item.id === edge?.toNodeId);
    assert.equal(result.metadata.generationBatchId, undefined);
    assert.ok(result.position.y > source.position.y, '普通单卡仍由原有逐卡避让处理');
});

test('两轮真实图片回调在单行历史阻挡下整批另起列，异步完成顺序不改变列', async () => {
    const fixture = generatorFixture();
    const sources = [box('first', 0, 0, 340, 240, 'config', { prompt: '第一行验收', generationMode: 'image' }), box('second', 0, 400, 340, 240, 'config', { prompt: '第二行验收', generationMode: 'image' })];
    fixture.nodesRef.current = [...sources, box('old-result', 388, 0, 340, 240, 'image', { status: 'error', errorDetails: '原有任务，仅阻挡第一行' })];
    for (const batchId of ['first-batch', 'second-batch']) {
        const placements = columns.planBatchResultColumn(slots(sources), fixture.nodesRef.current, batchId);
        await Promise.all(sources.map(source => fixture.generate(source.id, 'image', source.metadata.prompt, placements.get(source.id))));
        const expectedX = batchId === 'first-batch' ? 776 : 1164;
        const results = fixture.nodesRef.current.filter(node => node.metadata.generationBatchId === batchId);
        assert.equal(results.length, 2);
        assert.ok(results.every(node => node.position.x === expectedX));
        for (const source of sources) {
            assert.ok(results.some(node => node.position.y + node.height / 2 === source.position.y + source.height / 2));
        }
    }
    assert.deepEqual(fixture.errors, []);
    if (process.env.GUAN_BATCH_EVIDENCE_DIR) {
        const directory = resolve(process.env.GUAN_BATCH_EVIDENCE_DIR); mkdirSync(directory, { recursive: true });
        writeFileSync(resolve(directory, '真实回调排布结果.json'), JSON.stringify({ nodes: fixture.nodesRef.current, connections: fixture.connectionsRef.current, 来源: '当前装配真实生成回调，本地模型端口样本，无网络请求' }, null, 2));
    }
});
