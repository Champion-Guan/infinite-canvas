import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformWithEsbuild } from '../.运行/3100源/画布副本/web/node_modules/vite/dist/node/index.js';

class Node {
    constructor(parent = null) { this.parentElement = parent; }
    contains(target) { for (let node = target; node; node = node.parentElement) if (node === this) return true; return false; }
}
class Element extends Node {
    constructor(parent = null, className = '') { super(parent); this.className = className; }
    closest(selector) {
        if (this.nativeOptions && selector.includes('.ant-select-dropdown')) return this;
        return selector.split(',').some(value => value.startsWith('.') && this.className.split(' ').includes(value.slice(1)))
            ? this : this.parentElement?.closest(selector) ?? null;
    }
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
test('点击已注册弹窗自己的遮罩会关闭，未注册子弹窗及其遮罩不误关父层', () => {
    const f = fixture(), modal = f.layer('补充依据', null, true);
    const root = new Element(null, 'ant-modal-root'), wrap = new Element(root, 'ant-modal-wrap');
    const mask = new Element(root, 'ant-modal-mask');
    modal.panel.parentElement = wrap; modal.panel.className = 'ant-modal';
    f.pointer(wrap); assert.deepEqual(f.calls, ['补充依据']);
    f.calls.length = 0;
    f.pointer(mask); assert.deepEqual(f.calls, ['补充依据']);
    f.calls.length = 0;
    const foreignRoot = new Element(null, 'ant-modal-root'), foreignWrap = new Element(foreignRoot, 'ant-modal-wrap');
    f.pointer(new Element(foreignWrap, 'ant-modal')); f.pointer(foreignWrap);
    assert.deepEqual(f.calls, []);
    modal.remove();
});
test('嵌套弹窗遮罩只关闭最上层，保留父层和原生选项', () => {
    const f = fixture(), parent = f.layer('父', null, true), child = f.layer('子', parent, true);
    const root = new Element(null, 'ant-modal-root'), wrap = new Element(root, 'ant-modal-wrap');
    child.panel.parentElement = wrap; child.panel.className = 'ant-modal';
    f.pointer(wrap); assert.deepEqual(f.calls, ['子']);
    f.calls.length = 0;
    const select = new Element(); select.nativeOptions = true;
    f.pointer(select); assert.deepEqual(f.calls, []);
    child.remove(); parent.remove();
});

test('新版图片预览的遮罩、图片和工具栏只交给原生预览关闭，保留提示词及父设置面板', () => {
    for (const nested of [false, true]) {
        const f = fixture(), parent = f.layer('设置', null, true), detail = f.layer('提示词', parent, true);
        const root = new Element(null, 'ant-modal-root'), wrap = new Element(root, 'ant-modal-wrap');
        detail.panel.parentElement = wrap; detail.panel.className = 'ant-modal';
        const previewRoot = new Element(nested ? wrap : null, 'ant-image-preview-root');
        const preview = new Element(previewRoot, 'ant-image-preview');
        const mask = new Element(previewRoot, 'ant-image-preview-mask');
        for (const target of [mask, preview, new Element(preview, 'ant-image-preview-img'), new Element(preview, 'ant-image-preview-close')]) {
            f.pointer(target);
            assert.deepEqual(f.calls, [], '图片预览内的点击不能关闭任何父面板');
        }
        f.pointer(wrap);
        assert.deepEqual(f.calls, ['提示词'], '图片预览关闭后，父面板自身外部点击仍可关闭');
        detail.remove(); parent.remove();
    }
});

test('兼容旧版图片预览wrap，点击其外的画布仍只关闭最上层弹窗', () => {
    const f = fixture(), modal = f.layer('提示词', null, true);
    f.pointer(new Element(new Element(null, 'ant-image-preview-wrap')));
    assert.deepEqual(f.calls, []);
    f.pointer(new Element());
    assert.deepEqual(f.calls, ['提示词']);
    modal.remove();
});
