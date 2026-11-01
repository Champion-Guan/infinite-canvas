import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { transformWithEsbuild } from '../.运行/3100源/画布副本/web/node_modules/vite/dist/node/index.js';

async function load(file, dependencies = {}) {
    const source = `扩展功能/画布布局/${file}`;
    const { code } = await transformWithEsbuild(readFileSync(source, 'utf8'), source, { loader: 'ts', format: 'cjs', target: 'es2022', tsconfigRaw: '{}' });
    const module = { exports: {} };
    new Function('require', 'module', 'exports', code)(id => {
        assert.ok(Object.hasOwn(dependencies, id), `未声明依赖：${id}`);
        return dependencies[id];
    }, module, module.exports);
    return module.exports;
}
const placement = await load('卡片自动避让.ts');
const workflow = await load('画布流程分组排布.ts');
const { layoutCanvas } = await load('画布整体排布.ts', { './卡片自动避让': placement, './画布流程分组排布': workflow });
const node = (id, type, x, y, width = 100, height = 80, metadata = {}) => ({ id, type, title: id, position: { x, y }, width, height, metadata });
const image = (id, title, x, y, width = 100, height = 80) => ({ ...node(id, 'image', x, y, width, height, { generationType: 'generation' }), title });
const edge = (from, to, id = `${from}-${to}`) => ({ id, fromNodeId: from, toNodeId: to });
const get = (nodes, id) => nodes.find(item => item.id === id);
const centers = item => item.position.y + item.height / 2;
const stablePositions = nodes => Object.fromEntries(nodes.map(item => [item.id, item.position]));
const noOverlap = nodes => {
    const items = nodes.filter(item => item.type !== 'group' && Number.isFinite(item.width) && item.width > 0 && Number.isFinite(item.height) && item.height > 0);
    for (const [i, a] of items.entries()) for (const b of items.slice(i + 1)) {
        assert.equal(placement.nodesOverlap(a, b), false, `${a.id} 与 ${b.id} 重叠`);
    }
};

function fixture() {
    const parameter = node('parameter', 'guan:prompt-variables', -300, 0, 130, 180);
    const source1 = node('source1', 'text', 0, 0, 180, 120, { excelPromptLabel: '详情页提示词01' });
    const source2 = node('source2', 'text', 0, 420, 140, 80, { excelPromptLabel: '详情页提示词02' });
    const prompt1 = node('prompt1', 'text', 320, 35, 150, 150, { promptVariablePreviewOf: 'parameter', promptVariableSourceNodeId: 'source1' });
    const prompt2 = node('prompt2', 'text', 320, 450, 170, 110, { promptVariablePreviewOf: 'parameter', promptVariableSourceNodeId: 'source2' });
    const config1 = node('config1', 'config', 640, 40, 200, 100);
    const config2 = node('config2', 'config', 640, 460, 210, 130);
    const img11 = image('img11', '详情页01-1', 1000, 0, 100, 140);
    const img13 = image('img13', '详情页01-3', 1300, 0, 140, 80);
    const img21 = image('img21', '详情页02-1', 1000, 450, 120, 160);
    const img22 = image('img22', '详情页02-2', 1300, 450, 90, 90);
    const img23 = image('img23', '详情页02-3', 1600, 450, 130, 120);
    const nodes = [parameter, source1, source2, prompt1, prompt2, config1, config2, img11, img13, img21, img22, img23];
    const edges = [edge('parameter', 'source1'), edge('parameter', 'source2'), edge('source1', 'prompt1'), edge('source2', 'prompt2'),
        edge('prompt1', 'config1'), edge('prompt2', 'config2'), edge('config1', 'img11'), edge('config1', 'img13'),
        edge('config2', 'img21'), edge('config2', 'img22'), edge('config2', 'img23')];
    return { nodes, edges };
}

test('实际配置归属确定行，同尾号同列、缺号留空且列宽容纳不同尺寸', () => {
    const { nodes, edges } = fixture(), result = layoutCanvas(nodes, edges);
    const first = get(result, 'img11'), third = get(result, 'img13'), row2first = get(result, 'img21'), second = get(result, 'img22'), row2third = get(result, 'img23');
    assert.equal(first.position.x, row2first.position.x);
    assert.equal(third.position.x, row2third.position.x);
    assert.ok(first.position.x + Math.max(first.width, row2first.width) <= second.position.x);
    assert.ok(second.position.x + second.width <= third.position.x);
    for (const ids of [['source1', 'prompt1', 'config1', 'img11', 'img13'], ['source2', 'prompt2', 'config2', 'img21', 'img22', 'img23']]) {
        assert.ok(ids.every(id => centers(get(result, id)) === centers(get(result, ids[0]))));
    }
    assert.equal(get(result, 'source1').position.x, get(result, 'source2').position.x);
    assert.equal(get(result, 'prompt1').position.x, get(result, 'prompt2').position.x);
    assert.equal(get(result, 'config1').position.x, get(result, 'config2').position.x);
    noOverlap(result);
});

test('布局不依赖卡片和连线输入顺序，重复执行保持原样', () => {
    const { nodes, edges } = fixture();
    const result = layoutCanvas(nodes, edges);
    const reversed = layoutCanvas([...nodes].reverse(), [...edges].reverse());
    assert.deepEqual(stablePositions(result), stablePositions(reversed));
    assert.equal(layoutCanvas(result, edges), result);
});

test('只整理选区，未选节点和分组不移动，固定障碍不能重叠', () => {
    const { nodes, edges } = fixture();
    const obstacle = node('obstacle', 'image', 0, -230, 220, 220);
    const items = [...nodes, obstacle], selected = new Set(['source1', 'prompt1', 'config1', 'img11', 'img13']);
    const result = layoutCanvas(items, edges, selected);
    for (const item of items.filter(item => !selected.has(item.id))) assert.equal(get(result, item.id), item);
    noOverlap(result);
    assert.equal(layoutCanvas(items, edges, new Set()), items);
});

