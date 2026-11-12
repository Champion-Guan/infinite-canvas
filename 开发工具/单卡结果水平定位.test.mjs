import assert from 'node:assert/strict';
import test from 'node:test';
import { variantModules } from './产品变体生成夹具.mjs';

const loader = variantModules();
const layout = loader.load('画布布局/卡片自动避让.ts');
const { layoutCanvas } = loader.load('画布布局/画布整体排布.ts');
const node = (id, type, x, y, width = 340, height = 240, metadata = {}) =>
    ({ id, type, position: { x, y }, width, height, metadata });
const generated = (id, x, y, width = 340, height = 240, status = 'loading') =>
    node(id, 'image', x, y, width, height, { status, generationStartedAt: 1 });
const edge = (fromNodeId, toNodeId) => ({ id: `${fromNodeId}-${toNodeId}`, fromNodeId, toNodeId });

test('32像素旧间距不会小于避让距离，不再撞到来源后下移288像素', () => {
    const source = node('source', 'config', 100, 200);
    const size = { width: 340, height: 240 };
    const position = layout.nextGenerationResultPosition(source, size, 0, 48, 32);
    assert.equal(position.x, 488);
    const output = generated('result', position.x, position.y);
    assert.equal(layout.nodesOverlap(output, source, 48), false);
    assert.equal(layout.placeNewCanvasNodes([source], [source, output]).at(-1), output);
});

test('连续多层障碍只向右避让，已有卡片、分组及输入数组不变', () => {
    const source = node('source', 'config', -500, -200, 500, 300);
    const result = generated('result', 96, -170, 180, 240);
    const blockers = [source, node('a', 'image', 100, -200), node('b', 'text', 488, -200),
        node('group', 'group', -1000, -1000, 5000, 5000), node('bad', 'image', NaN, 0)];
    const before = structuredClone(blockers);
    const placed = layout.placeGeneratedCanvasNode(result, blockers);
    assert.equal(placed.position.x, 876);
    assert.equal(placed.position.y + placed.height / 2, source.position.y + source.height / 2);
    assert.deepEqual(blockers, before);
    assert.ok(blockers.every(item => item.type === 'group' || !layout.nodesOverlap(placed, item, 48)));
});

test('并发新增与完成后的比例变化保持同高，普通上传和历史导入仍用原避让', () => {
    const source = node('source', 'config', 0, 0), first = generated('first', 436, 0);
    const second = generated('second', 436, 0);
    const placed = layout.placeNewCanvasNodes([source], [source, first, second]);
    assert.equal(placed[1].position.y, 0);
    assert.equal(placed[2].position.y, 0);
    assert.equal(placed[2].position.x, 824);
    const expanded = { ...placed[1], width: 500, height: 400,
        position: { ...placed[1].position, y: -80 }, metadata: { ...first.metadata, status: 'success', content: 'saved' } };
    const completed = layout.placeNewCanvasNodes(placed, [source, expanded, placed[2]]);
    assert.equal(completed[1].position.y + completed[1].height / 2, 120);
    assert.equal(layout.nodesOverlap(completed[1], completed[2], 48), false);
    for (const imported of [node('upload', 'image', 436, 0), generated('old-import', 436, 0, 340, 240, 'success')]) {
        const regular = layout.placeNewCanvasNodes([source, first], [source, first, imported]).at(-1);
        assert.equal(regular.position.x, imported.position.x);
        assert.equal(regular.position.y, 288);
    }
});

test('只整理选中生成结果，按真实连线归位，不移动配置、其他图片或改写任务和媒体', () => {
    const a = node('a', 'config', 2162.89, 12388), b = node('b', 'config', 2162.89, 12976);
    const first = generated('first', 2614.89, 12676, 180, 240, 'success');
    const second = generated('second', 2534.89, 13277.75, 340, 212.5, 'success');
    const unrelated = node('manual', 'image', 4000, 12500);
    const nodes = [a, b, first, second, unrelated], before = structuredClone(nodes);
    const edges = [edge('a', 'first'), edge('b', 'second')], selected = new Set(['first', 'second']);
    const result = layoutCanvas(nodes, edges, selected);
    for (const [index, source] of [[2, a], [3, b]]) {
        assert.equal(result[index].position.y + result[index].height / 2, source.position.y + source.height / 2);
        assert.equal(result[index].metadata, nodes[index].metadata);
        assert.equal(result[index].width, nodes[index].width);
        assert.equal(result[index].height, nodes[index].height);
    }
    assert.equal(result[0], a); assert.equal(result[1], b); assert.equal(result[4], unrelated);
    assert.deepEqual(nodes, before);
    assert.equal(layoutCanvas(result, edges, selected), result);
});

test('选中结果归位遇障碍仍向右；多来源或有下游分支不能误认为独立生成结果', () => {
    const source = node('source', 'config', 0, 0), other = node('other', 'config', 0, 600);
    const output = generated('result', 436, 288, 180, 240, 'success');
    const blocker = node('blocker', 'text', 436, 0, 300, 240), nodes = [source, output, blocker, other];
    const edges = [edge('source', 'result')], selected = new Set(['result']);
    const result = layout.alignSelectedGeneratedResults(nodes, edges, selected);
    assert.equal(result[1].position.y, 0); assert.equal(result[1].position.x, 784);
    assert.equal(result[2], blocker);
    assert.equal(layout.alignSelectedGeneratedResults(nodes, [...edges, edge('other', 'result')], selected), undefined);
    assert.equal(layout.alignSelectedGeneratedResults(nodes, [...edges, edge('result', 'other')], selected), undefined);
    assert.equal(layout.alignSelectedGeneratedResults(nodes, edges, new Set(['blocker'])), undefined);
    assert.equal(layout.alignSelectedGeneratedResults(nodes.map(item => item.id === output.id
        ? { ...item, metadata: { ...item.metadata, groupId: 'unselected-group' } } : item), edges, selected), undefined);
});
