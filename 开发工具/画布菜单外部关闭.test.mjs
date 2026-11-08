import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../.运行/3100源/画布副本/web/package.json', import.meta.url));
const ts = require('typescript');
const jsx = (type, props) => ({ type, props: props || {} });
function find(node, type) {
    if (!node || typeof node !== 'object') return;
    if (node.type === type) return node;
    for (const child of [node.props?.children].flat()) { const match = find(child, type); if (match) return match; }
}
function fixture() {
    const slots = [], effects = [], listeners = new Map();
    let cursor = 0, active = true;
    const react = {
        useRef(initial) { const id = cursor++; return slots[id] ??= { current: initial }; },
        useState(initial) { const id = cursor++; if (!(id in slots)) slots[id] = initial;
            return [slots[id], value => { slots[id] = typeof value === 'function' ? value(slots[id]) : value; }]; },
        useEffect(callback, deps) { const id = cursor++, previous = slots[id];
            if (!previous || deps.some((value, index) => previous.deps[index] !== value)) effects.push(() => {
                previous?.cleanup?.(); slots[id] = { deps, cleanup: callback() };
            }); },
    };
    const window = {
        addEventListener(type, callback, capture) { assert.equal(capture, true); if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(callback); },
        removeEventListener(type, callback, capture) { assert.equal(capture, true); listeners.get(type)?.delete(callback); },
    };
    const theme = { node: { text: '#111' } };
    const imports = {
        react, 'react/jsx-runtime': { jsx, jsxs: jsx },
        'lucide-react': new Proxy({}, { get: (_object, name) => name }), antd: { Dropdown: 'NativeDropdown', Tooltip: 'Tooltip', Modal: 'Modal' },
        '@/扩展功能/主题/原生可关闭浮层': { OutsideDropdown: 'NativeDropdown' },
        '@/扩展功能/主题/苹果弹窗': { AppleModal: 'Modal' },
        'react-i18next': { useTranslation: () => ({ t: key => key }) },
        '@/扩展功能/产品/产品界面边界': { useProductActive: () => active },
        '@/扩展功能/产品配置/功能开关': { productFeatures: {} },
        '@/components/layout/version-release-modal': { VersionReleaseModal: 'VersionReleaseModal' },
        '@/lib/canvas-theme': { canvasThemes: { light: theme } },
        '@/stores/use-canvas-side-panel-store': { useCanvasSidePanelStore: select => select({ panelOpen: true, togglePanel() {} }) },
        '@/stores/use-theme-store': { useThemeStore: select => select({ theme: 'light' }) },
        '@/扩展功能/本机存储/上游浏览器存储桥': {},
    };
    const source = readFileSync(new URL('../.运行/3100源/画布副本/web/src/components/canvas/canvas-top-bar.tsx', import.meta.url), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    const module = { exports: {} };
    new Function('require', 'module', 'exports', 'window', code)(name => { assert.ok(name in imports, name); return imports[name]; }, module, module.exports, window);
    const trigger = {}, popup = {}, outside = {};
    return {
        render(props = {}) {
            cursor = 0;
            const tree = module.exports.CanvasTopBar(props), dropdown = find(tree, 'NativeDropdown');
            dropdown.props.children.props.ref.current = { contains: target => target === trigger };
            dropdown.props.popupRender('原生菜单').props.ref.current = { contains: target => target === popup };
            effects.splice(0).forEach(run => run()); return dropdown;
        },
        active(value) { active = value; }, trigger, popup, outside,
        pointer(target, path) { const event = { target, composedPath: () => path || [target], preventDefault() { throw Error('关闭菜单不能阻止外部操作'); }, stopPropagation() { throw Error('关闭菜单不能吞掉画布事件'); } };
            for (const listener of listeners.get('pointerdown') || []) listener(event); },
        listeners: () => listeners.get('pointerdown')?.size || 0,
        unmount() { for (const value of slots) value?.cleanup?.(); },
    };
}
test('画布接管pointerdown而不派发mousedown时，原生菜单仍在外部按下后关闭', () => {
    const f = fixture(); let menu = f.render();
    assert.equal(f.listeners(), 0); menu.props.onOpenChange(true); menu = f.render();
    assert.equal(menu.props.open, true); assert.equal(f.listeners(), 1);
    f.pointer(f.outside); menu = f.render();
    assert.equal(menu.props.open, false); assert.equal(f.listeners(), 0);
    assert.equal(menu.props.transitionName, undefined);
});
test('菜单内部和触发按钮不被外部监听误关，原生关闭及按钮切换仍生效', () => {
    const f = fixture(); f.render().props.onOpenChange(true); let menu = f.render();
    for (const target of [f.trigger, f.popup]) { f.pointer(target); assert.equal(f.render().props.open, true); }
    f.pointer(f.outside, [f.popup]); assert.equal(f.render().props.open, true, '以composedPath实际来源判断');
    menu.props.onOpenChange(false, { source: 'menu' }); menu = f.render(); assert.equal(menu.props.open, false);
    assert.equal(menu.props.children.props['aria-haspopup'], 'menu'); assert.equal(menu.props.children.props['aria-expanded'], false);
    assert.equal(menu.props.popupRender('原生菜单').props.children, '原生菜单');
});
test('切换产品或卸载清理监听，回来不会重开旧菜单；原菜单命令不变', () => {
    const f = fixture(); let called = 0;
    let menu = f.render({ onImportContents: () => called++ });
    menu.props.menu.items.find(item => item.key === 'importContents').onClick(); assert.equal(called, 1);
    menu.props.onOpenChange(true); f.render(); f.active(false); f.render(); menu = f.render();
    assert.equal(menu.props.open, false); assert.equal(f.listeners(), 0);
    f.active(true); menu = f.render(); assert.equal(menu.props.open, false);
    menu.props.onOpenChange(true); f.render(); f.unmount(); assert.equal(f.listeners(), 0);
});
