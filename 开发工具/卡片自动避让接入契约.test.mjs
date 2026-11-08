import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformWithEsbuild } from '../.运行/3100源/画布副本/web/node_modules/vite/dist/node/index.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
async function loadLayout() {
  const file = resolve(root, '扩展功能/画布布局/卡片自动避让.ts');
  const { code } = await transformWithEsbuild(readFileSync(file, 'utf8'), file, { loader: 'ts', format: 'cjs', target: 'es2022', tsconfigRaw: '{}' });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(id => {
    if (id === '@/types/canvas') return {};
    throw Error('意外依赖：' + id);
  }, module, module.exports);
  return module.exports;
}
const layout = await loadLayout();
const card = (id, x = 0, y = 0, type = 'config') => ({ id, type, title: id, position: { x, y }, width: 340, height: 240, metadata: {} });

test('同高直线和宽间距保持原位；错位或被障碍迫使绕行的单线收紧到一条水平连线', () => {
  const source = card('source'), target = card('target', 900, 320);
  const arranged = layout.arrangeOverlappingCanvasNodes([source, target], [{ id: 'edge', fromNodeId: 'source', toNodeId: 'target' }]);
  assert.deepEqual(arranged[0].position, { x: 0, y: 0 });
  assert.deepEqual(arranged[1].position, { x: 388, y: 0 });
  const already = layout.arrangeOverlappingCanvasNodes(arranged, [{ id: 'edge', fromNodeId: 'source', toNodeId: 'target' }]);
  assert.equal(already, arranged);
  const wideSource = card('wide-source');
  const wideTarget = card('wide-target', 1200);
  const wideNodes = [wideSource, wideTarget];
  const wide = layout.arrangeOverlappingCanvasNodes(wideNodes, [{ id: 'wide', fromNodeId: 'wide-source', toNodeId: 'wide-target' }]);
  assert.equal(wide, wideNodes);
  const narrowNodes = [card('narrow-source'), card('narrow-target', 360)];
  assert.equal(layout.arrangeOverlappingCanvasNodes(narrowNodes, [{ id: 'narrow', fromNodeId: 'narrow-source', toNodeId: 'narrow-target' }]), narrowNodes, '窄间距的现有水平直连也不移动');
});

test('分支或汇入节点及其直接关联卡片不会因连线整理而移动', () => {
  const nodes = [card('a'), card('b', 0, 500), card('join', 900, 300), card('out-a', 1400), card('out-b', 1400, 500)];
  const connections = [
    { id: 'in-a', fromNodeId: 'a', toNodeId: 'join' }, { id: 'in-b', fromNodeId: 'b', toNodeId: 'join' },
    { id: 'out-a', fromNodeId: 'join', toNodeId: 'out-a' }, { id: 'out-b', fromNodeId: 'join', toNodeId: 'out-b' },
  ];
  const arranged = layout.arrangeOverlappingCanvasNodes(nodes, connections);
  for (const node of nodes) assert.deepEqual(arranged.find(item => item.id === node.id).position, node.position);
});

test('候选并排位置被普通卡片阻挡时跳过，不制造覆盖', () => {
  const nodes = [card('source'), card('target', 900, 320), card('blocker', 388, 0), card('blocker-source', 512, 320)];
  assert.equal(layout.arrangeOverlappingCanvasNodes(nodes, [{ id: 'edge', fromNodeId: 'source', toNodeId: 'target' }]), nodes);
});

test('单线当前直线路径被阻挡时压缩到无遮挡的并排位置', () => {
  const source = card('source');
  const target = card('target', 1500);
  const blocker = { ...card('blocker', 900), width: 100 };
  const arranged = layout.arrangeOverlappingCanvasNodes([source, target, blocker], [{ id: 'edge', fromNodeId: 'source', toNodeId: 'target' }]);
  assert.deepEqual(arranged.find(node => node.id === 'target').position, { x: 388, y: 0 });
  assert.equal(layout.nodesOverlap(arranged.find(node => node.id === 'target'), blocker), false);
});

test('配置左侧汇入保持原位，右侧独立的单线结果仍可精确同高', () => {
  const prompt = card('prompt', -500, -300), reference = card('reference', -500, 300);
  const source = card('config'), target = { ...card('result', 900, 50), height: 360 };
  const nodes = [prompt, reference, source, target];
  const edges = [
    { id: 'prompt-config', fromNodeId: 'prompt', toNodeId: 'config' },
    { id: 'reference-config', fromNodeId: 'reference', toNodeId: 'config' },
    { id: 'config-result', fromNodeId: 'config', toNodeId: 'result' },
  ];
  const snapshot = structuredClone(nodes);
  const arranged = layout.arrangeOverlappingCanvasNodes(nodes, edges);
  for (const fixed of [prompt, reference, source]) assert.equal(arranged.find(node => node.id === fixed.id), fixed);
  assert.deepEqual(arranged[3].position, { x: 388, y: -60 });
  assert.equal(arranged[3].metadata, target.metadata);
  assert.deepEqual(nodes, snapshot);
  assert.equal(layout.arrangeOverlappingCanvasNodes(arranged, edges), arranged);
});

test('单线串联不把一入一出误判为分支，逆序关系数组也一次排齐', () => {
  const nodes = [card('a'), card('b', 900, 300), card('c', 1800, 600)];
  const edges = [{ id: 'same-id', fromNodeId: 'b', toNodeId: 'c' }, { id: 'same-id', fromNodeId: 'a', toNodeId: 'b' }];
  const arranged = layout.arrangeOverlappingCanvasNodes(nodes, edges);
  assert.deepEqual(arranged.map(node => node.position), [{ x: 0, y: 0 }, { x: 388, y: 0 }, { x: 776, y: 0 }]);
  assert.equal(layout.arrangeOverlappingCanvasNodes(arranged, edges), arranged);
});

test('闭环与自连保持原位，不造成每次整理不断右移', () => {
  const nodes = [card('a'), card('b', 900, 300)];
  const edges = [{ id: 'ab', fromNodeId: 'a', toNodeId: 'b' }, { id: 'ba', fromNodeId: 'b', toNodeId: 'a' }];
  assert.equal(layout.arrangeOverlappingCanvasNodes(nodes, edges), nodes);
  const single = [card('self')];
  assert.equal(layout.arrangeOverlappingCanvasNodes(single, [{ id: 'self', fromNodeId: 'self', toNodeId: 'self' }]), single);
});

test('菜单命名补丁与底部说明补丁都使用“整理卡片”', () => {
  const menuPatch = readFileSync(resolve(root, '上游适配/整理卡片菜单命名.patch'), 'utf8');
  const tipPatch = readFileSync(resolve(root, '上游适配/整理卡片底部提示命名.patch'), 'utf8');
  assert.match(menuPatch, /整理重叠卡片（可撤销）/);
  assert.match(menuPatch, /整理卡片（可撤销）/);
  assert.match(tipPatch, /整理重叠卡片 · 可撤销/);
  assert.match(tipPatch, /整理卡片 · 可撤销/);
});