test('分组子卡整理后组边界能包住子卡，单独选择子卡不移动未选分组', () => {
    const { nodes, edges } = fixture();
    const group = node('group', 'group', -10, -10, 20, 20);
    const items = [group, ...nodes.map(item => item.id === 'img11' || item.id === 'img13' ? { ...item, metadata: { ...item.metadata, groupId: 'group' } } : item)];
    const result = layoutCanvas(items, edges), wrapper = get(result, 'group');
    for (const id of ['img11', 'img13']) {
        const child = get(result, id);
        assert.ok(wrapper.position.x <= child.position.x && wrapper.position.y <= child.position.y);
        assert.ok(wrapper.position.x + wrapper.width >= child.position.x + child.width && wrapper.position.y + wrapper.height >= child.position.y + child.height);
    }
    const selected = layoutCanvas(items, edges, new Set(['img11']));
    assert.equal(get(selected, 'group'), group);
    assert.equal(get(selected, 'img11'), get(items, 'img11'));
});

test('无连线卡片、多个提示词输入及共享参考图均保留，名称不能伪造归属', () => {
    const config = node('config', 'config', 500, 0), first = node('first', 'text', 0, 0), second = node('second', 'text', 0, 200);
    const shared = image('shared', '参考图-1', -300, 500), output = image('output', '详情页01-1', 900, 0);
    const orphan = image('orphan', '详情页01-2', 1400, 0), otherConfig = node('otherConfig', 'config', 500, 500);
    const nodes = [config, first, second, shared, output, orphan, otherConfig];
    const edges = [edge('first', 'config'), edge('second', 'config'), edge('shared', 'config'), edge('shared', 'otherConfig'), edge('config', 'output')];
    const result = layoutCanvas(nodes, edges);
    assert.equal(result.length, nodes.length); assert.deepEqual(new Set(result.map(item => item.id)), new Set(nodes.map(item => item.id)));
    assert.equal(centers(get(result, 'output')), centers(get(result, 'config')));
    assert.ok(get(result, 'shared').position.x < get(result, 'config').position.x);
    assert.notEqual(get(result, 'orphan').position.x, get(result, 'output').position.x);
    noOverlap(result);
});

test('循环和断裂关系不丢卡、不生成非有限坐标，也不改变关系及元数据', () => {
    const text = node('text', 'text', 0, 0, 150, 100, { content: '保持原文', groupId: 'g' });
    const config = node('config', 'config', 400, 300, 150, 120, { model: '保留设置' });
    const orphan = node('orphan', 'audio', 800, 600, 100, 100, { storageKey: '保留素材' });
    const nodes = [text, config, orphan], edges = [edge('text', 'config', 'same'), edge('config', 'text', 'same'), edge('missing', 'config')];
    const saved = structuredClone({ nodes, edges }), result = layoutCanvas(nodes, edges);
    assert.equal(result.length, nodes.length); assert.deepEqual({ nodes, edges }, saved);
    for (const item of result) {
        const old = get(nodes, item.id);
        assert.equal(item.metadata, old.metadata); assert.equal(item.title, old.title);
        assert.ok(Number.isFinite(item.position.x) && Number.isFinite(item.position.y));
    }
    noOverlap(result);
});

test('选区以自身位置整理，选中卡片可交换旧位置且其他卡片不动', () => {
    const source = node('source', 'text', 400, 200);
    const target = node('target', 'text', 0, 0);
    const obstacle = node('obstacle', 'image', 0, 500);
    const items = [source, target, obstacle];
    const result = layoutCanvas(items, [edge('source', 'target')], new Set(['source', 'target']));
    assert.equal(get(result, 'obstacle'), obstacle);
    assert.ok(get(result, 'source').position.x < get(result, 'target').position.x);
    assert.equal(centers(get(result, 'source')), centers(get(result, 'target')));
    noOverlap(result);
});

test('普通单线按真实关系水平排列，过大的结果编号不产生巨量空列', () => {
    const first = node('first', 'image', 500, 0), second = node('second', 'text', 0, 400);
    const flow = layoutCanvas([first, second], [edge('first', 'second')]);
    assert.ok(get(flow, 'first').position.x < get(flow, 'second').position.x);
    assert.equal(centers(get(flow, 'first')), centers(get(flow, 'second')));
    const config = node('config', 'config', 0, 0), output = image('output', '结果-1000', 400, 0);
    const result = layoutCanvas([config, output], [edge('config', 'output')]);
    assert.ok(get(result, 'output').position.x < 1000);
});

test('提示词按主图、详情页、富内容、视频及各自编号从上到下排序', () => {
    const definitions = [
        ['video2', '视频提示词02'], ['rich2', '富内容提示词02'], ['detail10', '详情页提示词10'],
        ['main', '主图提示词'], ['detail2', '详情页提示词02'], ['video1', '视频提示词01'],
        ['rich1', '富内容提示词01'], ['detail1', '详情页提示词01'],
    ];
    const nodes = [], edges = [];
    definitions.forEach(([id, label], i) => {
        nodes.push({ ...node(id, 'text', 0, i * 300, 180, 100, { excelPromptLabel: label }), title: `玩偶产品 · ${label} · 展示主题` });
        nodes.push(node(`config-${id}`, 'config', 400, i * 300, 160, 80));
        edges.push(edge(id, `config-${id}`));
    });
    const result = layoutCanvas(nodes, edges);
    const order = ['main', 'detail1', 'detail2', 'detail10', 'rich1', 'rich2', 'video1', 'video2'];
    for (let i = 1; i < order.length; i++) {
        assert.ok(centers(get(result, order[i - 1])) < centers(get(result, order[i])), `${order[i - 1]} 应排在 ${order[i]} 上方`);
    }
    assert.equal(layoutCanvas(result, edges), result);
    noOverlap(result);
});

test('未连接生成配置的 Excel 提示词也按类别和编号排序', () => {
    const labels = ['视频提示词01', '详情页提示词02', '富内容提示词01', '主图提示词', '详情页提示词01'];
    const nodes = labels.map((label, i) => ({ ...node(`unlinked-${i}`, 'text', 0, i * 200, 160, 100, { excelPromptLabel: label }), title: `商品 · ${label}` }));
    const result = layoutCanvas(nodes, []);
    const order = [3, 4, 1, 2, 0].map(i => centers(get(result, `unlinked-${i}`)));
    assert.ok(order.every((value, i) => i === 0 || order[i - 1] < value));
    noOverlap(result);
});

