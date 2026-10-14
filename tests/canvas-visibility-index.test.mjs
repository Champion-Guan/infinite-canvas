import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from '../src/canvas/node_modules/typescript/lib/typescript.js';
const context = vm.createContext({ exports: {} });
vm.runInContext(ts.transpileModule(readFileSync(new URL('../src/canvas/lib/canvas/visibility-index.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
const { createVisibilityIndex } = context.exports;

test('indexed culling matches brute force across negative coordinates, long edges and extreme zoom', () => {
  const items = Array.from({ length: 3000 }, (_, i) => ({ left: (i % 60 - 30) * 450, top: (Math.floor(i / 60) - 25) * 370,
    right: (i % 60 - 30) * 450 + 320, bottom: (Math.floor(i / 60) - 25) * 370 + 220 }));
  items.push({ left: -1e7, top: 0, right: 1e7, bottom: 0 });
  let reads = 0;
  const query = createVisibilityIndex(items, item => { reads++; return item; });
  for (let i = 0; i < 100; i++) {
    const view = { left: -16000 + i * 300, right: -14000 + i * 300, top: -200, bottom: 1200 };
    const expected = items.filter(rect => rect.right > view.left && rect.left < view.right && rect.bottom > view.top && rect.top < view.bottom);
    assert.deepEqual(Array.from(query(view)), expected);
  }
  assert.equal(reads, items.length, 'geometry is not recomputed during camera changes');
  const wide = { left: -1e8, right: 1e8, top: -1e8, bottom: 1e8 };
  assert.deepEqual(Array.from(query(wide)), items);
  assert.equal(query(wide), query({ ...wide, left: wide.left + 1 }), 'unchanged membership retains array identity');
});

test('fresh geometry index reflects moved, removed and replaced nodes without retaining stale entries', () => {
  const old = { left: 0, top: 0, right: 100, bottom: 100 };
  const view = { left: -1, top: -1, right: 101, bottom: 101 };
  assert.equal(createVisibilityIndex([old], item => item)(view)[0], old);
  const moved = { ...old, left: 3000, right: 3100 };
  assert.equal(createVisibilityIndex([moved], item => item)(view).length, 0);
  assert.equal(createVisibilityIndex([], item => item)(view).length, 0);
  const replacement = { ...old };
  assert.equal(createVisibilityIndex([replacement], item => item)(view)[0], replacement);
});
