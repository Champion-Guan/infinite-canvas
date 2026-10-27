import { existsSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { 根目录, 基线 } from './公共.mjs';
import { 哈希, 检查运行副本 } from './检查运行副本.mjs';
import { 精确替换, 生成审查差异, ts } from './检查首批功能适配.mjs';
import { 预审卡片布局类型 } from './预审卡片自动避让.mjs';
import { 读取恢复挂载隔离记录, 核验恢复挂载完整包 } from './接入产品恢复挂载隔离副本.mjs';

export const Excel前置记录 = join(根目录, '.运行/产品恢复挂载-HsicAv/产品恢复挂载接入记录.json');
export const Excel旧目录 = '/Users/guanchengbin/CodexProjects/guan-ai-workbench-projects/guan-ai-workbench';
export const Excel旧指纹 = Object.freeze({
  'src/shared/data-contract/index.js': '1b14b228241b07fa1a4f6fea8956c7f60112ef61bbfc8c33ec151bce5de7bb22',
  'src/shared/data-contract/index.css': '169d3c6de95793d5648e1f673e92307d804a9599010522941e932378d1baccff',
  'src/shared/data-contract/workbook-canvas-products.js': '8bb43e6bf44f74e3c6c18bacc46e2d9135a6170bc05eaead8922f79dccfb61bb',
  'public/assets/local-vendor/xlsx.full.min.js': 'c9506197caf809a075b6dee1da0d36fb19da7158ffe8a88e7b0c96c5d8623c99',
  'tests/excel-reupload-sync.test.mjs': 'd5a9335cae0d6a0d086e1ea9499cc0ae3db3fbb623d0b3e344c369d30551fce9',
  'tests/workbook-canvas-products.test.mjs': 'ec2d607c10c95af41c938c367c10416a1b0a38dbb62abaf48ced9ab552c4320e',
});
export const Excel自有文件 = ['Excel产品归属.ts', 'Excel文件读取.ts', 'Excel保存导航.ts', 'Excel导入面板.tsx', 'Excel工作簿选择.tsx'];
function slice(source, start, end) {
  if (source.split(start).length !== 2) throw Error('Excel提取起点不唯一：' + start);
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  if (b < 0) throw Error('Excel提取终点缺失：' + end);
  return source.slice(a, b);
}
function functions(source, names) {
  const ast = ts.createSourceFile('legacy.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  return names.map(name => {
    const matches = ast.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
    if (matches.length !== 1) throw Error('旧Excel函数不唯一：' + name);
    return source.slice(matches[0].getStart(ast), matches[0].end);
  }).join('\n\n') + '\n';
}
export function 提取Excel旧模块(legacy) {
  const source = legacy.get('src/shared/data-contract/index.js'), css = legacy.get('src/shared/data-contract/index.css');
  const parserFunctions = functions(source, ['normalizeHeader', 'cellValueForImport', 'sheetNameLooksLikePrompt', 'valueAt', 'rowValues', 'rowText', 'promptColumnLabel', 'findPromptSectionRow', 'parsePromptSheet', 'findPromptSheetCandidate', 'promptTemplatesFromParsed']);
  const parser = `// 旧解析函数原文提取；只将全局XLSX改为工厂形参，不安装旧DOM/存储桥。\nexport function createExcelParser(XLSX) {\nconst MAX_IMPORT_ROWS = 10000, MAX_IMPORT_COLUMNS = 200;\n${parserFunctions}\nreturn { parsePromptSheet, findPromptSheetCandidate, promptTemplatesFromParsed, promptColumnLabel };\n}\nexport function parsePromptWorkbook(XLSX, workbook) {\n  const sheetNames = [...workbook.SheetNames];\n  if (!sheetNames.length) throw new Error("文件中没有工作表");\n  const { findPromptSheetCandidate, promptTemplatesFromParsed } = createExcelParser(XLSX);\n  const candidate = findPromptSheetCandidate(workbook, sheetNames);\n  if (!candidate) throw new Error("未找到可识别的提示词工作表。Data 和前面的分析工作表只作为竞品参考，不能作为待生成商品导入。");\n  const promptTemplates = promptTemplatesFromParsed(candidate.parsed);\n  if (!promptTemplates.length) throw new Error(\`工作表「\${candidate.sheetName}」没有识别到可导入的提示词产品行。请确认一行对应一个产品，并包含 Main Prompt、Detail Prompt 或 Rich Prompt 列。\`);\n  return { ...candidate, promptTemplates };\n}\n`;
  const contractFunctions = functions(source, ['timestamp', 'createId', 'clone', 'createEmptyState', 'requireById', 'normalizePurpose', 'createProductSetInternal', 'normalizeHeader', 'createProductInternal', 'createSlotInternal', 'buildSlotTemplates']);
  const importer = slice(source, '  importPromptProducts: (input = {}) => clone(mutate((state) => {', '\n  // Backward-compatible API name');
  const body = importer.slice(importer.indexOf('=> {') + 4, importer.lastIndexOf('  })),')).trim();
  const contract = `// 旧数据合同的创建和重传函数逐字提取，存储/导航由SQLite宿主负责。\nconst CONTRACT_SCHEMA = "guan-workbench.v1";\nconst PURPOSE_ORDER = ["product-main", "product-secondary", "product-detail", "product-a-plus", "product-video", "custom"];\n${contractFunctions}\nexport const createEmptyWorkbook = createEmptyState;\nexport function importPromptProducts(state, input = {}) {\nconst counts = { main: 1, secondary: 10, detail: 6 };\ninput = { slotCounts: counts, slotTemplates: buildSlotTemplates(counts), ...input };\n${body}\n}\n`;
  const markupBody = slice(source, '  const progress = Math.max(0, Math.min(100, Number(pending.progress || 0)));', '\n}\n\nfunction updateExcelImportSelection');
  const markup = '// 旧弹窗HTML/转义/勾选更新原文；只能挂载到自有React弹窗根。\n'
    + functions(source, ['escapeHtml']) + '\nexport function excelImportMarkup(pending) {\n'
    + 精确替换(markupBody, [['  dialog.innerHTML = `', '  return `']]) + '\n}\n\nexport '
    + functions(source, ['updateExcelImportSelection']);
  // 只取本功能拥有的样式，旧产品/首页/作者选择器不带入。
  const style = [slice(css, '\n.guan-dc-file-picker {', '\n.guan-dc-confirm {'),
    slice(css, '\n.guan-dc-excel-import-modal {', '\nhtml[data-workbench-theme="dark"] .guan-dc-confirm-backdrop'),
    slice(css, 'html[data-workbench-theme="dark"] .guan-dc-excel-import-modal {', '\n.guan-dc-header-file-input {'),
    slice(css, '.guan-dc-header-file-input {', '\n.guan-dc-header-controls ~'),
    slice(css, 'html[data-workbench-theme="dark"] .guan-dc-file-trigger,', '\n@media (max-width: 820px)')].join('\n');
  const styles = '/* 原样提取旧Excel专属样式；仅把主题宿主换为自有scope。 */\n'
    + '.guan-excel-scope { display: contents; --dc-bg:#ffffff; --dc-text:#17181a; --dc-muted:#72757a; --dc-border:rgba(20,24,32,.12); --dc-soft:rgba(20,24,32,.045); }\n'
    + '.guan-excel-scope[data-theme="dark"] { --dc-bg:#1d1e20; --dc-text:#f4f4f5; --dc-muted:#a1a1aa; --dc-border:rgba(255,255,255,.14); --dc-soft:rgba(255,255,255,.06); }\n'
    + style.replaceAll('html[data-workbench-theme="dark"]', '.guan-excel-scope[data-theme="dark"]')
    + '\n@media(max-width:820px) { .guan-dc-file-picker { width:min(210px,30vw); min-width:140px; } }\n@media(max-width:640px) { .guan-dc-file-picker { width:min(175px,34vw); min-width:118px; } .guan-dc-file-trigger { height:40px; padding-left:10px; font-size:12px; } }\n'
    + '@media(prefers-reduced-motion:reduce) { .guan-excel-scope *, .guan-excel-scope *::before, .guan-excel-scope *::after { animation:none!important; transition:none!important; } }\n';
  return { parser, contract, markup, styles, parserFunctions, contractFunctions, importer, markupBody };
}
export function 读取Excel来源() {
  const legacy = new Map();
  for (const [path, hash] of Object.entries(Excel旧指纹)) {
    const file = join(Excel旧目录, path), stat = lstatSync(file), value = readFileSync(file, 'utf8');
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || 哈希(value) !== hash) throw Error('旧Excel来源或指纹改变：' + path);
    legacy.set(path, value);
  }
  return legacy;
}
export function 构建Excel候选() {
  const integration = 读取恢复挂载隔离记录(Excel前置记录), legacy = 读取Excel来源(), snippets = 提取Excel旧模块(legacy), delta = new Map();
  const read = path => readFileSync(join(integration.副本, path), 'utf8');
  const edit = (path, changes) => {
    const 原文 = read(path); let 产物 = 原文;
    for (const change of changes) {
      if (产物.split(change[0]).length !== 2) throw Error('Excel适配锚点缺失或重复：' + path + ' ' + JSON.stringify(change[0]));
      产物 = 精确替换(产物, [change]);
    }
    delta.set(path, { 原文, 产物 });
  };
  const add = (path, content) => { if (existsSync(join(integration.副本, path))) throw Error('新增Excel路径已存在'); delta.set(path, { 原文: null, 产物: content }); };
  for (const file of Excel自有文件) add('web/src/guan/' + file, readFileSync(join(根目录, '扩展功能/Excel', file), 'utf8'));
  for (const [file, key] of [['旧版Excel解析.js', 'parser'], ['旧版Excel合同.js', 'contract'], ['旧版Excel弹窗.js', 'markup'], ['旧版Excel样式.css', 'styles']]) add('web/src/guan/' + file, snippets[key]);
  add('web/public/guan/Excel/xlsx.full.min.js', legacy.get('public/assets/local-vendor/xlsx.full.min.js'));
  add('web/public/guan/Excel/SheetJS-LICENSE.txt', readFileSync(join(根目录, '扩展功能/Excel/SheetJS-LICENSE.txt'), 'utf8'));
  edit('web/src/stores/canvas/use-canvas-store.ts', [
    ['import { nextProductTitle }', 'import { assertWorkbookSnapshot, currentWorkbookId, type ExcelWorkbooks } from "@/guan/Excel产品归属";\nimport { nextProductTitle }'],
    ['export type CanvasProject = {', 'export type CanvasProject = {\n    productSetId?: string | null;'],
    ['type CanvasStore = {', 'type CanvasStore = {\n    guanWorkbooks: ExcelWorkbooks | null;'],
    ['Pick<CanvasStore, "projects" | "deletedProjects">', 'Pick<CanvasStore, "projects" | "deletedProjects" | "guanWorkbooks">'],
    ['        queuedPersistState = parsed.state', '        assertWorkbookSnapshot(parsed.state);\n        queuedPersistState = parsed.state'],
    ['queuedPersistState.deletedProjects === nextState.deletedProjects)', 'queuedPersistState.deletedProjects === nextState.deletedProjects && queuedPersistState.guanWorkbooks === nextState.guanWorkbooks)'],
    ['            hydrated: false,', '            hydrated: false,\n            guanWorkbooks: null,'],
    ['                    id,\n                    title,', '                    id,\n                    ...(get().guanWorkbooks ? { productSetId: currentWorkbookId(get().guanWorkbooks) } : {}),\n                    title,'],
    ['                    id: nanoid(),\n                    title: source.title', '                    id: nanoid(),\n                    productSetId: currentWorkbookId(get().guanWorkbooks),\n                    title: source.title'],
    ['                    projects: state.projects,\n                    deletedProjects:', '                    projects: state.projects,\n                    guanWorkbooks: state.guanWorkbooks,\n                    deletedProjects:'],
    ['            onRehydrateStorage: () => () => {\n                useCanvasStore.setState({ hydrated: true });', '            onRehydrateStorage: () => (_state, error) => {\n                if (error) { console.error("产品数据加载失败，未作为空库继续。", error); return; }\n                useCanvasStore.setState({ hydrated: true });'],
  ]);
  edit('web/src/guan/旧版首页顶栏.tsx', [
    ['import { ProductCapsules }', 'import { ExcelWorkbookPicker } from "./Excel工作簿选择";\nimport { ProductCapsules }'],
    ['      <button type="button" className={styles.fileTrigger} aria-label="选择已上传的 Excel 文件" disabled title={pending}><span>暂无已上传 Excel</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg></button>', '      <ExcelWorkbookPicker />'],
  ]);
  edit('web/src/guan/顶部产品胶囊.tsx', [
    ['import { orderedProducts }', 'import { orderedWorkbookProjects, visibleWorkbookId } from "./Excel产品归属";\nimport { orderedProducts }'],
    ['  const products = useCanvasStore(selector);', '  const allProducts = useCanvasStore(selector);\n  const ownership = useCanvasStore(state => orderedWorkbookProjects(state.projects, visibleWorkbookId(state, activeId), state.guanWorkbooks?.contract.products).map(project => project.id).join("\\n"));\n  const byId = new Map(allProducts.map(product => [product.id, product]));\n  const products = ownership.split("\\n").flatMap(id => byId.get(id) ? [byId.get(id)!] : []);'],
    ['  const allProducts = useCanvasStore(selector);\n', '  const { activeId, busy, selectProduct } = useProductNavigation();\n  const allProducts = useCanvasStore(selector);\n'],
    ['  const { activeId, busy, selectProduct } = useProductNavigation();\n  const [lastSelectedId', '  const [lastSelectedId'],
  ]);
  edit('web/src/guan/画布入口.tsx', [
    ['import { selectEntryProduct } from "./产品规则";', 'import { workbookEntry } from "./Excel产品归属";\nimport { productRestoreMountGate } from "./产品恢复挂载门禁";'],
    ['  const projects = useCanvasStore(state => state.projects);', '  const id = useCanvasStore(state => workbookEntry(state, undefined, sqlitePreferences.getItem(ACTIVE_PRODUCT_KEY)));'],
    ['  const id = selectEntryProduct(projects, sqlitePreferences.getItem(ACTIVE_PRODUCT_KEY));\n', ''],
    ['  if (id && !busy && !removedRouteProduct)', '  if (id && !busy && !removedRouteProduct && !productRestoreMountGate.getSnapshot().includes(id))'],
  ]);
  edit('web/src/guan/产品操作.ts', [
    ['import { productRestoreMountGate }', 'import { commitWorkbookChange } from "./Excel保存导航";\nimport { visibleWorkbookId, withVisibleSelection, planExcelImport, rememberWorkbookProduct, selectWorkbook as planWorkbookSelection, workbookEntry, workbookProjects, type ExcelImportInput, type WorkbookSnapshot } from "./Excel产品归属";\nimport { productRestoreMountGate }'],
    ['        if (id === activeId) return;\n        await commitCurrent();', '        if (id === activeId) return;\n        const state = useCanvasStore.getState();\n        if (!workbookProjects(state.projects, visibleWorkbookId(state, activeId)).some(project => project.id === id)) throw new Error("该产品不属于当前工作表。");\n        await commitCurrent();'],
    ['        const id = useCanvasStore.getState().createProject();', '        const current = withVisibleSelection(useCanvasStore.getState(), activeId);\n        useCanvasStore.setState({ guanWorkbooks: current.guanWorkbooks });\n        const id = useCanvasStore.getState().createProject();'],
    ['    [commitCurrent, enter],\n  );\n  const recycleProduct', '    [activeId, commitCurrent, enter],\n  );\n  const recycleProduct'],
    ['      const previous = sqlitePreferences.getItem(ACTIVE_PRODUCT_KEY);', '      const remembered = rememberWorkbookProduct(useCanvasStore.getState(), id);\n      if (remembered) useCanvasStore.setState({ guanWorkbooks: remembered });\n      await flushSQLiteStorage();\n      const previous = sqlitePreferences.getItem(ACTIVE_PRODUCT_KEY);'],
    ['      const before = useCanvasStore.getState();\n      const planned = planProductRecycle', '      const before = useCanvasStore.getState();\n      const planned = planProductRecycle'],
    ['        const target = current.projects.find(item => item.id === next)?.id || orderedProducts(current.projects)[0]?.id;', '        const scoped = workbookProjects(current.projects, before.projects.find(project => project.id === id)?.productSetId ?? null);\n        const target = scoped.find(item => item.id === next)?.id || orderedProducts(scoped)[0]?.id;'],
    ['  return { activeId, busy, createProduct, selectProduct, recycleProduct, restoreProduct };', `  const finishWorkbook = useCallback(async (value: WorkbookSnapshot) => {
    const id = workbookEntry(value);
    if (id) await enter(id);
    else {
      sqlitePreferences.removeItem(ACTIVE_PRODUCT_KEY);
      await flushSQLiteStorage();
      navigate("/", { replace: true });
    }
  }, [enter, navigate]);
  const selectWorkbook = useCallback((owner: string | null) => operations.run(() => commitWorkbookChange({
    commitCurrent,
    plan: () => { const state = withVisibleSelection(useCanvasStore.getState(), activeId); return { ...state, guanWorkbooks: planWorkbookSelection(state, owner) }; },
    publish: value => useCanvasStore.setState({ guanWorkbooks: value.guanWorkbooks }),
    flush: flushSQLiteStorage, navigate: finishWorkbook,
  })), [activeId, commitCurrent, finishWorkbook]);
  const importWorkbook = useCallback((input: ExcelImportInput) => operations.run(() => commitWorkbookChange({
    commitCurrent,
    plan: () => planExcelImport(withVisibleSelection(useCanvasStore.getState(), activeId), input),
    publish: value => {
      const old = new Set(useCanvasStore.getState().projects.map(project => project.id));
      for (const project of value.projects) if (!old.has(project.id)) productRestoreMountGate.block(project.id);
      useCanvasStore.setState(value);
    },
    flush: flushSQLiteStorage, navigate: finishWorkbook,
  })), [activeId, commitCurrent, finishWorkbook]);
  return { activeId, busy, createProduct, selectProduct, recycleProduct, restoreProduct, selectWorkbook, importWorkbook };`],
  ]);
  核验恢复挂载完整包(integration.组合包, true);
  return { integration, legacy, snippets, delta };
}
export function 预审Excel类型(preview) {
  return 预审卡片布局类型({ ...preview, delta: new Map([...preview.delta].filter(([path]) => /^web\/src\/.*\.[jt]sx?$/.test(path))) });
}
export function 预审Excel迁入(generate = false) {
  检查运行副本();
  const preview = 构建Excel候选(); 预审Excel类型(preview);
  const patch = 生成审查差异(preview.delta);
  const manifest = {
    日期: '2026-10-19', 状态: '待具体差异单独批准；未接入隔离副本或3100', 上游提交: 基线.提交,
    前置记录: Excel前置记录, 前置差异SHA256: preview.integration.差异SHA256,
    旧来源目录: Excel旧目录, 旧来源SHA256: Excel旧指纹,
    原样片段SHA256: Object.fromEntries(['parserFunctions', 'contractFunctions', 'importer', 'markupBody'].map(key => [key, 哈希(preview.snippets[key])])),
    自有来源: [...Excel自有文件, 'SheetJS-LICENSE.txt'].map(file => ({ 文件: '扩展功能/Excel/' + file, SHA256: 哈希(readFileSync(join(根目录, '扩展功能/Excel', file))) })),
    差异SHA256: 哈希(patch), 文件数: preview.delta.size, 完整虚拟候选类型检查通过: true,
    已接入: false, 已重启3100: false, 真实浏览器验收: false,
    文件: [...preview.delta].map(([文件, item]) => ({ 文件, 原始SHA256: item.原文 === null ? null : 哈希(item.原文), 候选SHA256: 哈希(item.产物) })),
    范围: ['旧XLSX/XLS/UTF-8 CSV解析、提示词矩阵选择、产品勾选、进度与错误弹窗',
      '工作簿选择、产品归属、同名完整路线区分、重传保留ID/画布/媒体、每工作簿选择记忆',
      '工作簿合同与产品同SQLite分片根保存；复用现有保存ACK、操作锁及挂载门禁',
      '保留本地SheetJS 0.18.5文件版权头及该版本Apache-2.0许可证，不增npm依赖',
      '不含工作簿整批删除、生成提示词节点/变量绑定、旧真实数据迁入、3100切换或发布',
      '批准后另建完整后继保护器、原态事务快照及临时SQLite真实浏览器/同尺寸主题视觉验收'],
  };
  if (generate) for (const [ext, value] of [['patch', patch], ['json', JSON.stringify(manifest, null, 2) + '\n']]) {
    const path = join(根目录, '上游适配/待审查/Excel导入与工作簿迁入.' + ext);
    if (existsSync(path)) throw Error('拒绝覆盖已有Excel审查产物，请另建修订批次');
    writeFileSync(path, value, { flag: 'wx', mode: 0o600 });
  }
  核验恢复挂载完整包(preview.integration.组合包, true); 检查运行副本();
  return manifest;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.slice(2).some(arg => arg !== '--生成审查差异')) throw Error('仅支持内存预审及生成审查，不接入或启动');
  console.log(JSON.stringify(预审Excel迁入(process.argv.includes('--生成审查差异')), null, 2));
}
