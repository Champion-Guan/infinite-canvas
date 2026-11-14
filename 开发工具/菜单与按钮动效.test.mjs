import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { transformWithEsbuild } from '../.运行/3100源/画布副本/web/node_modules/vite/dist/node/index.js';

async function component(file, reducedMotion = false) {
  const source = await readFile(new URL('../扩展功能/' + file, import.meta.url), 'utf8');
  const { code } = await transformWithEsbuild(source, file, { loader: 'tsx', jsx: 'automatic', format: 'cjs', target: 'es2022', tsconfigRaw: '{}' });
  const state = [], effects = [], module = { exports: {} };
  let index = 0;
  const jsx = (type, props) => ({ type, props });
  const react = {
    useRef(value) { const slot = index++; if (!(slot in state)) state[slot] = { current: value }; return state[slot]; },
    useCallback: fn => fn, useMemo: fn => fn(), useEffect: fn => effects.push(fn), useLayoutEffect: fn => effects.push(fn),
    useState(initial) {
      const slot = index++;
      if (!(slot in state)) state[slot] = initial;
      return [state[slot], next => { state[slot] = typeof next === 'function' ? next(state[slot]) : next; }];
    },
  };
  const modules = {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    '../产品配置/功能开关': { productFeatures: { excel: true } },
    'motion/react': { motion: { div: 'motion.div', button: 'motion.button', section: 'motion.section' }, useReducedMotion: () => reducedMotion },
    'react-dom': { createPortal: node => node },
    antd: { App: { useApp: () => ({ message: { error() {} } }) }, Tooltip: 'tooltip', Dropdown: 'NativeDropdown' },
    '@/扩展功能/主题/原生可关闭浮层': { OutsideDropdown: 'NativeDropdown' },
    '../主题/苹果弹窗': { AppleModal: 'NativeModal' },
    '@/lib/utils': { cn: (...parts) => parts.filter(Boolean).join(' ') },
    '@/stores/canvas/use-canvas-store': { useCanvasStore: selector => selector({ projects: [], guanWorkbooks: null }) },
    '@/stores/use-theme-store': { useThemeStore: selector => selector({ theme: 'light' }) },
    '../产品/产品操作': { useProductNavigation: () => ({ activeId: null, busy: false, selectWorkbook() {} }) },
    './Excel产品归属': { visibleWorkbookId: () => null, workbookChoiceDetails: () => new Map() },
    './旧版Excel弹窗.js': { excelImportMarkup: () => '<header>导入预览</header>', updateExcelImportSelection() {} },
    './Excel文件读取': { readExcelFile: () => new Promise(() => {}) },
  };
  new Function('require', 'module', 'exports', 'document', 'HTMLElement', code)(
    name => modules[name] ?? {}, module, module.exports, { activeElement: null, body: {} }, class {});
  return { render(name, props) { index = 0; return module.exports[name](props); }, state, effects, source };
}
function dropdown(tree) { return tree.props.children[0].props.children[0]; }
function menu(tree) { return dropdown(tree).props.popupRender().props.children; }

