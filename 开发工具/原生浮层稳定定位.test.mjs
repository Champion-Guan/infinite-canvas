import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { variantModules } from './产品变体生成夹具.mjs';

test('原生浮层只读锚点和边界，同一原生对齐通知不反复改位，复用容器且关闭清理监听', () => {
    const keys = ['window','ResizeObserver','requestAnimationFrame','cancelAnimationFrame'];
    const original = Object.fromEntries(keys.map(key => [key,globalThis[key]]));
    try {
        const frames = new Map(), listeners = new Map(); let index = 0, cleanup, disconnect = 0;
        globalThis.window = { innerHeight: 800, addEventListener: (key,fn) => listeners.set(key,fn), removeEventListener: key => listeners.delete(key) };
        globalThis.ResizeObserver = class { observe() {} disconnect() { disconnect++; } };
        globalThis.requestAnimationFrame = fn => { frames.set(++index,fn); return index; };
        globalThis.cancelAnimationFrame = id => frames.delete(id);
        const safe = { left: 260, top: 160, right: 1428, bottom: 700 };
        const rules = variantModules().load('画布交互/浮层可见区域.ts');
        const loader = variantModules({ react: { useRef: current => ({current}), useCallback: fn => fn, useEffect: () => {}, useLayoutEffect: fn => { cleanup = fn(); } },
            './浮层可见区域': { ...rules, readCanvasFloatingBounds: () => safe } });
        const entry = loader.load('画布交互/原生浮层边界容器.ts');
        const roots = []; let notifications = 0, reads = 0;
        const scope = { appendChild: root => { root.isConnected = true; roots.push(root); } };
        const doc = { body: scope, createElement: () => ({ dataset: {}, style: {}, dispatchEvent: () => { notifications++; listeners.get('scroll')?.(); } }) };
        const anchor = { ownerDocument: doc, closest: selector => selector === '[data-product-id]' ? scope : null, getBoundingClientRect: () => { reads++; return { left: 800, right: 900, top: 300, bottom: 320 }; } };
        const getContainer = entry.useNativePopupBoundary(true), root = getContainer(anchor);
        assert.deepEqual(root.style, { position:'fixed',overflow:'hidden',pointerEvents:'none',zIndex:'1300',left:'260px',top:'160px',width:'1168px',height:'540px' });
        const flush = () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn()); };
        for (let n = 0; n < 20; n++) { assert.equal(getContainer(anchor),root); listeners.get('scroll')(); flush(); }
        assert.equal(roots.length,1); assert.equal(notifications,1,'原生对齐和内部滚动不形成通知循环');
        assert.ok(reads > 0); assert.equal(root.style.translate,undefined);
        safe.bottom = 600; listeners.get('resize')(); flush(); flush();
        assert.equal(root.style.height,'440px'); assert.equal(notifications,2);
        listeners.get('resize')(); cleanup(); assert.equal(frames.size,0); assert.equal(listeners.size,0); assert.equal(disconnect,1);
        const dock = {};
        const toolbarAnchor = { ...anchor, closest: selector => selector === '[data-product-id]' ? scope : selector === '.ant-modal-wrap' ? null : dock };
        const toolbarContainer = entry.useNativePopupBoundary(true)(toolbarAnchor);
        assert.notEqual(toolbarContainer,root,'工具栏与卡片各自保留边界，悬浮提示不能改变已打开菜单的裁切区');
        assert.equal(toolbarContainer.style.height,'628px','底部工具栏的浮层包含锚点区域，不裁掉提示和最后一项');
        assert.equal(root.style.height,'440px','卡片浮层仍避开底部工具栏');
        cleanup();
        assert.equal(entry.NATIVE_POPUP_LIMIT.maxHeight,'100%');
        assert.equal(entry.NATIVE_POPUP_LIMIT.pointerEvents,'auto');
    } finally { for (const [key,value] of Object.entries(original)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } }
});

test('菜单、悬浮预览、工具提示与选择器使用同一原生边界，二级菜单保留原生定位', () => {
    const source = readFileSync('扩展功能/主题/原生可关闭浮层.tsx','utf8');
    assert.equal((source.match(/useNativePopupBoundary\(/g)||[]).length,4);
    assert.equal((source.match(/getPopupContainer=\{popupContainer\}/g)||[]).length,4);
    assert.match(source,/getPopupContainer: popupContainer/);
    assert.match(source,/popupStyle: \{ \.\.\.item.popupStyle, \.\.\.NATIVE_POPUP_LIMIT \}/);
    assert.doesNotMatch(source,/useFloatingBoundary|CanvasFloatingBoundary/);
});

test('底部工具栏浮层的原生对齐点上移到工具栏外，卡片和下方展开保持原生位置', () => {
    const { toolbarPopupTargetOffset } = variantModules().load('画布交互/原生浮层边界容器.ts');
    const dock = { getBoundingClientRect: () => ({ top: 700 }) };
    const anchor = { closest: () => dock, getBoundingClientRect: () => ({ top: 712 }) };
    assert.deepEqual(toolbarPopupTargetOffset(anchor, 'top'), [0, 16]);
    assert.equal(700 - (712 - 16 - 4), 8, '菜单完整位于工具栏上方，保持8px间隙');
    assert.equal(toolbarPopupTargetOffset(anchor, 'bottom'), undefined);
    assert.equal(toolbarPopupTargetOffset({ ...anchor, closest: () => null }, 'top'), undefined);
});

test('自定义浮层使用动画终点占位，入场缩放、位移和画布反向缩放不改变边界计算', () => {
    const keys = ['getComputedStyle','DOMMatrixReadOnly','KeyframeEffect'];
    const old = Object.fromEntries(keys.map(key => [key,globalThis[key]]));
    try {
        globalThis.DOMMatrixReadOnly = class { constructor(value) { [this.a,this.b,this.c,this.d,this.e,this.f] = value.match(/matrix\((.*)\)/)[1].split(',').map(Number); } };
        globalThis.KeyframeEffect = class { constructor(target,last) { this.target = target; this.last = last; } getKeyframes() { return [{},this.last]; } };
        const { floatingLayoutRect } = variantModules().load('画布交互/浮层布局矩形.ts');
        let current = .5;
        const element = { offsetWidth: 200, offsetHeight: 200, getBoundingClientRect: () => ({ left:100+100*(1-current)+20,top:200+100*(1-current)+10,width:200*current,height:200*current }),
            getAnimations: () => [{effect:new KeyframeEffect(element,{transform:'matrix(1,0,0,1,0,0)'})}] };
        globalThis.getComputedStyle = () => ({ transform:`matrix(${current},0,0,${current},20,10)`,transformOrigin:'100px 100px' });
        for (current of [.5,.75,.9,1]) {
            const result = floatingLayoutRect(element);
            assert.deepEqual(result.rect,{left:100,top:200,right:300,bottom:400});
            assert.equal(result.parentX,1); assert.equal(result.parentY,1);
        }
        element.getAnimations = () => [];
        element.getBoundingClientRect = () => ({left:1200,top:600,width:200,height:200});
        globalThis.getComputedStyle = () => ({transform:'matrix(.5,0,0,.5,0,0)',transformOrigin:'0px 0px'});
        const scaled = floatingLayoutRect(element);
        assert.equal(scaled.parentX,2); assert.equal(scaled.parentY,2);
        assert.deepEqual(scaled.rect,{left:1200,top:600,right:1400,bottom:800});
    } finally { for (const [key,value] of Object.entries(old)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } }
});