test('已连接和未连接配置的提示词共同按类别排序', () => {
    const prompt = (id, label, y) => ({ ...node(id, 'text', 0, y, 160, 100, { excelPromptLabel: label }), title: `商品 · ${label}` });
    const nodes = [prompt('video', '视频提示词01', 0), prompt('detail', '详情页提示词01', 400),
        prompt('main', '主图提示词', 800), prompt('rich', '富内容提示词01', 1200),
        node('detail-config', 'config', 400, 400), node('video-config', 'config', 400, 0)];
    const result = layoutCanvas(nodes, [edge('detail', 'detail-config'), edge('video', 'video-config')]);
    const order = ['main', 'detail', 'rich', 'video'].map(id => centers(get(result, id)));
    assert.ok(order.every((value, i) => i === 0 || order[i - 1] < value));
    noOverlap(result);
});

test('产品参数与主图提示词中心同高，参考图片位于其上方且不重叠', () => {
    const parameter = node('parameter', 'guan:prompt-variables', -400, 900, 160, 300);
    const main = { ...node('main', 'text', 0, 600, 180, 100, { excelPromptLabel: '主图提示词' }), title: '商品 · 主图提示词' };
    const detail = { ...node('detail', 'text', 0, 0, 180, 100, { excelPromptLabel: '详情页提示词01' }), title: '商品 · 详情页提示词01' };
    const mainConfig = node('main-config', 'config', 400, 600);
    const detailConfig = node('detail-config', 'config', 400, 0);
    const reference1 = { ...node('ref1', 'image', -500, -200, 140, 110), title: '参考图1' };
    const reference2 = { ...node('ref2', 'image', -700, -100, 160, 150), title: '参考图2' };
    const nodes = [detail, reference2, mainConfig, parameter, main, detailConfig, reference1];
    const edges = [edge('parameter', 'main'), edge('parameter', 'detail'), edge('main', 'main-config'), edge('detail', 'detail-config'),
        edge('ref1', 'main-config'), edge('ref1', 'detail-config'), edge('ref2', 'main-config')];
    const result = layoutCanvas(nodes, edges);
    assert.equal(centers(get(result, 'parameter')), centers(get(result, 'main')));
    for (const id of ['ref1', 'ref2']) {
        assert.ok(get(result, id).position.y + get(result, id).height <= get(result, 'parameter').position.y, `${id} 应位于参数卡片上方`);
    }
    noOverlap(result);
    assert.equal(layoutCanvas(result, edges), result);
});

test('最终提示词翻译卡根据来源及连线排在同一行，位于最终提示词和生成配置之间', () => {
    const source = { ...node('source', 'text', 0, 300, 150, 100, { excelPromptLabel: '详情页提示词01' }), title: '商品 · 详情页提示词01' };
    const prompt = node('prompt', 'text', 300, 0, 170, 120, { promptVariablePreviewOf: 'parameter', promptVariableSourceNodeId: 'source' });
    const translation = { ...node('translation', 'text', 0, 700, 200, 140, { promptVariableTranslationOf: 'prompt', promptVariableTranslationLanguage: 'en' }), title: '英文最终生图提示词' };
    const config = node('config', 'config', 700, 300, 150, 80);
    const nodes = [translation, config, source, prompt];
    const edges = [edge('source', 'prompt'), edge('prompt', 'translation'), edge('translation', 'config')];
    const result = layoutCanvas(nodes, edges);
    const ordered = ['source', 'prompt', 'translation', 'config'].map(id => get(result, id));
    for (let i = 1; i < ordered.length; i++) {
        assert.ok(ordered[i - 1].position.x + ordered[i - 1].width <= ordered[i].position.x);
        assert.equal(centers(ordered[i - 1]), centers(ordered[i]));
    }
    noOverlap(result);
    assert.equal(layoutCanvas(result, edges), result);
});

test('翻译卡尚未连到配置时仍占据专属翻译列并与所属提示词同排', () => {
    const source = { ...node('source', 'text', 0, 0, 160, 100, { excelPromptLabel: '主图提示词' }), title: '主图提示词' };
    const prompt = node('prompt', 'text', 300, 100, 160, 120, { promptVariablePreviewOf: 'parameter', promptVariableSourceNodeId: 'source' });
    const translation = { ...node('translation', 'text', 500, 600, 180, 100, { promptVariableTranslationOf: 'prompt', promptVariableTranslationLanguage: 'zh' }), title: '中文最终生图提示词' };
    const unrelated = { ...node('unrelated', 'text', 800, 800), title: '英文最终生图提示词' };
    const config = node('config', 'config', 900, 0);
    const nodes = [source, prompt, translation, unrelated, config];
    const edges = [edge('source', 'prompt'), edge('prompt', 'translation'), edge('prompt', 'config')];
    const result = layoutCanvas(nodes, edges);
    assert.equal(centers(get(result, 'translation')), centers(get(result, 'prompt')));
    assert.ok(get(result, 'prompt').position.x + get(result, 'prompt').width <= get(result, 'translation').position.x);
    assert.ok(get(result, 'translation').position.x + get(result, 'translation').width <= get(result, 'config').position.x);
    assert.notEqual(centers(get(result, 'translation')), centers(get(result, 'unrelated')));
    noOverlap(result);
});

test('只连接参考图的配置与参考图相邻，不能排到整个提示词流程末尾', () => {
    const parameter = node('parameter', 'guan:prompt-variables', 0, 0, 120, 160);
    const reference = { ...node('reference', 'image', 0, -250, 100, 100), title: '参考图' };
    const nodes = [parameter, reference, node('reference-config', 'config', 1200, 4000, 120, 100)];
    const edges = [edge('reference', 'reference-config')];
    for (let i = 1; i <= 12; i++) {
        const id = `detail${i}`, config = `config${i}`;
        nodes.push({ ...node(id, 'text', 300, i * 220, 120, 100, { excelPromptLabel: `详情页提示词${i}` }), title: `详情页提示词${i}` });
        nodes.push(node(config, 'config', 600, i * 220, 120, 100));
        edges.push(edge('parameter', id), edge(id, config), edge('reference', config));
    }
    const result = layoutCanvas(nodes, edges);
    const ref = get(result, 'reference'), config = get(result, 'reference-config');
    assert.ok(Math.abs(centers(ref) - centers(config)) <= Math.max(ref.height, config.height) + 96);
    assert.ok(config.position.x >= ref.position.x + ref.width);
    noOverlap(result);
});

