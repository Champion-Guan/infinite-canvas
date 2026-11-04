import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import ts from '../.运行/3100源/画布副本/web/node_modules/typescript/lib/typescript.js';
import { runHistoryRetries } from '../扩展功能/生成历史/历史失败重试.js';
import { variantModules } from './产品变体生成夹具.mjs';

function compile(source, dependencies = {}, scope = {}) {
    const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    const module = { exports: {} };
    new Function('require', 'module', 'exports', ...Object.keys(scope), code)(id => {
        assert.ok(Object.hasOwn(dependencies, id), '未声明依赖：' + id);
        return dependencies[id];
    }, module, module.exports, ...Object.values(scope));
    return module.exports;
}
const guards = compile(readFileSync('扩展功能/画布生成/图片重试门控.ts', 'utf8'));
const { createCanvasGenerationRegistry } = compile(readFileSync('扩展功能/画布生成/并发生成状态.ts', 'utf8'), { react: {} });
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
const tick = () => new Promise(resolve => setImmediate(resolve));
const imageNode = (id, slots = ['one']) => ({ id, type: 'image', width: 340, height: 240, metadata: {
    status: 'error', prompt: '本地测试', generationType: 'generation', images: slots.map(id => ({ id, status: 'error' })),
} });

test('历史7个失败图片立即进入onRetry，单个失败不阻止其他6个并排空全部任务', async () => {
    const nodes = Array.from({ length: 7 }, (_, i) => imageNode(String(i)));
    const gates = nodes.map(deferred), calls = [], errors = [];
    let ended = false;
    const work = runHistoryRetries(nodes.map(node => ({ node, imageId: 'one' })), {
        getNode: id => nodes.find(node => node.id === id), isActive: () => true,
        onRetry: (node, imageId) => { calls.push([node.id, imageId]); return gates[Number(node.id)].promise; },
        onError: error => errors.push(error.message),
    }).then(() => { ended = true; });
    assert.equal(calls.length, 7, '没有任何任务完成时7个都必须已经启动');
    gates[0].reject(Error('单项失败')); await tick(); assert.equal(ended, false);
    gates.slice(1).forEach(gate => gate.resolve()); await work;
    assert.deepEqual(errors, ['单项失败']); assert.equal(ended, true);
});

test('历史先按node/image去重，同节点不同槽位均可并行，运行成功缺失目标跳过', async () => {
    const node = imageNode('same', ['one', 'two', 'busy', 'success']);
    node.metadata.images[2].status = 'loading'; node.metadata.images[3].status = 'success'; node.metadata.status = 'loading';
    const calls = [], gate = deferred();
    const targets = ['one', 'one', 'two', 'two', 'busy', 'success', 'missing'].map(imageId => ({ node, imageId }));
    const work = runHistoryRetries(targets, { getNode: id => id === node.id ? node : undefined, isActive: () => true,
        onRetry: (node, id) => { calls.push(id); node.metadata.images.find(image => image.id === id).status = 'loading'; return gate.promise; }, onError: assert.fail });
    assert.deepEqual(calls, ['one', 'two']); gate.resolve(); await work;
});

test('同步抛错不会截断其他历史图片；取消后未启动目标不发起；失效缓存只重试匹配的文件', async () => {
    const nodes = ['a', 'b', 'c'].map(id => imageNode(id)); const calls = [], errors = [];
    await runHistoryRetries(nodes.map(node => ({ node, imageId: 'one' })), { getNode: id => nodes.find(n => n.id === id), isActive: () => true,
        onRetry: node => { calls.push(node.id); if (node.id === 'a') throw Error('同步失败'); }, onError: error => errors.push(error.message) });
    assert.deepEqual(calls, ['a', 'b', 'c']); assert.deepEqual(errors, ['同步失败']);
    let active = true; calls.length = 0;
    await runHistoryRetries(nodes.map(node => ({ node, imageId: 'one' })), { getNode: id => nodes.find(n => n.id === id), isActive: () => active,
        onRetry: node => { calls.push(node.id); active = false; }, onError: assert.fail });
    assert.deepEqual(calls, ['a']);
    nodes[0].metadata.images[0] = { id: 'one', status: 'success', storageKey: 'image:missing' }; calls.length = 0;
    await runHistoryRetries([{ node: nodes[0], imageId: 'one', unavailableStorageKey: 'image:missing' }], {
        getNode: () => nodes[0], isActive: () => true, onRetry: node => calls.push(node.id), onError: assert.fail });
    assert.deepEqual(calls, ['a']);
});

