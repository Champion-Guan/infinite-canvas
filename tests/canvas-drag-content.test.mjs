import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import ts from '../src/canvas/node_modules/typescript/lib/typescript.js';

const source = readFileSync(new URL('../src/canvas/lib/canvas/canvas-content-snapshot.ts', import.meta.url), 'utf8');
const context = vm.createContext({ exports: {} });
vm.runInContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
const snapshot = context.exports.canvasContentSnapshot;
const node = () => ({ id: 'one', type: 'text', title: 'Prompt', position: { x: 0, y: 0 }, width: 200, height: 100, metadata: { content: 'original' } });

test('position-only drag retains business inputs while geometry remains current', () => {
    const original = [node()];
    const moved = [{ ...original[0], position: { x: 300, y: 200 } }];
    assert.equal(snapshot(original, moved), original);
    assert.equal(moved[0].position.x, 300);
    assert.equal(snapshot(original, moved)[0].metadata.content, 'original');
});

test('generation completion, prompt edits, grouping, resize, order and membership invalidate cached inputs', () => {
    const original = [node()];
    for (const patch of [{ metadata: { content: 'generated', status: 'success' } }, { title: 'renamed' }, { type: 'image' }, { width: 400 }, { height: 300 }, { metadata: { ...original[0].metadata, groupId: 'group' } }]) {
        const next = [{ ...original[0], ...patch }];
        assert.equal(snapshot(original, next), next);
    }
    const extra = { ...node(), id: 'two' };
    const added = [...original, extra];
    assert.equal(snapshot(original, added), added);
    const reordered = [extra, original[0]];
    assert.equal(snapshot(added, reordered), reordered);
    const removed = [];
    assert.equal(snapshot(original, removed), removed);
});

test('custom plugin resource callbacks retain current positions', () => {
    const original = [{ ...node(), type: 'plugin:resource' }];
    const moved = [{ ...original[0], position: { x: 50, y: 20 } }];
    assert.equal(snapshot(original, moved), moved);
});

test('owned parameter-card drag retains prompt/status inputs, while parameter changes invalidate them', () => {
    const original = [{ ...node(), type: 'guan:prompt-variables', metadata: { promptVariableValues: { '[SIZE]': '900x1200' } } }];
    const moved = [{ ...original[0], position: { x: 800, y: 300 } }];
    assert.equal(snapshot(original, moved), original);
    const edited = [{ ...moved[0], metadata: { promptVariableValues: { '[SIZE]': '800x500' } } }];
    assert.equal(snapshot(original, edited), edited);
});

test('actual drag callback coalesces burst input to the newest scaled coordinates without placement', () => {
    const page = readFileSync(new URL('../src/canvas/pages/canvas/project.tsx', import.meta.url), 'utf8');
    const ast = ts.createSourceFile('project.tsx', page, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let callback;
    function visit(n) {
        if (ts.isVariableDeclaration(n) && n.name.getText(ast) === 'handleGlobalMouseMove') callback = n.initializer.arguments[0];
        ts.forEachChild(n, visit);
    }
    visit(ast);
    const pending = [], writes = [], original = [node()];
    const drag = { isDraggingNode: true, hasMoved: false, startX: 10, startY: 20, initialSelectedNodes: new Map([['one', { x: 0, y: 0 }]]), movedIds: new Set(['one']) };
    const bindings = { viewportRef: { current: { k: 0.5 } }, dragRef: { current: drag }, dragPointerRef: { current: null }, rafRef: { current: null },
        nodesRef: { current: original }, dragDropTargetRef: { current: null }, findGroupDropTarget: () => null,
        setDropTargetGroupId: () => assert.fail('unchanged target must not render'), setRawNodes: n => writes.push(n),
        requestAnimationFrame: fn => { pending.push(fn); return pending.length; }, connectingParamsRef: { current: null } };
    const ctx = vm.createContext(bindings);
    vm.runInContext(ts.transpileModule('globalThis.move = ' + callback.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, ctx);
    for (let i = 1; i <= 100; i++) ctx.move({ clientX: 10 + i, clientY: 20 + i });
    assert.equal(pending.length, 1);
    assert.equal(writes.length, 0);
    pending[0]();
    assert.equal(writes.length, 1);
    assert.equal(writes[0][0].position.x, 200);
    assert.equal(writes[0][0].position.y, 200);
    assert.equal(bindings.rafRef.current, null);
    ctx.move({ clientX: 150, clientY: 160 });
    assert.equal(pending.length, 2);
    drag.isDraggingNode = false;
    pending[1]();
    assert.equal(writes.length, 1);
});
