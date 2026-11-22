import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from '../node_modules/typescript/lib/typescript.js';

function functions(file, names, globals = {}) {
  const source = readFileSync(new URL('../src/canvas/' + file, import.meta.url), 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const selected = ast.statements.filter(s => ts.isFunctionDeclaration(s) && names.includes(s.name?.text));
  assert.equal(selected.length, names.length);
  const code = selected.map(s => s.getText(ast).replace(/^export /, '')).join('\n');
  const context = vm.createContext(globals);
  vm.runInContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return context;
}
const model = functions('stores/use-config-store.ts', ['decodeChannelModel', 'findChannelModel', 'modelCapabilityOf', 'resolveModelForCapability', 'isAiConfigReady'], {
  CHANNEL_MODEL_SEPARATOR: '::', FALLBACK_MODEL_OPTION: '__fallback__',
  defaultConfig: { imageModel: 'default-image', videoModel: 'default-video', textModel: 'default-text', audioModel: 'default-audio' },
  resolveFallbackModel: () => 'replacement::video-b',
});
const config = { videoModel: 'replacement::video-b', channels: [{ id: 'replacement', baseUrl: 'https://example.invalid', apiKey: 'fixture', models: [{ name: 'video-b', capability: 'video' }, { name: 'image-a', capability: 'image' }] }] };
test('upstream 0.20 preserves unavailable models and blocks retries on removed providers', () => {
  for (const capability of ['image', 'video', 'text', 'audio']) {
    const selected = 'removed::' + capability;
    assert.equal(model.resolveModelForCapability(config, selected, capability), selected);
    assert.equal(model.isAiConfigReady(config, selected), false);
  }
  assert.equal(model.isAiConfigReady(config, 'replacement::deleted-video'), false);
  assert.equal(model.resolveModelForCapability({ ...config, videoModel: 'removed::video' }, undefined, 'video'), 'removed::video');
});
test('capability changes and explicit Fallback remain supported without changing saved requests', () => {
  assert.equal(model.resolveModelForCapability(config, 'replacement::image-a', 'video'), 'replacement::video-b');
  assert.equal(model.resolveModelForCapability(config, '__fallback__', 'video'), 'replacement::video-b');
  assert.equal(model.isAiConfigReady(config, 'replacement::video-b'), true);
  assert.equal(model.isAiConfigReady({ ...config, channels: [{ ...config.channels[0], apiKey: '' }] }, 'replacement::video-b'), false);
});
const geometry = functions('lib/canvas/canvas-node-geometry.ts', ['focusViewportForNode']);
test('focus centers nodes and respects the floating panel and bottom dock', () => {
  const node = { position: { x: 1234, y: -567 }, width: 340, height: 240 }, size = { width: 900, height: 700 };
  const view = geometry.focusViewportForNode(node, size);
  assert.equal(view.x + (node.position.x + node.width / 2) * view.k, size.width / 2);
  assert.equal(view.y + (node.position.y + node.height / 2) * view.k, size.height / 2);
  const panel = geometry.focusViewportForNode(node, size, { below: 316, bottomInset: 76 });
  const top = panel.y + node.position.y * panel.k, bottom = panel.y + (node.position.y + node.height) * panel.k + 316;
  assert.ok(bottom <= 624);
  assert.ok(Math.abs(624 - bottom - top / 3) < 1e-8);
  assert.equal(geometry.focusViewportForNode({ ...node, width: 20000, height: 20000 }, size).k, 0.05);
});
const stableFocus = functions('../../扩展功能/画布交互/保持缩放聚焦.ts', ['centerCanvasNodeAtScale'], {});
test('automatic node focus preserves the current zoom while reserving panel space', () => {
  const node = { position: { x: 1234, y: -567 }, width: 340, height: 240 }, size = { width: 900, height: 700 }, scale = 1.2;
  const view = stableFocus.centerCanvasNodeAtScale(node, size, { below: 316, bottomInset: 76 }, scale);
  assert.equal(view.k, scale);
  assert.equal(view.x + (node.position.x + node.width / 2) * view.k, size.width / 2);
  const top = view.y + node.position.y * scale, bottom = view.y + (node.position.y + node.height) * scale + 316;
  assert.ok(bottom <= 624);
  assert.ok(Math.abs(624 - bottom - top / 3) < 1e-8);
});
test('card selection requests focus without fitting the current zoom', () => {
  const patch = readFileSync(new URL('../上游适配/卡片点击时捕获倍率.patch', import.meta.url), 'utf8');
  assert.match(patch, /\+\s*requestAnimationFrame\(\(\) => focusNodeRef\.current\(clickedNodeId, \{ preserveScale: true \}\)\);/);
  assert.match(patch, /centerCanvasNodeAtScale\(node, size, frame, options\.scale \?\? viewportRef\.current\.k\)/);
});
test('card auto-focus uses the zoom captured when the click began', () => {
  const patch = readFileSync(new URL('../上游适配/卡片聚焦使用按下时倍率.patch', import.meta.url), 'utf8');
  assert.match(patch, /\+\s*const clickScaleRef = useRef\(1\);/);
  assert.match(patch, /\+\s*clickScaleRef\.current = viewportRef\.current\.k;/);
  assert.match(patch, /\+\s*requestAnimationFrame\(\(\) => focusNodeRef\.current\(clickedNodeId, \{ preserveScale: true, scale: clickScaleRef\.current \}\)\);/);
});
test('mouse focus on a canvas node cannot trigger a competing zoom-to-fit before selection', () => {
  const patch = readFileSync(new URL('../上游适配/鼠标点击节点跳过焦点自动聚焦.patch', import.meta.url), 'utf8');
  assert.match(patch, /\+\s*if \(performance\.now\(\) < pointerFocusUntilRef\.current\) return;/);
  assert.match(patch, /\+\s*pointerFocusUntilRef\.current = performance\.now\(\) \+ 250;/);
});
test('slow canvas clicks keep the pointer-focus guard active through delayed rendering', () => {
  const patch = readFileSync(new URL('../上游适配/鼠标点击聚焦延迟保护.patch', import.meta.url), 'utf8');
  assert.match(patch, /-\s*pointerFocusUntilRef\.current = performance\.now\(\) \+ 250;/);
  assert.match(patch, /\+\s*pointerFocusUntilRef\.current = performance\.now\(\) \+ 1500;/);
});
