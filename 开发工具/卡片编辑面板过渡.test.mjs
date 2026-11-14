import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { variantModules } from './产品变体生成夹具.mjs';

const jsx = (type, props) => ({ type, props });
function fixture() {
    let present = true, reduced = false, active = true, effect;
    const loader = variantModules({
        react: { useRef: current => ({ current }), useLayoutEffect: fn => { effect = fn; },
            useState: value => [typeof value === 'object' ? { visibility: 'visible', left: 612, top: 300, width: 600 } : 'right', () => {}] },
        'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-dom': { createPortal: (element, target) => ({ element, target }) },
        'motion/react': { motion: { div: 'MotionDiv' }, useIsPresent: () => present, useReducedMotion: () => reduced },
        '../产品/产品界面边界': { useProductActive: () => active },
    });
    const component = loader.load('画布连线/卡片浮层.tsx').CardPanelLayer;
    return { component, present: x => { present = x; }, reduced: x => { reduced = x; }, active: x => { active = x; }, effect: () => effect() };
}

test('卡片编辑整体共用220ms进退场，坐标不参与动画，退出不可操作且不重新定位', () => {
    const previous = globalThis.document; globalThis.document = { body: {} };
    try {
        const f = fixture(), props = { node: { id: 'card', position: { x: 10, y: 20 }, width: 340, height: 240 }, target: {}, children: '原编辑内容' };
        const shell = f.component(props).element;
        const panel = shell.props.children;
        assert.equal(shell.type, 'div');
        assert.equal(panel.type, 'MotionDiv');
        assert.deepEqual(panel.props.initial, { opacity: 0, scale: .98 });
        assert.deepEqual(panel.props.animate, { opacity: 1, scale: 1 });
        assert.deepEqual(panel.props.exit, { opacity: 0, scale: .98 });
        assert.equal(panel.props.transition.duration, .22);
        assert.equal(shell.props.style.left, 612); assert.equal(shell.props.style.top, 300);
        assert.equal(panel.props.children, '原编辑内容');
        f.present(false);
        const closing = f.component(props).element;
        assert.equal(closing.props.inert, true); assert.equal(closing.props['aria-hidden'], true);
        assert.equal(closing.props.style.pointerEvents, 'none');
        assert.equal(f.effect(), undefined, '退出立即解除定位观察，不因旧卡片变化移动');
        f.present(true); f.reduced(true);
        const direct = f.component(props).element.props.children;
        assert.equal(direct.props.transition.duration, 0); assert.equal(direct.props.initial.scale, 1);
        f.active(false); assert.equal(f.component(props), null);
    } finally { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; }
});

test('真实卡片条件外保留Presence，关闭不会先卸载面板', () => {
    const source = readFileSync('.运行/3100源/画布副本/web/src/components/canvas/canvas-node.tsx','utf8');
    assert.match(source, /<AnimatePresence>\{showPanel && !isGroup && renderPanel/);
    assert.match(source, /<CardPanelLayer key=\{data.id\}/);
    assert.match(source, /<\/CardPanelLayer>\s*\) : null\}<\/AnimatePresence>/);
});
