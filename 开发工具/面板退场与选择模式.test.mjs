import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../.运行/3100源/画布副本/web/package.json', import.meta.url));
const ts = require('typescript');
const jsx = (type, props) => ({ type, props: props || {} });
function fixture(name) {
    const cells = []; let cursor = 0, present = true, reduced = false, removed = 0, outsideTrigger;
    const hooks = {
        createContext: value => ({ Provider: 'Provider', value }), useContext: context => context.value, useLayoutEffect() {},
        useState(initial) { const slot = cursor++; cells[slot] ||= { value: typeof initial === 'function' ? initial() : initial }; return [cells[slot].value, value => { cells[slot].value = typeof value === 'function' ? value(cells[slot].value) : value; }]; },
        useRef: value => hooks.useState(() => ({ current: value }))[0],
        useEffect(callback, deps) { const slot = cursor++, old = cells[slot]; if (!old || deps.some((value, index) => value !== old.deps[index])) { old?.cleanup?.(); cells[slot] = { deps, cleanup: callback() }; } },
    };
    const safeToRemove = () => removed++;
    const dependencies = {
        react: hooks, 'react/jsx-runtime': { jsx, jsxs: jsx }, antd: { Modal: 'NativeModal' },
        'motion/react': { motion: { div: 'motion.div', span: 'motion.span' }, usePresence: () => [present, safeToRemove], useIsPresent: () => present, useReducedMotion: () => reduced },
        './苹果动效': { APPLE_SURFACE_SPRING: { type: 'spring', bounce: 0, duration: .28 } },
        './苹果弹窗布局.module.css': { default: {} },
        './原生可关闭浮层': { OutsidePanelScope: 'PanelScope', useOutsidePanel: (_open, trigger) => { outsideTrigger = trigger; return { layer: {} }; } },
    };
    const code = ts.transpileModule(readFileSync(new URL('../扩展功能/主题/' + name + '.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    const module = { exports: {} };
    new Function('require', 'module', 'exports', 'document', 'HTMLElement', code)(id => { assert.ok(Object.hasOwn(dependencies, id), id); return dependencies[id]; }, module, module.exports, { getElementById: id => ({ id, getBoundingClientRect: () => ({ left: 0, top: 0, width: 20, height: 20 }) }) }, class {});
    return { render(key, props) { cursor = 0; const node = module.exports[key](props); if (key !== 'AppleModal') return node;
        const modal = node.props.children.props.children, render = modal.props.modalRender;
        modal.props.modalRender = child => { const surface = render(child); return surface.type(surface.props); };
        return modal; }, trigger: () => { const target = outsideTrigger(); return target ? { id: target.id } : null; }, setPresent(value) { present = value; }, reduce(value) { reduced = value; }, removed: () => removed };
}

test('设置触发器属于弹窗外部边界，捕获阶段不先关闭再由按钮重新打开', () => {
    const f = fixture('苹果弹窗');
    const modal = f.render('AppleModal', { open: true, triggerId: 'guan-settings-trigger', onCancel() {} });
    assert.deepEqual(f.trigger(), { id: 'guan-settings-trigger' });
    assert.equal(modal.props.triggerId, undefined, '自有边界属性不传入原生Modal或DOM');
    f.render('AppleModal', { open: true }); assert.equal(f.trigger(), null);
});

test('弹窗交由Ant原生退出，内容不清空，afterClose恢复焦点后释放Presence', () => {
    const f = fixture('苹果弹窗'); let after = 0;
    const props = { open: true, title: '原图片', children: '原图和详细信息', afterClose: () => after++ };
    const opened = f.render('AppleModal', props);
    assert.equal(opened.props.open, true);
    f.setPresent(false);
    const closing = f.render('AppleModal', props), surface = closing.props.modalRender('native');
    assert.equal(closing.props.open, false); assert.equal(surface.props.inert, true);
    assert.equal(surface.type, 'div');
    assert.equal(closing.props.transitionName, undefined);
    assert.equal(closing.props.maskTransitionName, undefined);
    assert.equal(f.removed(), 0);
    assert.equal(f.removed(), 0, 'Ant完成焦点恢复前不能提前移除');
    closing.props.afterClose();
    assert.equal(after, 1); assert.equal(f.removed(), 1);
});
test('普通弹窗默认可点击遮罩取消，保存事务显式关闭门禁仍优先', () => {
    const f = fixture('苹果弹窗'); let cancelled = 0;
    const ordinary = f.render('AppleModal', { open: true, onCancel: () => cancelled++ });
    assert.equal(ordinary.props.maskClosable, true); ordinary.props.onCancel(); assert.equal(cancelled, 1);
    const locked = f.render('AppleModal', { open: true, maskClosable: false, onCancel: () => cancelled++ });
    assert.equal(locked.props.maskClosable, false);
});

test('受控面板open=false时保留标题、正文与页脚，真实结束后释放快照', () => {
    const f = fixture('苹果弹窗');
    f.render('AppleModal', { open: true, title: '裁剪', children: '原图', footer: '操作按钮' });
    const closing = f.render('AppleModal', { open: false, title: '', children: null, footer: null });
    assert.equal(closing.props.open, false);
    assert.equal(closing.props.title, '裁剪'); assert.equal(closing.props.children, '原图'); assert.equal(closing.props.footer, '操作按钮');
    closing.props.afterClose();
    const released = f.render('AppleModal', { open: false });
    assert.equal(released.props.children, undefined);
});

test('面板关开关交由原生动画反转，旧afterClose不能清空新窗口或提前卸载', () => {
    const f = fixture('苹果弹窗');
    f.render('AppleModal', { open: true, children: '内容' });
    const old = f.render('AppleModal', { open: false });
    f.render('AppleModal', { open: true, children: '新内容' });
    const latest = f.render('AppleModal', { open: false });
    old.props.afterClose();
    assert.equal(f.render('AppleModal', { open: false }).props.children, '新内容');
    assert.equal(f.removed(), 0);
    latest.props.afterClose();
    assert.equal(f.render('AppleModal', { open: false }).props.children, undefined);
});

test('弹窗不覆盖原生遮罩样式，不叠加Motion；空字符串不能禁用原生过渡', () => {
    const f = fixture('苹果弹窗'); f.reduce(true);
    const styles = { mask: { backdropFilter: 'blur(8px)', background: '#0005' } };
    const open = f.render('AppleModal', { open: true, children: '内容', styles, transitionName: '', maskTransitionName: '' });
    assert.equal(open.props.styles, styles);
    assert.equal(open.props.transitionName, undefined);
    assert.equal(open.props.maskTransitionName, undefined);
    f.setPresent(false);
    const surface = f.render('AppleModal', { open: true }).props.modalRender('native');
    assert.equal(surface.type, 'div');
    assert.equal(surface.props.inert, true);
    assert.equal(surface.props.animate, undefined);
});

test('勾选槽与底栏具有进退同路的弹簧，退出阶段不接收点击和键盘焦点', () => {
    const f = fixture('选择模式动效');
    let slot = f.render('SelectionInline', { children: '复选框', gap: 12 });
    assert.deepEqual(slot.props.initial, slot.props.exit);
    assert.deepEqual(slot.props.animate, { width: 16, opacity: 1, marginRight: 0 });
    assert.equal(slot.props.initial.marginRight, -12, '收起时同时补偿flex间距，避免末帧跳动');
    f.setPresent(false); slot = f.render('SelectionInline', { children: '复选框' });
    assert.equal(slot.props.inert, true); assert.equal(slot.props['aria-hidden'], true);
    const footer = fixture('选择模式动效').render('SelectionFooter', { children: '已选数量和导出按钮' });
    assert.deepEqual(footer.props.initial, footer.props.exit);
    assert.equal(footer.props.animate.height, 'auto');
});

test('减少动态效果时选择状态立即呈现，保留控件及数量反馈', () => {
    const f = fixture('选择模式动效'); f.reduce(true);
    const slot = f.render('SelectionInline', { children: '复选框' });
    assert.deepEqual(slot.props.transition, { duration: 0 });
    assert.equal(slot.props.children, '复选框');
});
