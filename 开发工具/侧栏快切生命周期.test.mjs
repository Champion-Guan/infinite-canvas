import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../.运行/3100源/画布副本/web/package.json', import.meta.url));
const ts = require('typescript');

function load(t) {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const writes = [];
    const values = new Map();
    const preferences = { getItem: key => values.get(key) ?? null, setItem(key, value) { values.set(key, value); writes.push([key, value]); } };
    const source = readFileSync(new URL('../.运行/3100源/画布副本/web/src/stores/use-canvas-side-panel-store.ts', import.meta.url), 'utf8');
    const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const module = { exports: {} };
    new Function('require', 'module', 'exports', 'window', javascript)(id => id.includes('上游浏览器存储桥') ? { sqlitePreferences: preferences } : require(id), module, module.exports, {});
    return { store: module.exports.useCanvasSidePanelStore, duration: module.exports.CANVAS_SIDE_PANEL_MOTION_MS, writes };
}

test('真实侧栏状态库：关开关时旧定时器不能提前卸载最后一次关闭动画', t => {
    const { store, duration } = load(t);
    store.getState().closePanel();
    t.mock.timers.tick(120);
    store.getState().openPanel();
    t.mock.timers.tick(40);
    store.getState().closePanel();
    t.mock.timers.tick(duration - 160);
    assert.equal(store.getState().panelMounted, true);
    assert.equal(store.getState().panelClosing, true);
    t.mock.timers.tick(159);
    assert.equal(store.getState().panelMounted, true);
    t.mock.timers.tick(1);
    assert.equal(store.getState().panelMounted, false);
    assert.equal(store.getState().panelClosing, false);
});

test('真实侧栏状态库：重开取消卸载，重复打开不保存相同偏好', t => {
    const { store, duration, writes } = load(t);
    store.getState().openPanel();
    assert.equal(writes.length, 0);
    store.getState().closePanel();
    t.mock.timers.tick(80);
    store.getState().openPanel();
    for (let i = 0; i < 20; i++) store.getState().openPanel();
    t.mock.timers.tick(duration * 2);
    assert.equal(store.getState().panelOpen, true);
    assert.equal(store.getState().panelMounted, true);
    assert.equal(store.getState().panelClosing, false);
    assert.deepEqual(writes, [['canvas-side-panel-open', '0'], ['canvas-side-panel-open', '1']]);
});

test('真实侧栏状态库：连续快速切换以最后一次操作为准', t => {
    const { store, duration } = load(t);
    for (let i = 0; i < 21; i++) {
        store.getState().togglePanel();
        t.mock.timers.tick(8);
    }
    assert.equal(store.getState().panelOpen, false);
    t.mock.timers.tick(duration);
    assert.equal(store.getState().panelMounted, false);
    store.getState().openPanel();
    t.mock.timers.tick(duration);
    assert.equal(store.getState().panelMounted, true);
});
