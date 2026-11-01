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
    useRef: value => ({ current: value }), useCallback: fn => fn, useEffect: fn => effects.push(fn), useLayoutEffect: fn => effects.push(fn),
    useState(initial) {
      const slot = index++;
      if (!(slot in state)) state[slot] = initial;
      return [state[slot], next => { state[slot] = typeof next === 'function' ? next(state[slot]) : next; }];
    },
  };
  const modules = {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'motion/react': { motion: { div: 'motion.div', button: 'motion.button', section: 'motion.section' }, useReducedMotion: () => reducedMotion },
    'react-dom': { createPortal: node => node },
    antd: { App: { useApp: () => ({ message: { error() {} } }) }, Tooltip: 'tooltip' },
    '@/lib/utils': { cn: (...parts) => parts.filter(Boolean).join(' ') },
    '@/stores/canvas/use-canvas-store': { useCanvasStore: selector => selector({ projects: [], guanWorkbooks: null }) },
    '@/stores/use-theme-store': { useThemeStore: selector => selector({ theme: 'light' }) },
    '../产品/产品操作': { useProductNavigation: () => ({ activeId: null, busy: false, selectWorkbook() {} }) },
    './Excel产品归属': { visibleWorkbookId: () => null },
    './旧版Excel弹窗.js': { excelImportMarkup: () => '<header>导入预览</header>', updateExcelImportSelection() {} },
    './Excel文件读取': { readExcelFile: () => new Promise(() => {}) },
  };
  new Function('require', 'module', 'exports', 'document', 'HTMLElement', code)(
    name => modules[name] ?? {}, module, module.exports, { activeElement: null, body: {} }, class {});
  return { render(name, props) { index = 0; return module.exports[name](props); }, state, effects, source };
}
function menu(tree) { return tree.props.children[0].props.children[1]; }
function trigger(tree) { return tree.props.children[0].props.children[0]; }

test('工作簿菜单快速反转从当前动画继续，旧关闭完成回调不能隐藏重新打开的菜单', async () => {
  const f = await component('Excel/Excel工作簿选择.tsx');
  const render = () => f.render('ExcelWorkbookPicker');
  trigger(render()).props.onClick();
  assert.equal(menu(render()).props['data-state'], 'opening');
  menu(render()).props.onAnimationComplete();
  trigger(render()).props.onClick();
  const closing = menu(render());
  assert.equal(closing.props.inert, true);
  trigger(render()).props.onClick();
  closing.props.onAnimationComplete();
  const reopened = menu(render());
  assert.equal(reopened.props.hidden, false);
  assert.equal(reopened.props.inert, false);
  assert.equal(reopened.props.animate.opacity, 1);
  trigger(render()).props.onClick();
  menu(render()).props.onAnimationComplete();
  assert.equal(menu(render()).props.hidden, true);
  assert.doesNotMatch(f.source, /setTimeout/);
});
test('Excel关闭由弹簧完成回调提交，进出同一路径；减少动态效果时不缩放', async () => {
  for (const reduced of [false, true]) {
    const f = await component('Excel/Excel导入面板.tsx', reduced);
    let closed = 0;
    const render = () => f.render('ExcelImportPanel', { file: { name: '验收.xlsx' }, onClose: () => closed++ });
    const modal = render().props.children, entering = modal.props.children[1];
    assert.equal(entering.type, 'motion.section');
    assert.deepEqual(entering.props.initial, { opacity: 0, y: reduced ? 0 : 8, scale: reduced ? 1 : .97 });
    modal.props.onKeyDown({ key: 'Escape', stopPropagation() {} });
    const exiting = render().props.children.props.children[1];
    assert.deepEqual(exiting.props.animate, entering.props.initial);
    assert.equal(closed, 0);
    entering.props.onAnimationComplete();
    assert.equal(closed, 0, '旧进入回调不能提前关闭');
    exiting.props.onAnimationComplete();
    assert.equal(closed, 1);
    assert.doesNotMatch(f.source, /setTimeout/);
  }
});
test('减少动态效果时菜单不缩放、不位移，也不保留固定动画等待', async () => {
  const f = await component('Excel/Excel工作簿选择.tsx', true);
  const render = () => f.render('ExcelWorkbookPicker');
  trigger(render()).props.onClick();
  const current = menu(render());
  assert.deepEqual(current.props.animate, { opacity: 1, y: 0, scale: 1 });
  assert.deepEqual(current.props.transition, { duration: 0 });
  current.props.onAnimationComplete();
  assert.equal(menu(render()).props['data-state'], 'open');
});
test('历史按钮保留原点击、提示及禁用语义，减少动态效果和禁用状态不缩放', async () => {
  for (const reduced of [false, true]) {
    const f = await component('生成历史/历史操作按钮.tsx', reduced);
    let calls = 0;
    const props = { label: '重试', description: '重试失败图片', icon: 'icon', onClick: () => calls++ };
    const button = f.render('HistoryActionButton', props).props.children.props.children;
    assert.equal(button.type, 'motion.button'); assert.equal(button.props['aria-label'], '重试');
    button.props.onClick(); assert.equal(calls, 1);
    assert.deepEqual(button.props.whileTap, reduced ? undefined : { scale: .96 });
    const disabled = f.render('HistoryActionButton', { ...props, disabled: true }).props.children.props.children;
    assert.equal(disabled.props.disabled, true); assert.equal(disabled.props.whileTap, undefined);
  }
});