test('工作簿菜单交由原生Dropdown进退场，快速开关只更新open，不自行延迟卸载', async () => {
  const f = await component('Excel/Excel工作簿选择.tsx');
  const render = () => f.render('ExcelWorkbookPicker');
  assert.equal(dropdown(render()).type, 'NativeDropdown');
  dropdown(render()).props.onOpenChange(true);
  assert.equal(dropdown(render()).props.open, true);
  dropdown(render()).props.onOpenChange(false);
  assert.equal(dropdown(render()).props.open, false);
  dropdown(render()).props.onOpenChange(true);
  assert.equal(dropdown(render()).props.open, true);
  assert.equal(menu(render()).props.role, 'listbox');
  assert.doesNotMatch(f.source, /setTimeout/);
});
test('Excel导入使用原生Modal与afterClose，退出前保留正文，读取仍能取消', async () => {
  for (const reduced of [false, true]) {
    const f = await component('Excel/Excel导入面板.tsx', reduced);
    let closed = 0;
    const render = () => f.render('ExcelImportPanel', { file: { name: '验收.xlsx' }, onClose: () => closed++ });
    const modal = render();
    assert.equal(modal.type, 'NativeModal');
    assert.equal(modal.props.open, true);
    modal.props.onCancel();
    const exiting = render();
    assert.equal(exiting.props.open, false);
    assert.ok(exiting.props.modalRender().props.children.props.children);
    assert.equal(closed, 0);
    exiting.props.afterClose();
    assert.equal(closed, 1);
    assert.doesNotMatch(f.source, /setTimeout/);
  }
});
test('工作簿原生下拉保留现有文件选择、工作簿回收站和上传入口', async () => {
  const f = await component('Excel/Excel工作簿选择.tsx');
  const render = () => f.render('ExcelWorkbookPicker');
  const native = dropdown(render());
  assert.deepEqual(native.props.trigger, ['click']);
  assert.equal(native.props.children.props['aria-haspopup'], 'listbox');
  assert.equal(menu(render()).props['aria-label'], '已上传的 Excel 文件');
  const popup = native.props.popupRender();
  assert.equal(popup.props.style.display, 'block', '主题scope的display:contents会吞掉width，必须建立真实尺寸容器');
  assert.equal(popup.props.style.width, 250);
  assert.equal(popup.props.style.maxWidth, 'calc(100vw - 24px)');
  assert.match(f.source, /<ExcelRecycleBinEntry/);
  assert.match(f.source, /aria-label="上传 Excel"/);
});
test('工作簿菜单不覆盖原生动画，减少动态效果由统一Ant主题处理', async () => {
  const f = await component('Excel/Excel工作簿选择.tsx', true);
  const render = () => f.render('ExcelWorkbookPicker');
  dropdown(render()).props.onOpenChange(true);
  const current = dropdown(render());
  assert.equal(current.props.open, true);
  assert.equal(current.props.transitionName, undefined);
  assert.doesNotMatch(f.source, /motion\.div|onAnimationComplete/);
});
test('历史按钮保留原点击、提示及禁用语义，减少动态效果和禁用状态不缩放', async () => {
  for (const reduced of [false, true]) {
    const f = await component('生成历史/历史操作按钮.tsx', reduced);
    let calls = 0;
    const props = { label: '重试', description: '重试失败图片', icon: 'icon', onClick: () => calls++ };
    const tooltip = f.render('HistoryActionButton', props);
    assert.equal(tooltip.props.title, props.description);
    assert.equal(tooltip.props.placement, 'top');
    assert.equal(tooltip.props.styles.root.maxWidth, 'min(320px, calc(100vw - 24px))');
    assert.deepEqual(tooltip.props.trigger, ['hover', 'focus']);
    const button = tooltip.props.children.props.children;
    assert.equal(button.type, 'motion.button'); assert.equal(button.props['aria-label'], '重试');
    button.props.onClick(); assert.equal(calls, 1);
    assert.deepEqual(button.props.whileTap, reduced ? undefined : { scale: .96 });
    const disabled = f.render('HistoryActionButton', { ...props, disabled: true }).props.children.props.children;
    assert.equal(disabled.props.disabled, true); assert.equal(disabled.props.whileTap, undefined);
  }
});
test('总览执行时立即关闭说明，鼠标点击后的弹窗焦点恢复不会重新打开说明', async () => {
  const f = await component('生成历史/历史操作按钮.tsx');
  let calls = 0;
  const props = { label: '总览', description: '查看生成图片详情', icon: 'icon', onClick: () => calls++ };
  const render = () => f.render('HistoryActionButton', props);
  const focus = visible => ({ target: { matches: selector => selector === ':focus-visible' && visible } });
  assert.equal(render().props.open, false);
  render().props.children.props.onMouseEnter();
  render().props.onOpenChange(true);
  assert.equal(render().props.open, true, '正常悬停仍显示说明');
  render().props.children.props.onClickCapture();
  render().props.children.props.children.props.onClick();
  assert.equal(calls, 1);
  assert.equal(render().props.open, false, '执行操作立即关闭说明');
  render().props.children.props.onMouseLeave();
  render().props.children.props.onBlurCapture({ relatedTarget: { closest: () => ({ role: 'dialog' }) } });
  render().props.children.props.onFocusCapture(focus(false));
  render().props.onOpenChange(true);
  assert.equal(render().props.open, false, '弹窗自动恢复鼠标焦点不能重新打开说明');
  render().props.children.props.onMouseEnter();
  render().props.onOpenChange(true);
  assert.equal(render().props.open, true, '重新悬停可以再次查看说明');
});
test('历史按钮保留键盘说明，离开焦点与执行操作均会收起说明', async () => {
  const f = await component('生成历史/历史操作按钮.tsx');
  const props = { label: '总览', description: '查看生成图片详情', icon: 'icon' };
  const render = () => f.render('HistoryActionButton', props);
  render().props.children.props.onFocusCapture({ target: { matches: selector => selector === ':focus-visible' } });
  render().props.onOpenChange(true);
  assert.equal(render().props.open, true);
  render().props.children.props.onClickCapture();
  assert.equal(render().props.open, false);
  render().props.children.props.onBlurCapture({ relatedTarget: null });
  render().props.onOpenChange(true);
  assert.equal(render().props.open, false);
});
test('总览键盘执行后只恢复焦点，再次Tab聚焦才重新显示说明', async () => {
  const f = await component('生成历史/历史操作按钮.tsx');
  const props = { label: '总览', description: '查看生成图片详情', icon: 'icon' };
  const render = () => f.render('HistoryActionButton', props);
  const keyboardFocus = { target: { matches: () => true } };
  render().props.children.props.onFocusCapture(keyboardFocus);
  render().props.onOpenChange(true);
  assert.equal(render().props.open, true);
  render().props.children.props.onClickCapture();
  render().props.children.props.onBlurCapture({ relatedTarget: { closest: () => ({ role: 'dialog' }) } });
  render().props.children.props.onFocusCapture(keyboardFocus);
  render().props.onOpenChange(true);
  assert.equal(render().props.open, false, '弹窗关闭后的键盘焦点恢复也不自动显示说明');
  render().props.children.props.onKeyDownCapture({ key: 'Tab' });
  render().props.children.props.onBlurCapture({ relatedTarget: { closest: () => null } });
  render().props.children.props.onFocusCapture(keyboardFocus);
  render().props.onOpenChange(true);
  assert.equal(render().props.open, true, '用户重新Tab聚焦仍显示说明');
});
test('普通历史按钮执行后离开焦点，不会吞掉下一次键盘提示', async () => {
  const f = await component('生成历史/历史操作按钮.tsx');
  const props = { label: '选择', description: '选择生成图片', icon: 'icon' };
  const render = () => f.render('HistoryActionButton', props);
  render().props.children.props.onClickCapture();
  render().props.children.props.onBlurCapture({ relatedTarget: { closest: () => null } });
  render().props.children.props.onFocusCapture({ target: { matches: () => true } });
  render().props.onOpenChange(true);
  assert.equal(render().props.open, true);
});
