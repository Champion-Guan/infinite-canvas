import test from 'node:test';
import assert from 'node:assert/strict';
import { variantModules } from './产品变体生成夹具.mjs';
import { numberGeneratedImages, generatedImageName } from '../扩展功能/媒体交付/生成图片命名.js';
import { historyDownloadFiles } from '../扩展功能/生成历史/历史下载文件.js';
import { createValueCodec } from '../扩展功能/本机存储/应用值编码.mjs';

const naming = variantModules().load('媒体交付/生成图片来源.ts');
const definitions = [
    ['main', '品类主视觉'], ['carousel', '整体尺寸'], ['carousel', '分层分类'], ['carousel', '瓶罐取放'],
    ['carousel', '脚轮细节'], ['carousel', '托盘围边'], ['carousel', '圆润转角'], ['carousel', '塑料表面'],
    ['carousel', '正面结构'], ['carousel', '侧向观察'], ['carousel', '浴室适配'],
    ['rich', '浴室方案'], ['rich', '分类示例'], ['rich', '占地规划'], ['rich', '移动示意'], ['rich', '结构解析'], ['rich', '销售清单'],
];
const expectedNames = definitions.map(([kind, angle]) => kind === 'main' ? '主图' : `${kind === 'carousel' ? '轮播图' : '富内容'} · ${angle}`);
function fixture(platform = 'Wildberries', variants = ['']) {
    const nodes = [{ id: 'parameter', type: 'guan:prompt-variables', metadata: { productPlatform: platform } }], connections = [];
    for (const [index, [kind, name]] of definitions.entries()) {
        const prompt = { id: `prompt-${index}`, type: 'guan:product-prompt', title: name, metadata: {
            productImagePrompt: { parameterId: 'parameter', key: `purpose-${index}`, kind, name, planIndex: index },
        } };
        const config = { id: `config-${index}`, type: 'config', metadata: { productPromptConfigKey: prompt.id } };
        nodes.push(prompt, config);
        connections.push({ id: `edge-${index}`, fromNodeId: prompt.id, toNodeId: config.id });
        for (const variant of variants) {
            const text = `Create a 1800×2400 portrait product image ${index}.`;
            const result = { id: `image-${index}-${variant}`, type: 'image', title: variant ? `${variant}-${index + 1}` : text.slice(0, 32),
                position: { x: 1200, y: index * 588 }, width: 340, height: 420,
                metadata: { prompt: text, generationType: 'edit', generationNameBase: variant, status: 'success',
                    ...(variant ? { productVariant: { id: variant, name: variant, parameterId: 'parameter' } } : {}),
                    references: [{ id: 'original', storageKey: 'reference-file' }], model: 'user-model',
                    gatewayGenerationTasks: [{ taskId: 'paid-task', slotId: 'slot' }], gatewayGenerationReceipts: [{ taskId: 'paid-task', responseHash: 'original-hash' }],
                    content: 'blob:existing', storageKey: 'original-file',
                    images: [{ id: 'slot', status: 'success', name: variant ? `${variant}-${index + 1}` : undefined, content: 'blob:existing', storageKey: 'original-file' }] } };
            nodes.push(result);
            connections.push({ id: result.id, fromNodeId: config.id, toNodeId: result.id });
        }
    }
    return { nodes, connections };
}
const outputs = nodes => nodes.filter(node => node.type === 'image');

test('WB现有英文结果卡按真实用途改名，画布、图片槽位及历史下载名称一致，不修改媒体和请求快照', () => {
    const f = fixture(), before = structuredClone(f);
    const next = naming.renameGeneratedImageNodes(f.nodes, f.connections);
    assert.deepEqual(outputs(next).map(node => node.title), expectedNames);
    assert.deepEqual(historyDownloadFiles(next).map(item => item.name), expectedNames);
    for (const [index, node] of outputs(next).entries()) {
        const old = outputs(f.nodes)[index];
        assert.equal(generatedImageName(node, 'slot'), expectedNames[index]);
        assert.deepEqual([node.id, node.position, node.width, node.height], [old.id, old.position, old.width, old.height]);
        for (const key of ['prompt', 'generationType', 'references', 'model', 'gatewayGenerationTasks', 'gatewayGenerationReceipts', 'storageKey', 'content'])
            assert.deepEqual(node.metadata[key], old.metadata[key], key);
        assert.equal(node.metadata.images[0].id, 'slot');
        assert.equal(node.metadata.images[0].storageKey, 'original-file');
    }
    assert.deepEqual(f, before);
    assert.equal(naming.renameGeneratedImageNodes(next, f.connections), next, '重复恢复不重写');
});