test('生成图片继续作为参考图时，再生配置和结果与原图相邻', () => {
    const source = { ...node('source', 'text', 0, 0, 120, 100, { excelPromptLabel: '详情页提示词01' }), title: '详情页提示词01' };
    const firstConfig = node('first-config', 'config', 300, 0, 120, 100);
    const firstImage = image('first-image', '详情页01-1', 600, 0, 120, 100);
    const regenConfig = node('regen-config', 'config', 2000, 3000, 120, 100);
    const secondImage = image('second-image', '详情页01-2', 2500, 3000, 120, 100);
    const unrelated = { ...node('unrelated', 'text', 0, 400, 120, 100, { excelPromptLabel: '详情页提示词02' }), title: '详情页提示词02' };
    const nodes = [source, firstConfig, firstImage, regenConfig, secondImage, unrelated];
    const edges = [edge('source', 'first-config'), edge('first-config', 'first-image'), edge('first-image', 'regen-config'), edge('regen-config', 'second-image')];
    const result = layoutCanvas(nodes, edges);
    const a = get(result, 'first-image'), b = get(result, 'regen-config'), c = get(result, 'second-image');
    assert.ok(b.position.x >= a.position.x + a.width && b.position.x - (a.position.x + a.width) <= 240);
    assert.ok(c.position.x >= b.position.x + b.width && c.position.x - (b.position.x + b.width) <= 240);
    assert.ok(Math.abs(centers(a) - centers(b)) <= Math.max(a.height, b.height) + 96);
    assert.ok(Math.abs(centers(b) - centers(c)) <= Math.max(b.height, c.height) + 96);
    noOverlap(result);
});

test('原始 Excel 提示词同时连接最终提示词及翻译时，翻译位于最终提示词之后且同排', () => {
    const source = { ...node('source', 'text', 0, 0, 140, 100, { excelPromptLabel: '详情页提示词09' }), title: '详情页提示词09' };
    const prompt = node('prompt', 'text', 300, 0, 160, 100, { promptVariablePreviewOf: 'parameter', promptVariableSourceNodeId: 'source' });
    const translation = { ...node('translation', 'text', 2000, 1000, 160, 100, { promptVariableTranslationOf: 'source', promptVariableTranslationLanguage: 'en' }), title: '英文最终生图提示词' };
    const config = node('config', 'config', 600, 0, 120, 100);
    const nodes = [source, prompt, translation, config], edges = [edge('source', 'prompt'), edge('source', 'translation'), edge('prompt', 'config')];
    const result = layoutCanvas(nodes, edges);
    assert.equal(centers(get(result, 'translation')), centers(get(result, 'prompt')));
    assert.ok(get(result, 'translation').position.x >= get(result, 'prompt').position.x + get(result, 'prompt').width);
    assert.ok(get(result, 'translation').position.x + get(result, 'translation').width <= get(result, 'config').position.x);
    noOverlap(result);
});

test('旧翻译卡仅保留标题时通过唯一真实文本连线关联并与提示词同排', () => {
    const source = { ...node('source', 'text', 0, 0, 140, 100, { excelPromptLabel: '详情页提示词09' }), title: '详情页提示词09' };
    const prompt = node('prompt', 'text', 300, 0, 160, 100, { promptVariablePreviewOf: 'parameter', promptVariableSourceNodeId: 'source' });
    const translation = { ...node('translation', 'text', 1600, 1000, 160, 100), title: '英文最终生图提示词' };
    const unrelated = { ...node('unrelated', 'text', 1900, 1000, 160, 100), title: '英文最终生图提示词' };
    const nodes = [source, prompt, translation, unrelated], edges = [edge('source', 'prompt'), edge('source', 'translation')];
    const result = layoutCanvas(nodes, edges);
    assert.equal(centers(get(result, 'translation')), centers(get(result, 'prompt')));
    assert.ok(get(result, 'translation').position.x >= get(result, 'prompt').position.x + get(result, 'prompt').width);
    assert.notEqual(get(result, 'translation').position.x, get(result, 'unrelated').position.x);
    noOverlap(result);
});

test('一张生成图及遮罩通往多个再生图时相关图片保持附近，顺序与重复整理稳定', () => {
    const prompt = { ...node('prompt', 'text', 0, 0, 120, 100, { excelPromptLabel: '详情页提示词04' }), title: '详情页提示词04' };
    const config = node('config', 'config', 300, 0, 120, 100);
    const original = image('original', '详情页04-1', 600, 0, 120, 100);
    const mask = image('mask', '遮罩标注', 900, 0, 120, 100);
    const result1 = image('result1', '详情页04-2', 1800, 800, 120, 100);
    const result2 = image('result2', '详情页04-3', 1800, 1200, 120, 100);
    const nodes = [prompt, config, original, mask, result1, result2];
    const edges = [edge('prompt', 'config'), edge('config', 'original'), edge('original', 'result1'), edge('mask', 'result1'), edge('original', 'result2'), edge('mask', 'result2')];
    const arranged = layoutCanvas(nodes, edges);
    const base = get(arranged, 'original');
    for (const id of ['mask', 'result1', 'result2']) {
        const item = get(arranged, id);
        assert.ok(Math.abs(item.position.x - base.position.x) <= 800 && Math.abs(centers(item) - centers(base)) <= 500, `${id} 应靠近原图`);
    }
    noOverlap(arranged);
    assert.deepEqual(stablePositions(arranged), stablePositions(layoutCanvas([...nodes].reverse(), [...edges].reverse())));
    assert.equal(layoutCanvas(arranged, edges), arranged);
});

