import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { transformWithEsbuild } from '../.运行/3100源/画布副本/web/node_modules/vite/dist/node/index.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../.运行/3100源/画布副本/web');
const nativeRequire = createRequire(resolve(root, 'package.json'));
const modules = new Map();
async function load(path) {
  const file = [path, `${path}.ts`, `${path}.tsx`, `${path}.js`].find(existsSync);
  assert.ok(file, `模块不存在：${path}`);
  if (modules.has(file)) return modules.get(file).exports;
  const module = { exports: {} };
  modules.set(file, module);
  const { code } = await transformWithEsbuild(readFileSync(file, 'utf8'), file, { loader: extname(file) === '.js' ? 'js' : 'ts', format: 'cjs', target: 'es2022', tsconfigRaw: '{}' });
  const imports = new Map();
  for (const [, quoted] of code.matchAll(/require\(("(?:\\.|[^"\\])*\")\)/g)) {
    const id = JSON.parse(quoted);
    if (id.startsWith('@/') || id.startsWith('.')) imports.set(id, await load(id.startsWith('@/') ? resolve(root, 'src', id.slice(2)) : resolve(dirname(file), id)));
  }
  new Function('require', 'module', 'exports', code)(id => imports.has(id) ? imports.get(id) : nativeRequire(id), module, module.exports);
  return module.exports;
}
const { productExcelContext } = await load(resolve(root, 'src/扩展功能/Excel画布/Excel卡片上下文.ts'));
const { excelPromptSource } = await load(resolve(root, 'src/扩展功能/Excel画布/Excel提示词来源.ts'));
const { excelWorkbookPromptSources, excelProductPromptSource, excelWorkbookSourceKey } = await load(resolve(root, 'src/扩展功能/Excel画布/Excel工作簿来源.ts'));
const { planExcelImport } = await load(resolve(root, 'src/扩展功能/Excel/Excel产品归属.ts'));
const { planWorkbookRecycle, planWorkbookRestore } = await load(resolve(root, 'src/扩展功能/Excel删除/Excel回收站规则.ts'));
const updatedAt = '2026-10-22T06:00:00Z';
const template = (id, route, row, prompt) => ({ id, route, sourceRowNumber: row, prompts: { Main: prompt, Detail01: '详情', Video: '视频', Empty: '  ' } });
const scene = () => ({
  projects: [{ id: 'a', productSetId: 'book-a' }, { id: 'b', productSetId: 'book-a' }, { id: 'c', productSetId: 'book-b' }, { id: 'empty' }],
  guanWorkbooks: { contract: {
    workspace: { activeProductSetId: 'book-b', activeProductId: 'c' },
    productSets: [
      { id: 'book-a', source: { fileName: '工具.xlsx', role: 'prompt-products', promptTemplates: [template('ta', '同名工具|材质A', 2, '产品A'), template('tb', '同名工具|材质A', 3, '产品B')] } },
      { id: 'book-b', source: { fileName: '工具.xlsx', role: 'prompt-products', promptTemplates: [template('tc', '同名工具|材质A', 2, '产品C')] } },
    ],
    products: [
      { id: 'a', productSetId: 'book-a', sourceRowNumber: 2, identity: { titleZh: '同名工具|材质A' } },
      { id: 'b', productSetId: 'book-a', sourceRowNumber: 3, identity: { titleZh: '同名工具|材质A' } },
      { id: 'c', productSetId: 'book-b', sourceRowNumber: 2, identity: { titleZh: '同名工具|材质A' } },
    ],
  } },
});
const sourceFor = (snapshot, id, preference) => excelPromptSource(productExcelContext(snapshot, id), updatedAt, preference);

test('已上传Excel自动形成来源，内容和非空条数与工作簿一致', () => {
  const data = scene(), before = JSON.stringify(data), result = sourceFor(data, 'a');
  assert.equal(result.source.name, 'Excel提示词 · 工具');
  assert.equal(result.items.length, 3);
  assert.deepEqual(result.items.map(item => item.prompt), ['产品A', '详情', '视频']);
  assert.ok(result.items.every(item => item.sourceId === result.source.id && item.productId === 'a'));
  assert.equal(result.lastSuccessAt, updatedAt);
  assert.equal(JSON.stringify(data), before);
});

test('同名完整路线按行消歧，切换产品或工作簿不借用全局活动产品', () => {
  const data = scene();
  const sources = ['a', 'b', 'c'].map(id => sourceFor(data, id));
  assert.deepEqual(sources.map(source => source.items[0].prompt), ['产品A', '产品B', '产品C']);
  assert.equal(new Set(sources.map(source => source.source.id)).size, 3);
  assert.equal(new Set(sources.map(source => source.source.url)).size, 3);
});

test('未绑定画布及已删除产品不显示其他产品的Excel来源', () => {
  const data = scene();
  assert.equal(sourceFor(data, 'empty'), null);
  assert.equal(sourceFor(data, 'deleted'), null);
});

test('某产品模板被移除后只显示空来源，不借同名行的内容', () => {
  const data = scene();
  data.guanWorkbooks.contract.productSets[0].source.promptTemplates = [template('other', '其他工具', 8, '其他产品')];
  assert.deepEqual(sourceFor(data, 'a').items, []);
});

test('关闭来源保留可查看内容，改名只作用于当前产品', () => {
  const data = scene(), result = sourceFor(data, 'a', { enabled: false, name: '自用模板', homepage: 'https://example.com' });
  assert.equal(result.source.enabled, false);
  assert.equal(result.source.name, '自用模板');
  assert.equal(result.source.homepage, 'https://example.com');
  assert.equal(result.items.length, 3);
  assert.ok(result.items.every(item => item.category === '自用模板'));
  assert.equal(sourceFor(data, 'b').source.enabled, true);
  assert.equal(sourceFor(data, 'b').source.name, 'Excel提示词 · 工具');
});

test('删除只移除当前来源，Excel重传后重新显示最新内容', () => {
  const data = scene(), original = sourceFor(data, 'a');
  const preference = { removedRevision: original.revision };
  assert.equal(sourceFor(data, 'a', preference), null);
  assert.equal(data.guanWorkbooks.contract.productSets[0].source.promptTemplates.length, 2);
  data.guanWorkbooks.contract.productSets[0].source.promptTemplates[0].prompts.Main = '重传后A';
  const updated = sourceFor(data, 'a', preference);
  assert.equal(updated.items[0].prompt, '重传后A');
  assert.notEqual(updated.source.url, original.source.url);
  assert.equal(updated.source.id, original.source.id);
});

const workbookSources = (snapshot, preferences = {}) => excelWorkbookPromptSources(snapshot.guanWorkbooks?.contract.productSets ?? [], preferences);
const productSource = (snapshot, id, preferences = {}) => {
  const context = productExcelContext(snapshot, id);
  const owner = snapshot.projects.find(project => project.id === id)?.productSetId;
  return excelProductPromptSource(context, snapshot.guanWorkbooks?.contract.productSets.find(book => book.id === owner), preferences);
};

test('设置汇总每本工作簿的全部提示词，同名文件也保持来源和条目身份独立', () => {
  const data = scene();
  data.guanWorkbooks.contract.productSets[1].source.promptTemplates[0].id = 'ta';
  const before = JSON.stringify(data), sources = workbookSources(data);
  assert.equal(sources.length, 2);
  assert.deepEqual(sources.map(source => source.items.length), [6, 3]);
  assert.deepEqual(sources[0].items.filter(item => item.prompt.startsWith('产品')).map(item => item.prompt), ['产品A', '产品B']);
  assert.equal(new Set(sources.map(source => source.source.id)).size, 2);
  assert.equal(new Set(sources.flatMap(source => source.items.map(item => item.id))).size, 9);
  assert.ok(sources.every(source => source.source.name === 'Excel提示词 · 工具'));
  assert.ok(sources.flatMap(source => source.items).every(item => !Object.hasOwn(item, 'productId')), '全簿查看条目不能冒用画布拖放产品ID');
  assert.equal(JSON.stringify(data), before, '读取来源不得改写工作簿或持久化提示词副本');
});

test('切换当前产品/工作簿或打开未绑定画布不改变全量来源，产品列表仍隔离', () => {
  const data = scene(), sources = workbookSources(data);
  data.guanWorkbooks.contract.workspace = { activeProductSetId: 'book-a', activeProductId: 'a' };
  assert.deepEqual(workbookSources(data), sources);
  data.guanWorkbooks.contract.workspace = { activeProductSetId: null, activeProductId: 'empty' };
  assert.deepEqual(workbookSources(data), sources);
  assert.deepEqual(['a', 'b', 'c'].map(id => productSource(data, id).items[0].prompt), ['产品A', '产品B', '产品C']);
  assert.equal(productSource(data, 'empty'), null);
});

test('真实Excel导入规划发布即出现来源，重传更新内容且不重复添加来源', () => {
  const input = { fileName: '上传测试.xlsx', fileSha256: 'source-test', kind: 'xlsx', sheetName: 'Prompts', promptSheetName: 'Prompts',
    promptTemplates: [template('new-a', '新产品A', 2, '上传内容A'), template('new-b', '新产品B', 3, '上传内容B')] };
  const initial = { projects: [], deletedProjects: [], guanWorkbooks: null };
  const imported = planExcelImport(initial, input), first = workbookSources(imported);
  assert.equal(first.length, 1);
  assert.equal(first[0].source.name, 'Excel提示词 · 上传测试');
  assert.equal(first[0].items.length, 6);
  assert.ok(first[0].items.some(item => item.prompt === '上传内容B'));
  const changed = structuredClone(input);
  changed.promptTemplates[0].prompts.Main = '上传修订A';
  const reimported = planExcelImport(imported, changed), next = workbookSources(reimported);
  assert.equal(next.length, 1);
  assert.equal(next[0].source.id, first[0].source.id);
  assert.notEqual(next[0].revision, first[0].revision);
  assert.equal(next[0].items[0].prompt, '上传修订A');
  assert.equal(first[0].items[0].prompt, '上传内容A');
  return { imported };
});

test('工作簿回收不显示来源，真实回收恢复规划后自动显示原内容', () => {
  const data = scene();
  data.deletedProjects = [];
  data.guanWorkbooks.activeByWorkbook = {};
  for (const name of ['importRecords', 'slots', 'prompts', 'tasks', 'runs', 'providerAttempts', 'assets']) data.guanWorkbooks.contract[name] = [];
  const original = workbookSources(data);
  const { entry } = planWorkbookRecycle(data, 'book-a', updatedAt);
  const removed = { ...data, projects: data.projects.filter(project => project.productSetId !== 'book-a'), guanWorkbooks: {
    ...data.guanWorkbooks, recycledWorkbooks: [entry], contract: { ...data.guanWorkbooks.contract,
      productSets: data.guanWorkbooks.contract.productSets.filter(book => book.id !== 'book-a'),
      products: data.guanWorkbooks.contract.products.filter(product => product.productSetId !== 'book-a') } } };
  assert.deepEqual(workbookSources(removed).map(source => source.workbookId), ['book-b']);
  const restored = planWorkbookRestore(removed, 'book-a');
  const restoredSource = workbookSources(restored).find(source => source.workbookId === 'book-a');
  assert.deepEqual(restoredSource, original[0]);
});

test('工作簿级改名和开关联动所属产品但不混入别的产品/工作簿内容，保留旧偏好', () => {
  const data = scene(), key = excelWorkbookSourceKey('book-a');
  const preferences = { a: { enabled: false, name: '旧产品名称' }, [key]: { enabled: true, name: '整簿模板' } };
  assert.equal(productSource(data, 'a', { a: preferences.a }).source.enabled, false);
  const global = workbookSources(data, preferences);
  assert.equal(global[0].source.name, '整簿模板');
  for (const id of ['a', 'b']) {
    const local = productSource(data, id, preferences);
    assert.equal(local.source.enabled, true);
    assert.equal(local.source.name, '整簿模板');
    assert.equal(local.items.length, 3);
    assert.ok(local.items.every(item => item.productId === id));
  }
  assert.equal(productSource(data, 'c', preferences).source.name, 'Excel提示词 · 工具');
  preferences[key].enabled = false;
  assert.equal(workbookSources(data, preferences)[0].items.length, 6, '关闭仍可查看全簿提示词');
  assert.equal(productSource(data, 'b', preferences).source.enabled, false);
});

test('删除工作簿来源不删Excel，重传版本变化后自动恢复，旧产品删除版本仍独立', () => {
  const data = scene(), original = workbookSources(data)[0];
  const preferences = { [original.preferenceKey]: { removedRevision: original.revision } };
  assert.deepEqual(workbookSources(data, preferences).map(source => source.workbookId), ['book-b']);
  assert.equal(productSource(data, 'a', preferences), null);
  assert.equal(productSource(data, 'b', preferences), null);
  assert.ok(productSource(data, 'c', preferences));
  assert.equal(data.guanWorkbooks.contract.productSets.length, 2);
  data.guanWorkbooks.contract.productSets[0].source.promptTemplates[0].prompts.Main = '更新后的A';
  assert.equal(workbookSources(data, preferences)[0].items[0].prompt, '更新后的A');
  assert.equal(productSource(data, 'a', preferences).items[0].prompt, '更新后的A');
  preferences.b = { removedRevision: productSource(data, 'b').revision };
  assert.equal(productSource(data, 'b', preferences), null);
  assert.equal(workbookSources(data, preferences).length, 2);
});