test('仅WB应用新规则，其他平台和无真实来源的结果不改名', () => {
    for (const platform of ['亚马逊', 'Ozon', 'Takealot', '未指定', '']) {
        const f = fixture(platform);
        assert.equal(naming.renameGeneratedImageNodes(f.nodes, f.connections), f.nodes, platform);
    }
    const f = fixture();
    assert.equal(naming.renameGeneratedImageNodes(f.nodes, []), f.nodes);
    assert.equal(naming.generatedImageCardTitle({ type: 'guan:product-prompt', title: '主图' }), '');
});

test('已有自动编号可兼容迁入，用户手动修改标题或单图文件名则保留', () => {
    const f = fixture(), images = outputs(f.nodes);
    images[0].title = '我的自定义封面'; images[0].metadata.images[0].name = '封面文件';
    images[1].metadata.generationNameBase = '自动旧名'; images[1].title = '自动旧名-3';
    images[1].metadata.images[0].name = '自动旧名-3';
    images[2].metadata.images[0].name = '用户导出名称';
    const next = naming.renameGeneratedImageNodes(f.nodes, f.connections);
    assert.equal(outputs(next)[0], images[0]);
    assert.equal(outputs(next)[1].title, '轮播图 · 整体尺寸');
    assert.equal(outputs(next)[1].metadata.images[0].name, '轮播图 · 整体尺寸');
    assert.equal(outputs(next)[2].title, '轮播图 · 分层分类');
    assert.equal(outputs(next)[2].metadata.images[0].name, '用户导出名称');
    const changed = outputs(next)[1];
    changed.title = '后来手动改名';
    assert.equal(naming.renameGeneratedImageNodes(next, f.connections).find(node => node.id === changed.id), changed);
});

test('两个变体各自按用途命名，重复生成继续编号，重试及通用编号不会重命名旧卡', () => {
    const f = fixture('Wildberries', ['tree', 'snow']);
    const first = naming.renameGeneratedImageNodes(f.nodes, f.connections);
    assert.deepEqual(outputs(first).slice(0, 4).map(node => node.title), ['主图', '主图', '轮播图 · 整体尺寸', '轮播图 · 整体尺寸']);
    const later = structuredClone(outputs(f.nodes)[0]);
    later.id = 'another-main'; later.title = 'New pending result'; later.metadata.prompt = 'New pending result';
    later.metadata.generationNameBase = '主图'; delete later.metadata.images[0].name; later.metadata.status = 'loading';
    const numbered = numberGeneratedImages([...first, later], node => node.metadata?.generationNameBase || '');
    assert.equal(numbered[3], first[3], '已有WB名称不被旧编号函数改回');
    const connections = [...f.connections, { id: 'later-edge', fromNodeId: 'config-0', toNodeId: later.id }];
    const next = naming.renameGeneratedImageNodes(numbered, connections);
    const result = next.find(node => node.id === later.id);
    assert.equal(result.title, '主图-2');
    assert.equal(result.metadata.images[0].name, '主图-2');
    assert.equal(naming.renameGeneratedImageNodes(next, connections), next);
});

test('WB命名和序号保存后可完整恢复；没有持久图片的失败与生成中结果也使用同一用途名', async () => {
    const f = fixture();
    for (const node of outputs(f.nodes)) {
        node.metadata.content = "";
        node.metadata.images[0].content = "";
    }
    outputs(f.nodes)[0].metadata.status = 'error';
    outputs(f.nodes)[1].metadata.status = 'loading';
    const next = naming.renameGeneratedImageNodes(f.nodes, f.connections), codec = createValueCodec({ client: {} });
    try {
        const value = { nodes: next, connections: f.connections }, encoded = await codec.encode(value), restored = await codec.decode(encoded.tree);
        assert.deepEqual(restored, value);
        assert.equal(naming.renameGeneratedImageNodes(restored.nodes, restored.connections), restored.nodes);
        assert.equal(outputs(restored.nodes)[0].title, '主图');
        assert.equal(outputs(restored.nodes)[1].title, '轮播图 · 整体尺寸');
    } finally { codec.close(); }
});