test('原图与遮罩共同连接的多张再生结果在附近同一行横排', () => {
    const prompt = { ...node('prompt', 'text', 0, 0, 150, 120, { excelPromptLabel: '详情页提示词04' }), title: '详情页提示词04' };
    const config = node('config', 'config', 300, 0, 150, 120);
    const original = image('original', '详情页04-1', 600, 0, 150, 150);
    const mask = image('mask', '遮罩标注', 600, 300, 150, 120);
    const result1 = image('result1', '详情页04-2', 2500, 900, 150, 150);
    const result2 = image('result2', '详情页04-3', 2500, 1300, 120, 100);
    const result3 = image('result3', '详情页04-4', 2500, 1700, 160, 140);
    const nodes = [prompt, config, original, mask, result1, result2, result3];
    const edges = [edge('prompt', 'config'), edge('config', 'original'), ...[result1, result2, result3].flatMap(result => [edge('original', result.id), edge('mask', result.id)])];
    const arranged = layoutCanvas(nodes, edges);
    const results = [result1, result2, result3].map(result => get(arranged, result.id));
    for (let i = 1; i < results.length; i++) {
        assert.equal(centers(results[i]), centers(results[0]), '同一再生分支的结果应处于同一水平行');
        assert.ok(results[i].position.x >= results[i - 1].position.x + results[i - 1].width, '再生结果按编号从左向右排列');
    }
    const placedOriginal = get(arranged, 'original'), placedMask = get(arranged, 'mask');
    assert.ok(results[0].position.x >= placedOriginal.position.x + placedOriginal.width);
    assert.ok(results[0].position.x - (placedOriginal.position.x + placedOriginal.width) <= 350, '再生结果应靠近原图');
    assert.ok(Math.abs(centers(placedMask) - centers(placedOriginal)) <= 500, '遮罩应靠近原图');
    assert.ok(Math.abs(centers(results[0]) - centers(placedOriginal)) <= 500, '再生结果应靠近原图');
    noOverlap(arranged);
    assert.deepEqual(stablePositions(arranged), stablePositions(layoutCanvas([...nodes].reverse(), [...edges].reverse())));
    assert.equal(layoutCanvas(arranged, edges), arranged);
});

test('主图、详情页、富内容及视频的流程分区清晰，同类编号按顺序排列', () => {
    const labels = ['详情页提示词02', '视频提示词01', '主图提示词', '富内容提示词01', '详情页提示词01'];
    const nodes = [], edges = [];
    for (const [i, label] of labels.entries()) {
        const source = `source${i}`, config = `config${i}`, output = `output${i}`;
        nodes.push({ ...node(source, 'text', 20, i * 300, 120, 100, { excelPromptLabel: label }), title: label });
        nodes.push(node(config, 'config', 500, i * 300, 120, 100));
        nodes.push(image(output, `${label}-1`, 900, i * 300, 120, 100));
        edges.push(edge(source, config), edge(config, output));
    }
    const result = layoutCanvas(nodes, edges);
    const ordered = [2, 4, 0, 3, 1].map(i => get(result, `source${i}`));
    for (let i = 1; i < ordered.length; i++) {
        const gap = ordered[i].position.y - (ordered[i - 1].position.y + ordered[i - 1].height);
        assert.ok(gap >= (i === 2 ? 48 : 96), `流程组间距不足：${ordered[i - 1].title} / ${ordered[i].title}`);
    }
    for (let i = 0; i < labels.length; i++) {
        assert.equal(centers(get(result, `source${i}`)), centers(get(result, `config${i}`)));
        assert.equal(centers(get(result, `config${i}`)), centers(get(result, `output${i}`)));
    }
    noOverlap(result);
    assert.equal(layoutCanvas(result, edges), result);
});

test('翻译和多结果再生分支留在对应工作流附近，不改变连接或依赖输入顺序', () => {
    const source = { ...node('source', 'text', 0, 0, 150, 100, { excelPromptLabel: '详情页提示词01' }), title: '详情页提示词01' };
    const prompt = node('prompt', 'text', 250, 0, 150, 100, { promptVariablePreviewOf: 'parameter', promptVariableSourceNodeId: 'source' });
    const translation = { ...node('translation', 'text', 800, 1200, 150, 100, { promptVariableTranslationOf: 'source' }), title: '英文最终生图提示词' };
    const config = node('config', 'config', 600, 0, 120, 100);
    const output1 = image('output1', '详情页01-1', 800, 0, 120, 100);
    const output2 = image('output2', '详情页01-2', 1100, 0, 120, 100);
    const regenConfig = node('regen-config', 'config', 2500, 1500, 120, 100);
    const regenImage = image('regen-image', '详情页01-再生', 2800, 1500, 120, 100);
    const other = { ...node('other', 'text', 0, 400, 150, 100, { excelPromptLabel: '详情页提示词02' }), title: '详情页提示词02' };
    const otherConfig = node('other-config', 'config', 600, 400, 120, 100);
    const nodes = [source, prompt, translation, config, output1, output2, regenConfig, regenImage, other, otherConfig];
    const edges = [edge('source', 'prompt'), edge('source', 'translation'), edge('prompt', 'config'), edge('config', 'output1'), edge('config', 'output2'), edge('output1', 'regen-config'), edge('regen-config', 'regen-image'), edge('other', 'other-config')];
    const original = structuredClone({ nodes, edges });
    const result = layoutCanvas(nodes, edges);
    const placedPrompt = get(result, 'prompt'), placedTranslation = get(result, 'translation'), placedConfig = get(result, 'config');
    assert.ok(placedPrompt.position.x + placedPrompt.width <= placedTranslation.position.x);
    assert.ok(placedTranslation.position.x + placedTranslation.width <= placedConfig.position.x);
    assert.equal(centers(placedTranslation), centers(placedPrompt));
    for (const [parent, child] of [['output1', 'regen-config'], ['regen-config', 'regen-image']]) {
        const a = get(result, parent), b = get(result, child);
        assert.ok(b.position.x >= a.position.x + a.width, `${child} 应处于 ${parent} 右侧`);
        assert.ok(b.position.x - (a.position.x + a.width) <= 300, `${child} 离 ${parent} 过远`);
        assert.ok(Math.abs(centers(b) - centers(a)) <= 300, `${child} 应靠近 ${parent}`);
    }
    assert.deepEqual({ nodes, edges }, original);
    assert.deepEqual(stablePositions(result), stablePositions(layoutCanvas([...nodes].reverse(), [...edges].reverse())));
    assert.equal(layoutCanvas(result, edges), result);
    noOverlap(result);
});

