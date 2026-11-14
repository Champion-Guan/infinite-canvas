import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { variantModules } from './产品变体生成夹具.mjs';
const { placeReferencePreview } = variantModules().load('画布交互/图片引用预览定位.ts');

test('引用上方有空间时紧邻8px，上方不足切到可完整显示的一侧，不裁图、不覆盖文字', () => {
    const bounds = { left:260,top:160,right:1428,bottom:700 };
    const anchor = { left:650,right:800,top:500,bottom:520 };
    const result = placeReferencePreview(anchor,bounds);
    assert.equal(result.side,'top'); assert.equal(result.top+result.height,anchor.top-8);
    assert.equal(result.edge,224);
    for (const card of [
        { left:800,right:940,top:230,bottom:250 },
        { left:270,right:400,top:170,bottom:190 },
        { left:1280,right:1410,top:650,bottom:670 },
    ]) {
        const r = placeReferencePreview(card,bounds);
        assert.ok(r.left>=bounds.left && r.top>=bounds.top);
        assert.ok(r.left+r.width<=bounds.right && r.top+r.height<=bounds.bottom);
        assert.ok(r.left>=card.right+8 || r.left+r.width<=card.left-8 || r.top>=card.bottom+8 || r.top+r.height<=card.top-8);
        assert.equal(r.width,r.edge+24); assert.equal(r.height,r.edge+44);
    }
});

test('一行及两行名称按实际高度收紧，底部只有12px内边距', () => {
    const anchor = {left:650,right:800,top:500,bottom:520}, bounds = {left:260,top:160,right:1428,bottom:700};
    for (const caption of [16,32]) {
        const r = placeReferencePreview(anchor,bounds,() => caption);
        assert.equal(r.height,12+224+4+caption+12);
        assert.equal(r.top+r.height,anchor.top-8);
    }
});

test('小视区缩小完整媒体和名称占位，不以裁剪或滚动保留大图片', () => {
    const r = placeReferencePreview({left:360,right:450,top:210,bottom:230},{left:260,top:160,right:630,bottom:380});
    assert.ok(r.edge>0 && r.edge<224);
    assert.ok(r.left>=260 && r.top>=160 && r.left+r.width<=630 && r.top+r.height<=380);
    const source = readFileSync('扩展功能/Excel画布/图片引用悬浮预览.tsx','utf8');
    assert.match(source,/createProductPortal/);
    assert.doesNotMatch(source,/OutsidePopover|overflowY|overflow: "hidden"/);
    assert.match(source,/pointerEvents: "none"/);
    assert.match(source,/onClickCapture/);
});

test('小三角按预览方位指回文字，名称测量后无多余高度', () => {
    const old = Object.fromEntries(['window','ResizeObserver','requestAnimationFrame','cancelAnimationFrame'].map(key=>[key,globalThis[key]]));
    try {
        globalThis.window = {addEventListener(){},removeEventListener(){}};
        globalThis.ResizeObserver = class {observe(){}disconnect(){}};
        globalThis.requestAnimationFrame = () => 1; globalThis.cancelAnimationFrame = () => {};
        const bounds = {left:260,top:160,right:1428,bottom:700};
        const loader = variantModules({'./浮层可见区域':{CANVAS_FLOATING_CHANGE:'change',readCanvasFloatingBounds:()=>bounds}});
        const {positionReferencePreview} = loader.load('画布交互/图片引用预览定位.ts');
        for (const rect of [
            {left:650,right:800,top:500,bottom:520},
            {left:650,right:800,top:180,bottom:200},
            {left:650,right:800,top:350,bottom:370},
            {left:1260,right:1400,top:350,bottom:370},
        ]) {
            const arrow={style:{}},caption={offsetHeight:16}, panel={style:{setProperty(){}},dataset:{},querySelector:s=>s.includes('arrow')?arrow:caption,addEventListener(){},removeEventListener(){}};
            const cleanup=positionReferencePreview(panel,{getBoundingClientRect:()=>rect});
            const side=panel.dataset.previewSide;
            const colored={top:'borderTopColor',bottom:'borderBottomColor',left:'borderLeftColor',right:'borderRightColor'}[side];
            assert.equal(arrow.style[colored],'var(--reference-preview-background)');
            assert.equal(panel.style.height,'268px');
            cleanup();
        }
    } finally { for(const [key,value]of Object.entries(old)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;} }
});

test('竖图和横图由实际比例决定宽高，标题换行只影响高度，不向两侧撑出白边', () => {
    const anchor={left:700,right:820,top:520,bottom:540},bounds={left:260,top:160,right:1428,bottom:700};
    for(const ratio of [902/1084,.5,1,2]){
        const a=placeReferencePreview(anchor,bounds,()=>16,ratio);
        const b=placeReferencePreview(anchor,bounds,()=>32,ratio);
        assert.ok(Math.abs(a.mediaWidth/a.mediaHeight-ratio)<1e-8);
        assert.equal(a.width,a.mediaWidth+24);
        assert.equal(a.height,a.mediaHeight+44);
        assert.equal(b.width,a.width);
        assert.equal(b.height,a.height+16);
        assert.equal(Math.max(a.mediaWidth,a.mediaHeight),224);
    }
});
