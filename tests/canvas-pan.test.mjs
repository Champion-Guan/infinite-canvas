import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import ts from '../src/canvas/node_modules/typescript/lib/typescript.js';
const context = vm.createContext({ exports: {} });
vm.runInContext(ts.transpileModule(readFileSync(new URL('../src/canvas/lib/canvas/canvas-pan-scheduler.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, context);
function fixture(k = 1, extent) {
  const pending = new Map(), painted = [], committed = []; let clock = 0, id = 0;
  const scheduler = context.exports.createCanvasPanScheduler({
    paint: v => painted.push(v), commit: v => committed.push(v), now: () => clock, extent,
    frame: cb => { pending.set(++id, cb); return id; }, cancel: n => pending.delete(n),
  });
  scheduler.begin({ x: 0, y: 0, k });
  return { scheduler, painted, committed, pending, tick(at) { clock = at; const jobs = [...pending.values()]; pending.clear(); jobs.forEach(fn => fn()); } };
}
test('pointer bursts paint only newest coordinates and do not render the scene every frame', () => {
  const f = fixture();
  for (let i = 1; i <= 100; i++) f.scheduler.move({ x: i, y: i / 2, k: 1 });
  assert.equal(f.pending.size, 1); f.tick(16);
  assert.equal(f.painted.length, 1); assert.equal(f.painted[0].x, 100); assert.equal(f.committed.length, 0);
  f.scheduler.move({ x: 110, y: 55, k: 1 }); f.tick(80);
  assert.equal(f.painted.length, 2); assert.equal(f.committed.length, 1); assert.equal(f.committed[0].x, 110);
});
test('large pans checkpoint before exhausting 280 screen-pixel culling overscan at any scale', () => {
  for (const k of [0.05, 0.5, 1, 5]) {
    const f = fixture(k); f.scheduler.move({ x: 141, y: 0, k }); f.tick(16);
    assert.equal(f.committed.length, 1); assert.equal(f.committed[0].x, 141);
  }
});

test('zoomed-out pan no longer commits every frame for seven screen pixels of travel', () => {
  for (const k of [0.05, 0.1, 1]) {
    const f = fixture(k, () => ({ width: 1200, height: 800 }));
    for (let i = 1; i <= 60; i++) { f.scheduler.move({ x: i * 7, y: 0, k }); f.tick(i * 16); }
    f.scheduler.flush();
    assert.equal(f.painted.length, 61);
    assert.equal(f.committed.length, 12);
    assert.equal(f.committed.at(-1).x, 420);
  }
});
test('smooth 60-frame pan paints all frames with only 12 scene commits', () => {
  const f = fixture();
  for (let i = 1; i <= 60; i++) { f.scheduler.move({ x: i * 2, y: 0, k: 1 }); f.tick(i * 16); }
  f.scheduler.flush();
  assert.equal(f.committed.length, 12); assert.equal(f.committed.at(-1).x, 120);
  assert.equal(f.painted.length, 61);
});
test('pointerup/blur flush the last frame immediately and leave no late overwrite', () => {
  const f = fixture(); f.scheduler.move({ x: 20, y: 30, k: 1 });
  const final = f.scheduler.flush(); assert.equal(final.x, 20); assert.equal(f.pending.size, 0);
  assert.equal(f.committed.length, 1); f.tick(100); assert.equal(f.committed.length, 1);
  f.scheduler.flush(); assert.equal(f.committed.length, 1);
});
test('new drag starts from committed coordinates, and unmount cancels pending work without writing', () => {
  const f = fixture(); f.scheduler.move({ x: 20, y: 30, k: 1 });
  f.scheduler.begin({ x: 50, y: 60, k: 2 }); assert.equal(f.pending.size, 0);
  f.scheduler.move({ x: 55, y: 66, k: 2 }); f.scheduler.flush();
  assert.equal(f.committed[0].x, 55); assert.equal(f.committed[0].k, 2);
  f.scheduler.move({ x: 80, y: 90, k: 2 }); f.scheduler.dispose(); f.tick(150);
  assert.equal(f.committed.length, 1); assert.equal(f.scheduler.latest, null);
});

test('small anchored zoom bursts paint without committing each scale change, large zoom reculls before overscan', () => {
  const f = fixture(1, () => ({ width: 1200, height: 800 }));
  for (let i = 1; i <= 4; i++) {
    const k = 1 + i * 0.01;
    f.scheduler.move({ x: 600 - 600 * k, y: 400 - 400 * k, k }); f.tick(i * 16);
  }
  assert.equal(f.painted.length, 4); assert.equal(f.committed.length, 0);
  f.scheduler.move({ x: 300, y: 200, k: 0.5 }); f.tick(70);
  assert.equal(f.committed.length, 1); assert.equal(f.committed[0].k, 0.5);
  f.scheduler.flush(); assert.equal(f.pending.size, 0);
});

test('actual focus animation uses scheduled painting and commits its exact final viewport', () => {
  const source = readFileSync(new URL('../src/canvas/pages/canvas/project.tsx', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('project.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'focusNode') callback = node.initializer.arguments[0];
    ts.forEachChild(node, visit);
  }
  visit(ast); assert.ok(callback);
  const f = fixture(1, () => ({ width: 1200, height: 800 }));
  const target = { x: 500, y: 240, k: 0.8 }, focusAnimRef = { current: null };
  const refs = { viewportRef: { current: { x: 0, y: 0, k: 1 } }, focusAnimRef };
  let seq = 1000;
  const controller = { begin: v => f.scheduler.begin(v), move: v => f.scheduler.move(v), finish: () => f.scheduler.flush() };
  const ctx = vm.createContext({
    ...refs, nodesRef: { current: [{ id: 'fixture' }] }, size: { width: 1200, height: 800 }, containerRef: { current: null },
    viewportControllerRef: { current: controller },
    setHoverPreviewNodeId() {}, setSelectedNodeIds() {}, setSelectedConnectionId() {}, setContextMenu() {},
    focusViewportForNode: () => target, measureFocusFrame() {},
    requestAnimationFrame: cb => { const id = ++seq; f.pending.set(id, () => cb(clock)); return id; },
    cancelAnimationFrame: id => f.pending.delete(id),
    setViewport: () => assert.fail('focus must not directly update React each frame'),
  });
  let clock = 0;
  vm.runInContext(ts.transpileModule('globalThis.focus = ' + callback.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, ctx);
  ctx.focus('fixture');
  for (clock = 16; clock <= 512; clock += 16) f.tick(clock);
  assert.equal(focusAnimRef.current, null);
  assert.ok(f.committed.length < 15);
  assert.equal(f.committed.at(-1).x, target.x);
  assert.equal(f.committed.at(-1).y, target.y);
  assert.equal(f.committed.at(-1).k, target.k);
  assert.equal(f.pending.size, 0);
});

test('actual viewport controller finishes pending movement once and rejects late animation frames', () => {
  const source = readFileSync(new URL('../src/canvas/components/canvas/infinite-canvas.tsx', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('infinite-canvas.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let install;
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useLayoutEffect'
      && node.arguments[0]?.getText(ast).includes('const controller: CanvasViewportController')) install = node.arguments[0];
    ts.forEachChild(node, visit);
  }
  visit(ast); assert.ok(install);
  const f = fixture(), viewportControllerRef = { current: null }, moving = [];
  const ctx = vm.createContext({ viewportControllerRef, schedulerRef: { current: f.scheduler },
    zoomTimerRef: { current: null }, zoomingRef: { current: false }, panState: { current: { isPanning: false } },
    controlledRef: { current: false }, setIsPanning: value => moving.push(value),
    callbacksRef: { current: {} }, clearTimeout() {},
  });
  vm.runInContext(ts.transpileModule('globalThis.install = ' + install.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, ctx);
  const cleanup = ctx.install(), controller = viewportControllerRef.current;
  controller.begin({ x: 0, y: 0, k: 1 });
  controller.move({ x: 25, y: 40, k: 1 });
  controller.finish(); controller.finish();
  controller.move({ x: 999, y: 999, k: 1 }); f.tick(100);
  assert.equal(f.committed.length, 1); assert.equal(f.committed[0].x, 25);
  assert.deepEqual(moving, [true, false]); assert.equal(f.pending.size, 0);
  cleanup(); assert.equal(viewportControllerRef.current, null);
});