test('相邻详情页均有多个结果时，再生流程不应挤进下一详情页的区域', () => {
    const nodes = [], edges = [];
    for (const [id, label] of [['a', '详情页提示词01'], ['b', '详情页提示词02']]) {
        nodes.push({ ...node(`${id}-source`, 'text', 0, 0, 120, 100, { excelPromptLabel: label }), title: label });
        nodes.push(node(`${id}-config`, 'config', 300, 0, 120, 100));
        edges.push(edge(`${id}-source`, `${id}-config`));
        for (let n = 1; n <= 3; n++) {
            const output = `${id}-output${n}`;
            nodes.push(image(output, `${label}-${n}`, 600 + n * 200, 0, 120, 100));
            edges.push(edge(`${id}-config`, output));
        }
    }
    nodes.push(node('regen-config', 'config', 3000, 1000, 120, 100));
    nodes.push(image('regen-image', '再生结果', 3500, 1000, 120, 100));
    edges.push(edge('a-output1', 'regen-config'), edge('regen-config', 'regen-image'));
    const result = layoutCanvas(nodes, edges);
    const origin = get(result, 'a-output1'), regen = get(result, 'regen-config');
    const next = get(result, 'b-source');
    assert.ok(centers(regen) > centers(origin), '再生流程应占用原图所在流程下方的独立空间');
    assert.ok(regen.position.y + regen.height + 48 <= next.position.y, '后续详情页应为再生流程预留空间');
    noOverlap(result);
    assert.equal(layoutCanvas(result, edges), result);
});

test('完整工作流按提示词组分层留白，同类型卡片保持列对齐', () => {
    const groups = [
        ['main', '主图提示词'],
        ['detail1', '详情页提示词01'],
        ['detail2', '详情页提示词02'],
        ['rich1', '富内容提示词01'],
        ['video1', '视频提示词01'],
    ];
    const nodes = [], edges = [];
    for (const [id, label] of groups) {
        const source = { ...node(`${id}-source`, 'text', 0, 3000, 160, 110, { excelPromptLabel: label }), title: label };
        const prompt = node(`${id}-prompt`, 'text', 350, 0, 180, 130, { promptVariablePreviewOf: 'parameter', promptVariableSourceNodeId: source.id });
        const translation = { ...node(`${id}-translation`, 'text', 700, 3000, 190, 120, { promptVariableTranslationOf: prompt.id, promptVariableTranslationLanguage: 'en' }), title: '英文最终生图提示词' };
        const config = node(`${id}-config`, 'config', 1100, 0, 180, 100);
        const output = image(`${id}-output`, `${label.replace('提示词', '')}-1`, 1500, 3000, 150, 160);
        nodes.push(source, prompt, translation, config, output);
        edges.push(edge(source.id, prompt.id), edge(prompt.id, translation.id), edge(translation.id, config.id), edge(config.id, output.id));
    }
    const result = layoutCanvas(nodes, edges);
    const groupMembers = groups.map(([id]) => ['source', 'prompt', 'translation', 'config', 'output'].map(kind => get(result, `${id}-${kind}`)));
    for (const members of groupMembers) {
        const rowCenter = centers(members[0]);
        assert.ok(members.filter(item => !item.id.endsWith('-translation')).every(item => centers(item) === rowCenter), '主链阶段卡片应保持同高');
        assert.ok(Math.abs(centers(members[2]) - rowCenter) <= 250, '翻译卡应靠近所属提示词');
        for (let i = 1; i < members.length; i++) {
            assert.ok(members[i - 1].position.x + members[i - 1].width <= members[i].position.x, '同一组应按真实流程从左到右');
        }
    }
    for (let i = 1; i < groupMembers.length; i++) {
        const previousBottom = Math.max(...groupMembers[i - 1].map(item => item.position.y + item.height));
        const nextTop = Math.min(...groupMembers[i].map(item => item.position.y));
        assert.ok(nextTop - previousBottom >= 96, `第 ${i} 组与前一组之间应保留明显留白`);
    }
    for (const kind of ['source', 'prompt', 'translation', 'config', 'output']) {
        const xs = groupMembers.map(members => members.find(item => item.id.endsWith(`-${kind}`)).position.x);
        assert.ok(xs.every(x => x === xs[0]), `${kind} 卡片应保持同一列`);
    }
    noOverlap(result);
});

test('任意流程存在翻译卡时，全体生成配置保持同列；移除所有翻译卡后不预留空列', () => {
    const nodes = [], edges = [];
    for (const [id, label] of [['a', '详情页提示词01'], ['b', '详情页提示词02']]) {
        const source = { ...node(`${id}-source`, 'text', 0, 0, 150, 100, { excelPromptLabel: label }), title: label };
        const prompt = node(`${id}-prompt`, 'text', 400, 0, 150, 100, { promptVariablePreviewOf: 'parameter', promptVariableSourceNodeId: source.id });
        const config = node(`${id}-config`, 'config', 800, 0, 150, 100);
        nodes.push(source, prompt, config);
        edges.push(edge(source.id, prompt.id), edge(prompt.id, config.id));
    }
    const translationNode = { ...node('translation-en', 'text', 1800, 1200, 190, 100, { promptVariableTranslationOf: 'a-prompt', promptVariableTranslationLanguage: 'en' }), title: '英文翻译提示词' };
    nodes.push(translationNode);
    edges.push(edge('a-prompt', translationNode.id));
    const result = layoutCanvas(nodes, edges);
    const prompt = get(result, 'b-prompt'), config = get(result, 'b-config');
    const translation = get(result, 'translation-en');
    assert.ok(config.position.x >= translation.position.x + translation.width);
    assert.equal(get(result, 'a-config').position.x, config.position.x, '有无翻译卡的流程都使用同一配置列');
    noOverlap(result);
    assert.equal(layoutCanvas(result, edges), result);

    const withoutTranslations = layoutCanvas(nodes.filter(item => item.id !== translationNode.id),
        edges.filter(item => item.toNodeId !== translationNode.id && item.fromNodeId !== translationNode.id));
    assert.equal(get(withoutTranslations, 'b-config').position.x,
        get(withoutTranslations, 'b-prompt').position.x + get(withoutTranslations, 'b-prompt').width + 96,
        '全画布没有翻译卡时配置列紧跟提示词列');
    assert.ok(config.position.x > get(withoutTranslations, 'b-config').position.x,
        '存在翻译卡时才为全局翻译列预留横向空间');
});

