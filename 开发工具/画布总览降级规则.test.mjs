import test from 'node:test';
import assert from 'node:assert/strict';
import { canReuseCanvasNodeDuringZoom, canvasComplexityScore, canvasInteractionBudget, shouldFreezeCanvasNodeContent, shouldRenderCanvasNodeOverview, shouldUseCanvasInteractionShell, shouldUseCanvasOverview } from '../扩展功能/画布布局/画布总览降级规则.ts';

const node = { id: 'node-1', type: 'image', title: 'Image', position: { x: 0, y: 0 }, width: 200, height: 120 };
const eligible = { scale: 0.05, node, isSelected: false, isRelated: false, isFocusRelated: false,
  isConnectionTarget: false, isConnecting: false, showPanel: false, isEditing: false, batchExpanded: false };

test('only low zoom uses canvas overview mode', () => {
  assert.equal(shouldUseCanvasOverview(0.05), true);
  assert.equal(shouldUseCanvasOverview(0.08), true);
  assert.equal(shouldUseCanvasOverview(0.081), false);
  assert.equal(shouldUseCanvasOverview(0.4), false);
  assert.equal(shouldUseCanvasInteractionShell(0.1), true);
  assert.equal(shouldUseCanvasInteractionShell(0.2), false);
  assert.equal(shouldUseCanvasOverview(Number.NaN), false);
});

test('gesture content freezes only inactive nodes on dense canvases', () => {
  const base = { isInteracting: true, complexityScore: canvasComplexityScore({ nodeCount: 226, imageCount: 200, connectionCount: 100 }), isSelected: false, isRelated: false, isFocusRelated: false, isConnectionTarget: false, isConnecting: false, showPanel: false, isEditing: false };
  assert.equal(shouldFreezeCanvasNodeContent(base), true);
  assert.equal(shouldFreezeCanvasNodeContent({ ...base, complexityScore: canvasComplexityScore({ nodeCount: 9, imageCount: 4, connectionCount: 2 }) }), false);
  assert.equal(shouldFreezeCanvasNodeContent({ ...base, isSelected: true }), false);
});

test('complexity budget adapts to device capacity while preserving small canvases', () => {
  assert.ok(canvasInteractionBudget({ hardwareConcurrency: 8, deviceMemory: 16 }) > canvasInteractionBudget({ hardwareConcurrency: 2, deviceMemory: 4 }));
  assert.ok(canvasComplexityScore({ nodeCount: 226, imageCount: 200, connectionCount: 100 }) > canvasInteractionBudget({ hardwareConcurrency: 8, deviceMemory: 16 }));
});

test('zoom frames reuse node rendering except when crossing the overview boundary', () => {
  assert.equal(canReuseCanvasNodeDuringZoom(0.4, 0.2, true, true), true);
  assert.equal(canReuseCanvasNodeDuringZoom(0.05, 0.06, true, true), true);
  assert.equal(canReuseCanvasNodeDuringZoom(0.09, 0.07, true, true), false);
  assert.equal(canReuseCanvasNodeDuringZoom(0.4, 0.2, false, true), false);
  assert.equal(canReuseCanvasNodeDuringZoom(0.4, 0.2, true, false), false);
});

test('overview keeps active and semantically expanded nodes full fidelity', () => {
  assert.equal(shouldRenderCanvasNodeOverview(eligible), true);
  for (const patch of [
    { isSelected: true }, { isRelated: true }, { isFocusRelated: true },
    { isConnectionTarget: true }, { isConnecting: true }, { referenceSelectionState: 'target' },
    { showPanel: true }, { isEditing: true }, { batchExpanded: true },
    { node: { ...node, type: 'text' } }, { node: { ...node, type: 'group' } },
  ]) assert.equal(shouldRenderCanvasNodeOverview({ ...eligible, ...patch }), false);
  assert.equal(shouldRenderCanvasNodeOverview({ ...eligible, scale: 0.2 }), false);
});
