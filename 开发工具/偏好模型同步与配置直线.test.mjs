import test from 'node:test';
import assert from 'node:assert/strict';
import { variantModules } from './产品变体生成夹具.mjs';

const node = (id, type = 'config', mode = 'image', model = 'old') => ({ id, type, title: id,
    position: { x: 0, y: 0 }, width: 440, height: 540,
    metadata: { generationMode: mode, model, size: '800x800', count: 3, quality: 'high' } });
const defaults = { imageModel: 'old-image', videoModel: 'old-video', textModel: 'old-text', audioModel: 'old-audio' };

test('只同步发生变更的默认模型；四种配置分别对应自己的类型，普通卡片与其他参数保留', () => {
    const rules = variantModules().load('画布生成/偏好模型规则.ts');
    const before = ['image', 'video', 'text', 'audio'].map(mode => node(mode, 'config', mode));
    before.push(node('prompt', 'text'), node('result', 'image'));
    const original = structuredClone(before);
    const changes = rules.changedPreferredModels(defaults, { ...defaults, imageModel: 'channel::new-image' });
    assert.deepEqual(changes, { image: 'channel::new-image' });
    const next = rules.applyPreferredModels(before, changes);
    assert.equal(next[0].metadata.model, 'channel::new-image');
    assert.deepEqual(next[0].metadata, { ...original[0].metadata, model: 'channel::new-image' });
    assert.deepEqual(next[0].position, original[0].position);
    for (let index = 1; index < before.length; index++) assert.equal(next[index], before[index]);
    assert.deepEqual(before, original);
    assert.equal(rules.applyPreferredModels(next, changes), next, '重复同步不新增保存');
    assert.deepEqual(rules.changedPreferredModels(defaults, defaults), {});
    assert.deepEqual(rules.changedPreferredModels(defaults, { ...defaults, imageModel: '' }), {});
    const all = rules.applyPreferredModels(before, { image: 'i', video: 'v', text: 't', audio: 'a' });
    assert.deepEqual(all.slice(0, 4).map(item => item.metadata.model), ['i', 'v', 't', 'a']);
});

test('当前及缓存画布使用内存中的最新节点，未打开画布更新存档，回收站和生成结果不改动', () => {
    const rules = variantModules().load('画布生成/偏好模型规则.ts'), coordinator = rules.createPreferredModelCoordinator();
    const projects = ['active', 'cached', 'closed'].map(id => ({ id, updatedAt: 'old', nodes: [node(id)], deletedNodeBatches: [{ nodes: [node('deleted')] }] }));
    const active = { nodes: [node('active'), { ...node('unsaved-text', 'text'), title: '尚未保存的编辑' }] }, cached = { nodes: [node('cached')] };
    const cleanupActive = coordinator.register('active', { getNodes: () => active.nodes, setNodes: nodes => { active.nodes = nodes; } });
    const cleanupCached = coordinator.register('cached', { getNodes: () => cached.nodes, setNodes: nodes => { cached.nodes = nodes; } });
    const next = coordinator.apply(projects, { image: 'new' });
    assert.equal(next[0], projects[0]); assert.equal(next[1], projects[1]);
    assert.equal(active.nodes[0].metadata.model, 'new'); assert.equal(active.nodes[1].title, '尚未保存的编辑');
    assert.equal(cached.nodes[0].metadata.model, 'new'); assert.equal(next[2].nodes[0].metadata.model, 'new');
    assert.equal(next[2].deletedNodeBatches, projects[2].deletedNodeBatches);
    assert.equal(coordinator.apply(next, { image: 'new' }), next);
    cleanupActive(); cleanupCached();
    const closed = coordinator.apply(next, { image: 'last' });
    assert.ok(closed.every(project => project.nodes[0].metadata.model === 'last'));
});

test('单卡可以独立选模型；下次偏好变更更新卡片，但不改写已经提交的任务快照', () => {
    const rules = variantModules().load('画布生成/偏好模型规则.ts');
    const active = node('active'); active.metadata.status = 'loading';
    active.metadata.gatewayGenerationTasks = [{ taskId: 'running', requestHash: 'original' }];
    const requestSnapshot = structuredClone(active);
    const next = rules.applyPreferredModels([active], { image: 'new' });
    assert.equal(next[0].metadata.model, 'new'); assert.equal(requestSnapshot.metadata.model, 'old');
    assert.equal(next[0].metadata.status, 'loading');
    assert.equal(next[0].metadata.gatewayGenerationTasks, active.metadata.gatewayGenerationTasks);
    next[0] = { ...next[0], metadata: { ...next[0].metadata, model: 'card-override' } };
    assert.equal(rules.applyPreferredModels(next, {}), next);
    assert.equal(rules.applyPreferredModels(next, { image: 'newer-default' })[0].metadata.model, 'newer-default');
});

test('补齐配置以提示词垂直中心定位，遇到障碍只向右避让，保持连接点同高', () => {
    const layout = variantModules().load('画布布局/生成配置水平排布.ts');
    const source = node('prompt', 'text'), config = { ...node('new'), width: 340, height: 240 };
    const direct = layout.placeAlignedGenerationConfig(source, config, [source]);
    assert.equal(direct.position.y + direct.height / 2, source.position.y + source.height / 2);
    const blocker = { ...config, id: 'blocker', position: { ...direct.position } };
    const placed = layout.placeAlignedGenerationConfig(source, config, [source, blocker]);
    assert.equal(placed.position.y, direct.position.y);
    assert.ok(placed.position.x >= blocker.position.x + blocker.width + 48);
    assert.deepEqual(source.position, { x: 0, y: 0 });
    assert.deepEqual(blocker.position, direct.position);
});

test('一键补齐商品提示词配置使用用户偏好，标题和模型正确，不提交生图且重复点击不重复建卡', () => {
    const nodesRef = { current: [node('prompt', 'guan:product-prompt')] }, connectionsRef = { current: [] };
    nodesRef.current[0].metadata.productImagePrompt = { delivery: { width: 800, height: 800 }, name: '尺寸标注' };
    const loader = variantModules({
        '@/lib/canvas/canvas-node-factory': { createCanvasNode: (type, position, metadata) => ({ ...node('config', type), position, width: 340, height: 240, metadata }) },
    });
    let requests = 0;
    const api = loader.load('画布生成/批量生成操作.ts').useCanvasBatchGeneration({ projectId: 'test', nodesRef, connectionsRef,
        effectiveConfig: { imageModel: 'preferred-image' }, setNodes: nodes => { nodesRef.current = nodes; },
        setConnections: edges => { connectionsRef.current = edges; }, setSelectedNodeIds() {}, setSelectedConnectionId() {},
        handleGenerateNode: () => { requests++; }, message: { success() {}, info() {} } });
    api.addGenerationConfigsForPromptNodes();
    const config = nodesRef.current[1], source = nodesRef.current[0];
    assert.equal(config.metadata.model, 'preferred-image');
    assert.equal(config.position.y + config.height / 2, source.position.y + source.height / 2);
    assert.equal(config.title, 'prompt · 生图');
    api.addGenerationConfigsForPromptNodes();
    assert.equal(nodesRef.current.length, 2); assert.equal(connectionsRef.current.length, 1); assert.equal(requests, 0);
});