test('未接生成配置的翻译仍与所属流程同排；参考图单输入配置进入统一配置列', () => {
    const parameter = node('parameter', 'guan:prompt-variables', 0, 0, 140, 120);
    const reference = node('reference', 'image', -250, -200, 120, 160);
    const nodes = [parameter, reference];
    const edges = [];
    for (let index = 1; index <= 18; index++) {
        const suffix = String(index).padStart(2, '0');
        const kind = index <= 10 ? `详情页提示词${suffix}` : `富内容提示词${String(index - 10).padStart(2, '0')}`;
        const source = { ...node(`source-${index}`, 'text', 0, index * 240, 180, 100, { excelPromptLabel: kind }), title: kind };
        const prompt = node(`prompt-${index}`, 'text', 350, index * 240, 200, 120, { promptVariablePreviewOf: 'parameter', promptVariableSourceNodeId: source.id });
        const config = node(`config-${index}`, 'config', 900, index * 240, 220, 180);
        const output = image(`output-${index}`, `${kind.replace('提示词', '')}-1`, 1400, index * 240, 160, 180);
        nodes.push(source, prompt, config, output);
        edges.push(edge(parameter.id, source.id), edge(source.id, prompt.id), edge(prompt.id, config.id), edge(reference.id, config.id), edge(config.id, output.id));
    }
    const source = get(nodes, 'source-9');
    const translation = { ...node('translation-9', 'text', 2200, 8000, 200, 120, { promptVariableTranslationOf: source.id, promptVariableTranslationLanguage: 'en' }), title: '英文最终生图提示词' };
    const orphanConfig = node('orphan-config', 'config', -1800, -400, 220, 180);
    nodes.push(translation, orphanConfig);
    edges.push(edge(source.id, translation.id), edge(reference.id, orphanConfig.id));

    const result = layoutCanvas(nodes, edges);
    const placedTranslation = get(result, translation.id);
    const placedSource = get(result, source.id);
    const placedPrompt = get(result, 'prompt-9');
    const configs = result.filter(item => item.type === 'config');
    assert.equal(new Set(configs.map(item => item.position.x)).size, 1, '包括参考图单输入配置在内的配置卡应同列');
    assert.equal(centers(placedTranslation), centers(placedSource), '翻译卡应与所属提示词流程同排');
    assert.ok(placedTranslation.position.x >= placedPrompt.position.x + placedPrompt.width, '翻译卡应位于最终提示词之后');
    assert.ok(placedTranslation.position.x + placedTranslation.width <= get(result, 'config-9').position.x, '翻译列应位于生成配置之前');
    noOverlap(result);
    assert.equal(layoutCanvas(result, edges), result, '再次整理应保持幂等');
});

test('全画布没有翻译卡时生成配置直接跟随提示词，不保留空列', () => {
    const source = { ...node('source', 'text', 0, 0, 150, 100, { excelPromptLabel: '详情页提示词01' }), title: '详情页提示词01' };
    const prompt = node('prompt', 'text', 400, 0, 170, 100, { promptVariablePreviewOf: 'parameter', promptVariableSourceNodeId: 'source' });
    const config = node('config', 'config', 1000, 0, 150, 100);
    const result = layoutCanvas([source, prompt, config], [edge('source', 'prompt'), edge('prompt', 'config')]);
    assert.equal(get(result, 'config').position.x, get(result, 'prompt').position.x + get(result, 'prompt').width + 96);
    noOverlap(result);
});

test('再生分支在对应原图附近单独占行，不与原始输出挤在同一行', () => {
    const source = { ...node('regen-source', 'text', 0, 0, 160, 100, { excelPromptLabel: '详情页提示词03' }), title: '详情页提示词03' };
    const config = node('regen-source-config', 'config', 350, 0, 150, 90);
    const original = image('regen-original', '详情页03-1', 700, 0, 150, 150);
    const mask = image('regen-mask', '遮罩标注', 700, 400, 150, 120);
    const regenConfig = node('regen-config', 'config', 1200, 1000, 160, 100);
    const regenOutput = image('regen-output', '详情页03-2', 1550, 1000, 150, 150);
    const nodes = [source, config, original, mask, regenConfig, regenOutput];
    const edges = [edge('regen-source', 'regen-source-config'), edge('regen-source-config', 'regen-original'),
        edge('regen-original', 'regen-config'), edge('regen-mask', 'regen-config'), edge('regen-config', 'regen-output')];
    const result = layoutCanvas(nodes, edges);
    const originalResult = get(result, 'regen-original'), maskResult = get(result, 'regen-mask');
    const regenConfigResult = get(result, 'regen-config'), regenOutputResult = get(result, 'regen-output');
    assert.ok(maskResult.position.x >= originalResult.position.x + originalResult.width, '批注输入应排在原图之后');
    assert.ok(regenConfigResult.position.x >= Math.max(originalResult.position.x + originalResult.width, maskResult.position.x + maskResult.width));
    assert.ok(regenConfigResult.position.x - Math.max(originalResult.position.x + originalResult.width, maskResult.position.x + maskResult.width) <= 240,
        '再生配置应紧跟原图和批注两个输入之后');
    assert.ok(regenOutputResult.position.x >= regenConfigResult.position.x + regenConfigResult.width);
    assert.ok(regenOutputResult.position.x - (regenConfigResult.position.x + regenConfigResult.width) <= 240, '再生结果不能离再生配置过远');
    assert.ok(Math.abs(centers(maskResult) - centers(originalResult)) <= 500, '遮罩应保持在原图附近');
    noOverlap(result);
});

