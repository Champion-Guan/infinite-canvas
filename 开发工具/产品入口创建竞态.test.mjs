import test from 'node:test';
import assert from 'node:assert/strict';
import { ts } from './检查首批功能适配.mjs';
import { 构建产品入口竞态候选 } from './预审产品入口创建竞态.mjs';

const preview = 构建产品入口竞态候选(), entry = [...preview.delta.values()][0];
function render(source, { busy, projects = [{ id: 'synthetic-A' }], hydrated = true }) {
  const exports = {};
  const mocks = {
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }) },
    'react-router-dom': { Navigate: 'Navigate' },
    'react-i18next': { useTranslation: () => ({ t: key => key }) },
    antd: { App: { useApp: () => ({ message: { error() {} } }) } },
    '@/stores/canvas/use-canvas-store': { useCanvasStore: select => select({ projects, hydrated }) },
    '@/stores/use-theme-store': { useThemeStore: select => select({ theme: 'light' }) },
    './上游浏览器存储桥': { sqlitePreferences: { getItem: () => null } },
    './产品操作': { ACTIVE_PRODUCT_KEY: 'synthetic', useProductNavigation: () => ({ busy, createProduct() {} }) },
    './产品规则': { selectEntryProduct: values => values[0]?.id ?? null },
    './工作台首页': { WorkbenchHome: 'WorkbenchHome' },
  };
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function('exports', 'require', js)(exports, name => { if (!mocks[name]) throw Error('未声明依赖：' + name); return mocks[name]; });
  return exports.CanvasEntry();
}
test('复现批准版缺口：创建正在保存，新产品刚入内存就返回Navigate', () => {
  assert.equal(render(entry.原文, { busy: true }).type, 'Navigate');
});
test('虚拟后继在保存中保持首页，避免新画布产生并发初始保存', () => {
  assert.equal(render(entry.产物, { busy: true }).type, 'WorkbenchHome');
});
test('正常完成后仍保留刷新恢复入口', () => {
  const result = render(entry.产物, { busy: false });
  assert.equal(result.type, 'Navigate'); assert.equal(result.props.to, '/canvas/synthetic-A');
});
test('无产品仍为空白首页，未hydrate仍显示加载，不改变其他业务', () => {
  assert.equal(render(entry.产物, { busy: false, projects: [] }).type, 'WorkbenchHome');
  assert.equal(render(entry.产物, { busy: true, hydrated: false }).type, 'main');
});
