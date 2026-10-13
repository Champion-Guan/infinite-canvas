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
test('large or zoomed-out pans checkpoint before exhausting 280 world-pixel culling overscan', () => {
  for (const k of [0.05, 0.5, 1, 5]) {
    const f = fixture(k); f.scheduler.move({ x: 141 * k, y: 0, k }); f.tick(16);
    assert.equal(f.committed.length, 1); assert.equal(f.committed[0].x / k, 141);
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