test('再生配置含批注文字输入时原图与批注并排，配置在下方居中且结果在右侧', () => {
    const source = { ...node('source', 'text', 0, 0, 160, 100, { excelPromptLabel: '详情页提示词04' }), title: '详情页提示词04' };
    const firstConfig = node('first-config', 'config', 300, 0, 150, 100);
    const original = { ...image('original', '详情页04-1', 600, 0, 140, 130), metadata: { generationType: 'generation', generationNameBase: '详情页04' } };
    const mask = { ...node('mask', 'text', 900, 600, 140, 90), title: '批注生成另一张' };
    const regenConfig = node('regen-config', 'config', 2500, 1500, 150, 100);
    const regenOutput = image('regen-output', '详情页04-2', 3000, 1500, 140, 130);
    const otherSource = { ...node('other-source', 'text', 0, 500, 160, 100, { excelPromptLabel: '详情页提示词05' }), title: '详情页提示词05' };
    const otherConfig = node('other-config', 'config', 300, 500, 150, 100);
    const nodes = [source, firstConfig, original, mask, regenConfig, regenOutput, otherSource, otherConfig];
    const edges = [edge('source', 'first-config'), edge('first-config', 'original'), edge('original', 'regen-config'),
        edge('mask', 'regen-config'), edge('regen-config', 'regen-output'), edge('other-source', 'other-config')];
    const result = layoutCanvas(nodes, edges);
    const placedSource = get(result, 'source'), placedFirstConfig = get(result, 'first-config');
    const placedOriginal = get(result, 'original'), placedMask = get(result, 'mask');
    const placedRegenConfig = get(result, 'regen-config'), placedRegenOutput = get(result, 'regen-output');
    assert.equal(placedFirstConfig.position.x, get(result, 'other-config').position.x, '主生成配置仍保持同一列');
    assert.equal(placedSource.position.x, get(result, 'other-source').position.x, '主提示词仍保持同一列');
    assert.ok(placedOriginal.position.x >= placedFirstConfig.position.x + placedFirstConfig.width);
    assert.equal(centers(placedMask), centers(placedOriginal), '原图与批注并排同高');
    const inputLeft = Math.min(placedOriginal.position.x, placedMask.position.x);
    const inputRight = Math.max(placedOriginal.position.x + placedOriginal.width, placedMask.position.x + placedMask.width);
    assert.ok(placedRegenConfig.position.y >= Math.max(placedOriginal.position.y + placedOriginal.height, placedMask.position.y + placedMask.height) + 48,
        '再生配置位于并排输入下方');
    assert.ok(placedRegenConfig.position.x + placedRegenConfig.width / 2 >= inputLeft
        && placedRegenConfig.position.x + placedRegenConfig.width / 2 <= inputRight, '再生配置居中于两输入');
    assert.ok(placedRegenOutput.position.x >= placedRegenConfig.position.x + placedRegenConfig.width);
    assert.ok(placedRegenOutput.position.x - (placedRegenConfig.position.x + placedRegenConfig.width) <= 240);
    assert.equal(centers(placedRegenOutput), centers(placedRegenConfig), '再生结果与配置卡同高');
    noOverlap(result);
});

test('再生输入并排，汇入配置位于两输入下方居中，结果位于配置右侧', () => {
    const source = { ...node('source', 'text', 0, 0, 160, 100, { excelPromptLabel: '详情页提示词04' }), title: '详情页提示词04' };
    const firstConfig = node('first-config', 'config', 300, 0, 150, 100);
    const original = { ...image('original', '详情页04-1', 600, 0, 160, 140), metadata: { generationType: 'generation', generationNameBase: '详情页04' } };
    const annotation = { ...node('annotation', 'text', 1000, 600, 150, 100), title: '批注生成另一张' };
    const regenConfig = node('regen-config', 'config', 2500, 1500, 180, 120);
    const regenOutput = image('regen-output', '详情页04-2', 3000, 1500, 160, 140);
    const nodes = [source, firstConfig, original, annotation, regenConfig, regenOutput];
    const edges = [edge('source', 'first-config'), edge('first-config', 'original'), edge('original', 'regen-config'),
        edge('annotation', 'regen-config'), edge('regen-config', 'regen-output')];
    const result = layoutCanvas(nodes, edges);
    const a = get(result, 'original'), b = get(result, 'annotation'), c = get(result, 'regen-config'), d = get(result, 'regen-output');
    assert.equal(centers(a), centers(b), '原图与批注输入并排同高');
    assert.ok(a.position.x + a.width <= b.position.x || b.position.x + b.width <= a.position.x, '两输入不得重叠');
    assert.ok(c.position.y >= Math.max(a.position.y + a.height, b.position.y + b.height) + 48, '汇入配置放在并排输入下方');
    const groupLeft = Math.min(a.position.x, b.position.x), groupRight = Math.max(a.position.x + a.width, b.position.x + b.width);
    assert.ok(c.position.x + c.width / 2 >= groupLeft && c.position.x + c.width / 2 <= groupRight, '汇入配置应居中于两个输入之间');
    assert.ok(d.position.x >= c.position.x + c.width && d.position.x - (c.position.x + c.width) <= 240, '再生结果紧跟汇入配置右侧');
    noOverlap(result);
});

test('基础实页整理验收规则：保存失败立即刷新并复核恢复结果', () => {
    const instructions = readFileSync('AGENTS.md', 'utf8');
    assert.match(instructions, /实页整理验收使用本机测试数据：点击「整理卡片」后若出现保存失败，立即刷新当前工作台/);
    assert.match(instructions, /重新核对画布能否恢复、节点数量、连线和排布结果/);
    assert.match(instructions, /不改变客户运行时的保存失败恢复策略/);
});
