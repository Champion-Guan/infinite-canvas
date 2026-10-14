import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import ts from '../src/canvas/node_modules/typescript/lib/typescript.js';

test('Agent bridge reads live viewport, publishes once after movement and retains business updates', () => {
  const source = readFileSync(new URL('../src/canvas/pages/canvas/hooks/use-agent-bridge.ts', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('bridge.ts', source, ts.ScriptTarget.Latest, true);
  const body = ast.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(ast)).join('\n');
  const slots = [], writes = [], effects = []; let cursor = 0;
  const equal = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const memo = (make, deps) => {
    const id = cursor++;
    if (!slots[id] || !equal(slots[id].deps, deps)) slots[id] = { deps, value: make() };
    return slots[id].value;
  };
  const setCanvasContext = value => writes.push(value);
  const ctx = vm.createContext({
    exports: {}, i18n: { t: () => 'Untitled' },
    useAgentStore: selector => selector({ setCanvasContext }),
    useState: initial => [memo(() => initial, []), () => {}],
    useMemo: memo, useCallback: (callback, deps) => memo(() => callback, deps),
    useEffect: (effect, deps) => {
      const id = cursor++;
      if (!slots[id] || !equal(slots[id].deps, deps)) {
        const old = slots[id];
        effects.push(() => { old?.cleanup?.(); slots[id] = { deps, cleanup: effect() }; });
      }
    },
  });
  vm.runInContext(ts.transpileModule(body, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, ctx);
  const ref = current => ({ current });
  const params = {
    projectId: 'fixture', title: 'Fixture', nodes: [], connections: [], selectedNodeIds: new Set(), viewportMoving: false,
    nodesRef: ref([]), connectionsRef: ref([]), selectedNodeIdsRef: ref(new Set()), viewportRef: ref({ x: 0, y: 0, k: 1 }), generateNodeRef: ref(null),
  };
  const render = () => { cursor = 0; ctx.exports.useAgentBridge(params); effects.splice(0).forEach(effect => effect()); };
  render(); assert.equal(writes.length, 1);
  const snapshot = writes[0].snapshot;
  params.viewportMoving = true; render();
  for (let frame = 1; frame <= 60; frame++) {
    params.viewportRef.current = { x: frame * 7, y: frame, k: 0.05 }; render();
  }
  assert.equal(writes.length, 1);
  assert.equal(snapshot.viewport.x, 420);
  assert.equal(JSON.parse(JSON.stringify(snapshot)).viewport.k, 0.05);
  params.viewportMoving = false; render();
  assert.equal(writes.length, 2); assert.equal(writes[1].snapshot.viewport.x, 420);
  params.nodes = [{ id: 'new-node' }]; render();
  assert.equal(writes.length, 3); assert.equal(writes[2].snapshot.nodes[0].id, 'new-node');
  slots.forEach(slot => slot?.cleanup?.());
  assert.equal(writes.at(-1), null);
});
