import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformWithEsbuild } from '../.运行/3100源/画布副本/web/node_modules/vite/dist/node/index.js';

class Node {
    constructor(parent = null) { this.parentElement = parent; }
    contains(target) { for (let node = target; node; node = node.parentElement) if (node === this) return true; return false; }
}
class Element extends Node {
    closest() { return this.nativeOptions ? this : this.parentElement?.closest() ?? null; }
}
const file = '扩展功能/主题/面板外部关闭.ts';
const { code } = await transformWithEsbuild(readFileSync(file, 'utf8'), file, { loader: 'ts', format: 'cjs', target: 'es2022', tsconfigRaw: '{}' });
const module = { exports: {} };
new Function('module', 'exports', 'Node', 'Element', code)(module, module.exports, Node, Element);
const { createOutsidePanelRegistry } = module.exports;
function fixture() {
    const listeners = new Set(), calls = [];
    const registry = createOutsidePanelRegistry({
        addEventListener(name, fn, capture) { assert.equal(name, 'pointerdown'); assert.equal(capture, true); listeners.add(fn); },
        removeEventListener(name, fn, capture) { assert.equal(name, 'pointerdown'); assert.equal(capture, true); listeners.delete(fn); },
    });
    const layer = (id, parent = null, modal = false) => {
        const trigger = new Element(), panel = new Element();
        const record = { parent: parent?.record ?? null, modal, trigger: () => trigger, panel: () => panel, dismiss: () => calls.push(id) };
        return { trigger, panel, record, remove: registry.register(record) };
    };
    return { layer, calls, listeners, pointer(target, path = [target]) {
        const event = { target, defaultPrevented: true, composedPath: () => path,
            preventDefault() { throw Error('不能阻止外部操作'); }, stopPropagation() { throw Error('不能吞掉画布事件'); } };
        [...listeners].forEach(callback => callback(event));
    } };
}
test('所有浮层共用一个捕获监听，画布取消兼容鼠标事件时仍关闭外部面板', () => {
    const f = fixture(), first = f.layer('下拉'), second = f.layer('设置');
    assert.equal(f.listeners.size, 1);
    f.pointer(new Element()); assert.deepEqual(f.calls, ['设置', '下拉']);
    first.remove(); assert.equal(f.listeners.size, 1); second.remove(); assert.equal(f.listeners.size, 0);
});
test('点击工作区遮罩以外的顶栏只取消最上层弹窗，不连带关闭父弹窗', () => {
    const f = fixture(), parent = f.layer('父弹窗', null, true), child = f.layer('子弹窗', parent, true);
    f.pointer(new Element()); assert.deepEqual(f.calls, ['子弹窗']);
    child.remove(); f.pointer(new Element()); assert.deepEqual(f.calls, ['子弹窗', '父弹窗']);
    parent.remove();
});
test('点击Portal子面板及其触发器保留父子层，点击父面板外的独立区域关闭两层', () => {
    const f = fixture(), parent = f.layer('parent'), child = f.layer('child', parent);
    f.pointer(new Element(child.panel)); f.pointer(child.trigger); assert.deepEqual(f.calls, []);
    f.pointer(new Element(parent.panel)); assert.deepEqual(f.calls, ['child']);
    f.calls.length = 0; f.pointer(new Element()); assert.deepEqual(f.calls, ['child', 'parent']);
    child.remove(); parent.remove();
});
test('点击面板内部与触发器不关闭，点击另一个独立面板只关闭外层无关面板', () => {
    const f = fixture(), a = f.layer('A'), b = f.layer('B');
    f.pointer(a.trigger); assert.deepEqual(f.calls, ['B']);
    f.calls.length = 0; f.pointer(new Element(b.panel)); assert.deepEqual(f.calls, ['A']);
    a.remove(); b.remove();
});
test('原生/Radix子选项不在选择前误关父层，Shadow DOM按照真实来源判断', () => {
    const f = fixture(), parent = f.layer('父设置'), options = new Element(); options.nativeOptions = true;
    f.pointer(new Element(options)); assert.deepEqual(f.calls, []);
    const shadowHost = new Element(), actualButton = new Element(parent.panel);
    f.pointer(shadowHost, [actualButton, parent.panel, shadowHost]); assert.deepEqual(f.calls, []);
    parent.remove(); f.pointer(new Element()); assert.deepEqual(f.calls, []);
});
