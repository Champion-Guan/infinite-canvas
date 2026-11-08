import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../.运行/3100源/画布副本/web/package.json', import.meta.url));
const ts = require('typescript');

function load() {
    const writes = [];
    const values = new Map();
    const preferences = { getItem: key => values.get(key) ?? null, setItem(key, value) { values.set(key, value); writes.push([key, value]); } };
    const source = readFileSync(new URL('../.运行/3100源/画布副本/web/src/stores/use-canvas-side-panel-store.ts', import.meta.url), 'utf8');
    const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const module = { exports: {} };
    new Function('require', 'module', 'exports', 'window', 'setTimeout', javascript)(id => id.includes('上游浏览器存储桥') ? { sqlitePreferences: preferences } : require(id), module, module.exports, {}, () => assert.fail('侧栏不能用固定时长决定卸载'));
    return { store: module.exports.useCanvasSidePanelStore, writes };
}

test('真实侧栏关开关：旧完成回调不能卸载最后一次关闭，真实完成后才卸载', () => {
    const { store } = load();
    store.getState().closePanel();
    const old = store.getState().panelCloseRevision;
    store.getState().openPanel();
    store.getState().closePanel();
    const latest = store.getState().panelCloseRevision;
    store.getState().finishPanelClose(old);
    assert.equal(store.getState().panelMounted, true);
    assert.equal(store.getState().panelClosing, true);
    store.getState().finishPanelClose(latest);
    assert.equal(store.getState().panelMounted, false);
    assert.equal(store.getState().panelClosing, false);
});

test('真实侧栏状态库：重开取消卸载，重复打开不保存相同偏好', () => {
    const { store, writes } = load();
    store.getState().openPanel();
    assert.equal(writes.length, 0);
    store.getState().closePanel();
    const old = store.getState().panelCloseRevision;
    store.getState().openPanel();
    for (let i = 0; i < 20; i++) store.getState().openPanel();
    store.getState().finishPanelClose(old);
    assert.equal(store.getState().panelOpen, true);
    assert.equal(store.getState().panelMounted, true);
    assert.equal(store.getState().panelClosing, false);
    assert.deepEqual(writes, [['canvas-side-panel-open', '0'], ['canvas-side-panel-open', '1']]);
});

test('连续快速切换以最后一次操作为准，尺寸非法输入不污染状态', () => {
    const { store } = load();
    for (let i = 0; i < 21; i++) {
        store.getState().togglePanel();
    }
    assert.equal(store.getState().panelOpen, false);
    store.getState().finishPanelClose(store.getState().panelCloseRevision);
    assert.equal(store.getState().panelMounted, false);
    store.getState().openPanel();
    assert.equal(store.getState().panelMounted, true);
    store.getState().setWidth(9999); assert.equal(store.getState().width, 480);
    store.getState().setWidth(0); assert.equal(store.getState().width, 220);
    store.getState().setWidth(NaN); assert.equal(store.getState().width, 220);
});