test('历史视频保留逐项启动，不随图片批量取消限制而放开', async () => {
    const nodes = [0, 1, 2].map(id => ({ id: String(id), type: 'video', metadata: { status: 'error' } }));
    const gates = nodes.map(deferred), calls = [];
    const work = runHistoryRetries(nodes.map(node => ({ node })), { getNode: id => nodes.find(n => n.id === id), isActive: () => true,
        onRetry: node => { calls.push(node.id); return gates[Number(node.id)].promise; }, onError: assert.fail });
    assert.deepEqual(calls, ['0']); gates[0].resolve(); await tick(); assert.deepEqual(calls, ['0', '1']);
    gates[1].resolve(); await tick(); gates[2].resolve(); await work;
});

async function callbackFixture() {
    const file = '.运行/3100源/画布副本/web/src/pages/canvas/project.tsx';
    const ast = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let callback;
    const visit = item => { if (ts.isVariableDeclaration(item) && item.name.getText(ast) === 'handleRetryNode') callback = item.initializer.arguments[0].getText(ast); ts.forEachChild(item, visit); };
    visit(ast); assert.ok(callback);
    const registry = createCanvasGenerationRegistry(), nodesRef = { current: [imageNode('result', ['one', 'two'])] };
    const tasks = [], errors = [], retryingNodeIdsRef = { current: new Set() };
    const scope = { ...guards, ...registry, ...variantModules().load('画布生成/产品变体生成.ts'), nodesRef, retryingNodeIdsRef, generationRequestsRef: { current: registry.requests }, connectionsRef: { current: [] },
        CanvasNodeType: { Image: 'image', Video: 'video', Audio: 'audio', Text: 'text' }, NODE_STATUS_LOADING: 'loading', NODE_STATUS_SUCCESS: 'success', NODE_STATUS_ERROR: 'error',
        hasResumableVideoTask: () => false, findRetrySourceNode: () => undefined, effectiveConfig: {},
        resolveGenerationChannelMetadata: () => ({ channel: '本地mock' }), isAiConfigReady: () => true,
        openConfigDialog: () => assert.fail('不应修改配置'),
        buildNodeGenerationContext: () => ({ prompt: '本地测试' }), readProtectedRetryPrompt: text => text,
        resolveMetadataReferences: async () => [],
        setNodes: update => { nodesRef.current = update(nodesRef.current); },
        requestCanvasImage: options => { const gate = deferred(); tasks.push({ options, ...gate }); return gate.promise; },
        projectId: 'mock', isBatchCanvasSaveActive: () => false,
        isGenerationCanceled: error => error.name === 'AbortError', isVideoTaskFailed: () => false,
        message: { error: text => errors.push(text), warning: text => errors.push(text) }, t: text => text,
    };
    return { run: compile('module.exports = ' + callback, {}, scope), nodesRef, registry, tasks, errors, retryingNodeIdsRef };
}

test('真实handleRetryNode同节点两槽同时进入生图；同槽/整卡去重，完成一槽不提前清除其他运行', async () => {
    const f = await callbackFixture(), node = f.nodesRef.current[0];
    const first = f.run(node, 'one'), second = f.run(node, 'two'); await tick();
    assert.deepEqual(f.tasks.map(task => task.options.scope.slotId), ['one', 'two']);
    assert.equal(f.registry.requests.size, 2);
    assert.equal(f.tasks[0].options.signal.aborted, false);
    await f.run(node, 'one'); await f.run(node); assert.equal(f.tasks.length, 2);
    f.tasks[0].reject(Error('一槽失败')); await first;
    assert.equal(f.registry.requests.size, 1); assert.equal(f.nodesRef.current[0].metadata.status, 'loading');
    f.tasks[1].reject(Error('二槽失败')); await second;
    assert.equal(f.nodesRef.current[0].metadata.status, 'error'); assert.equal(f.registry.requests.size, 0);
    assert.equal(f.retryingNodeIdsRef.current.size, 0);
});

test('整卡重试独占全部槽位，取消同节点全部请求且不取消其他节点，迟到finally不删新请求', async () => {
    const f = await callbackFixture(), node = f.nodesRef.current[0];
    const whole = f.run(node); await tick(); await f.run(node, 'two'); assert.equal(f.tasks.length, 1);
    f.tasks[0].reject(Error('结束')); await whole;
    const r = createCanvasGenerationRegistry();
    const first = r.startGenerationRequest('result', 'source', 'result', new AbortController(), guards.imageRetryKey('result', 'one'));
    const second = r.startGenerationRequest('result', 'source', 'result', new AbortController(), guards.imageRetryKey('result', 'two'));
    const other = r.startGenerationRequest('other', 'other');
    assert.deepEqual([...r.stopGenerationRequests('result')].sort(), ['result', 'source']);
    assert.ok(first.signal.aborted && second.signal.aborted); assert.equal(other.signal.aborted, false);
    const next = r.startGenerationRequest('result', 'source', 'result', new AbortController(), guards.imageRetryKey('result', 'one'));
    r.finishGenerationRequest('result', first, guards.imageRetryKey('result', 'one'));
    assert.equal(r.requests.get(guards.imageRetryKey('result', 'one')).controller, next);
});
