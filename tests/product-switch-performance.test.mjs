import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import ts from '../src/canvas/node_modules/typescript/lib/typescript.js';
import * as helpers from '../src/shared/data-contract/workbook-canvas-products.js';

const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
function fixture() {
    const values = new Map(), writes = [];
    const context = vm.createContext({ ...helpers, crypto: webcrypto, window: new EventTarget(),
        CustomEvent: class extends Event { constructor(type, input) { super(type); this.detail = input.detail; } },
        localStorage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => { writes.push(key); values.set(key, value); }, removeItem: key => values.delete(key) } });
    const source = read('src/shared/data-contract/index.js').replace(/^import .*?;\s*/gm, '');
    const api = vm.runInContext(source.slice(0, source.indexOf('window.GuanWorkbenchData = api;')) + '; api', context);
    api.importPromptProducts({ fileName: 'switch.xlsx', sheetName: 'Prompts', promptTemplates: ['One', 'Two'].map((route, index) => ({ id: route, route, order: index, sourceRowNumber: index + 2, prompts: { 'Main Prompt': 'Keep [NAME]' } })) });
    return { api, context, values, writes };
}

test('capsule navigation changes selection without rewriting workbook and keeps legacy readers consistent', () => {
    const { api, values, writes } = fixture();
    const before = api.getState(), key = api.storageKey, original = values.get(key);
    const [one, two] = before.products.map(product => product.id);
    api.getActiveCanvasProduct(); // warm read-only snapshot
    writes.length = 0;
    for (let index = 0; index < 100; index++) {
        const id = index % 2 ? one : two;
        api.selectCanvasProduct(id);
        assert.equal(api.getActiveCanvasProduct().id, id);
    }
    assert.equal(values.get(key), original);
    assert.ok(writes.every(key => key.startsWith('guan-workbook-active-canvas:')));
    api.selectCanvasProduct(two);
    assert.equal(api.getState().workspace.activeProductId, two);
    assert.deepEqual(api.getState().products, before.products);
    assert.deepEqual(api.getState().tasks, before.tasks);
    assert.throws(() => api.selectCanvasProduct('foreign-product'));
});

test('navigation snapshot invalidates on real edits, cross-window changes and corrupt storage', () => {
    const { api, values } = fixture();
    const state = api.getState(), id = state.products[0].id;
    api.getActiveCanvasProduct();
    state.products[0].identity.titleZh = 'Renamed';
    api.saveState(state);
    api.selectCanvasProduct(id);
    assert.equal(api.getActiveCanvasProduct().identity.titleZh, 'Renamed');
    const external = JSON.parse(values.get(api.storageKey));
    external.products[0].identity.titleZh = 'Another window';
    values.set(api.storageKey, JSON.stringify(external));
    assert.equal(api.getActiveCanvasProduct().identity.titleZh, 'Another window');
    values.set(api.storageKey, '{bad');
    assert.throws(() => api.getActiveCanvasProduct());
    assert.equal(values.get(api.storageKey), '{bad');
});

test('hidden cached frame media rests without touching task or storage services; foreign messages cannot change it', () => {
    const listeners = new Map(), media = { paused: false, ended: false, isConnected: true, pauses: 0, plays: 0,
        pause() { this.paused = true; this.pauses++; }, play() { this.paused = false; this.plays++; return Promise.resolve(); } };
    const parent = {}, document = { documentElement: { dataset: {} }, body: {}, querySelectorAll: () => [media],
        addEventListener() {}, removeEventListener() {} };
    const context = vm.createContext({ exports: {}, document, location: { origin: 'http://qa' },
        window: { parent, frameElement: { dataset: { active: 'true' } }, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) },
        MutationObserver: class { observe() {} disconnect() {} } });
    vm.runInContext(ts.transpileModule(read('src/canvas/services/canvas-visibility.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
    const dispose = context.exports.startCanvasVisibility(), receive = listeners.get('message');
    receive({ source: {}, origin: 'http://qa', data: { type: 'guan-canvas-visibility', visible: false } });
    assert.equal(media.pauses, 0);
    receive({ source: parent, origin: 'http://qa', data: { type: 'guan-canvas-visibility', visible: false } });
    assert.equal(media.pauses, 1);
    receive({ source: parent, origin: 'http://qa', data: { type: 'guan-canvas-visibility', visible: true } });
    assert.equal(media.plays, 1);
    dispose(); assert.equal(listeners.size, 0);
});
