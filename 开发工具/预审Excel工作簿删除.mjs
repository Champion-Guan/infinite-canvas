import { existsSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { 根目录, 基线 } from './公共.mjs';
import { 哈希, 检查运行副本 } from './检查运行副本.mjs';
import { 精确替换, 生成审查差异, ts } from './检查首批功能适配.mjs';
import { 预审卡片布局类型 } from './预审卡片自动避让.mjs';
import { 读取Excel卡片隔离记录, 核验Excel卡片完整包 } from './接入Excel卡片与变量隔离副本.mjs';

export const 工作簿删除前置记录 = join(根目录, '.运行/Excel卡片变量-mLSYZd/Excel卡片变量接入记录.json');
export const 工作簿删除旧目录 = '/Users/guanchengbin/CodexProjects/guan-ai-workbench-projects/guan-ai-workbench';
export const 工作簿删除旧指纹 = Object.freeze({
  'src/shared/data-contract/index.js': '1b14b228241b07fa1a4f6fea8956c7f60112ef61bbfc8c33ec151bce5de7bb22',
  'src/shared/data-contract/index.css': '169d3c6de95793d5648e1f673e92307d804a9599010522941e932378d1baccff',
});
export const 工作簿删除自有文件 = ['工作簿删除规则.ts', '工作簿删除门禁.ts', '工作簿删除弹窗.tsx'];

export function 提取旧工作簿删除(source) {
  const ast = ts.createSourceFile('legacy.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS), matches = [];
  const visit = node => { if (ts.isPropertyAssignment(node) && node.name.getText(ast) === 'deleteProductSet') matches.push(node); ts.forEachChild(node, visit); };
  visit(ast);
  if (matches.length !== 1) throw Error('旧工作簿删除声明不唯一');
  const method = matches[0].initializer;
  if (!ts.isArrowFunction(method) || !ts.isBlock(method.body)) throw Error('旧删除声明结构不符');
  const first = method.body.statements[0];
  if (!ts.isVariableStatement(first)) throw Error('旧删除事务起点不符');
  const call = first.declarationList.declarations[0].initializer;
  if (!ts.isCallExpression(call) || call.expression.getText(ast) !== 'mutate' || call.arguments.length !== 1 || !ts.isArrowFunction(call.arguments[0]) || !ts.isBlock(call.arguments[0].body)) throw Error('旧删除事务函数不符');
  const body = call.arguments[0].body.getText(ast);
  const helpers = ast.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === 'requireById');
  if (helpers.length !== 1) throw Error('旧删除辅助函数不唯一');
  const module = '// 旧deleteProductSet的纯mutate回调原文；不带发布、浏览器存储和事件。\n' + helpers[0].getText(ast)
    + '\nexport function deleteLegacyWorkbook(state, productSetId) ' + body + '\n';
  return { body, module, declaration: matches[0].getText(ast) };
}
function oldSources() {
  const map = new Map();
  for (const [path, sha] of Object.entries(工作簿删除旧指纹)) {
    const file = join(工作簿删除旧目录, path), stat = lstatSync(file), source = readFileSync(file, 'utf8');
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || 哈希(source) !== sha) throw Error('旧工作簿删除来源或指纹改变：' + path);
    map.set(path, source);
  }
  return map;
}
export function 构建工作簿删除候选() {
  const integration = 读取Excel卡片隔离记录(工作簿删除前置记录), sources = oldSources(), legacySource = sources.get('src/shared/data-contract/index.js');
  const extracted = 提取旧工作簿删除(legacySource), delta = new Map();
  const read = path => readFileSync(join(integration.副本, path), 'utf8');
  const add = (path, 产物) => { if (existsSync(join(integration.副本, path))) throw Error('工作簿删除新增文件已存在'); delta.set(path, { 原文: null, 产物 }); };
  const edit = (path, changes) => {
    const 原文 = read(path); let 产物 = 原文;
    for (const change of changes) { if (产物.split(change[0]).length !== 2) throw Error('工作簿删除锚点缺失或重复：' + path + ' ' + change[0]); 产物 = 精确替换(产物, [change]); }
    delta.set(path, { 原文, 产物 });
  };
  for (const file of 工作簿删除自有文件) {
    const path = join(根目录, '扩展功能/Excel删除', file), stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw Error('自有删除来源不是独立普通文件');
    add('web/src/guan/' + file, readFileSync(path, 'utf8'));
  }
  add('web/src/guan/旧版工作簿删除.js', extracted.module);
  edit('web/src/guan/产品回收面板.tsx', [['function LegacyProductDialog(', 'export function LegacyProductDialog(']]);
  edit('web/src/guan/Excel工作簿选择.tsx', [
    ['import { ExcelImportPanel }', 'import { WorkbookDeleteDialog } from "./工作簿删除弹窗";\nimport { ExcelImportPanel }'],
    ['  const [file, setFile] = useState<File | null>(null);', '  const [file, setFile] = useState<File | null>(null);\n  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null);'],
    ['className="guan-dc-file-delete" disabled aria-label={`删除 ${set.source.fileName}`} title="工作簿整批删除不在本批迁入范围，暂不开放破坏性操作"', 'className="guan-dc-file-delete" disabled={busy} aria-label={`删除 ${set.source.fileName}`} title="删除 Excel"\n            onClick={event => { event.stopPropagation(); closeMenu(); setDeleting({ id: set.id, name: set.source.fileName }); }}'],
    ['    {file ? <ExcelImportPanel file={file} onClose={closePanel} /> : null}', '    {file ? <ExcelImportPanel file={file} onClose={closePanel} /> : null}\n    {deleting ? <WorkbookDeleteDialog id={deleting.id} name={deleting.name} onClose={() => setDeleting(null)} /> : null}'],
  ]);
  edit('web/src/guan/产品操作.ts', [
    ['import { flushSQLiteStorage, sqlitePreferences }', 'import { flushSQLiteStorage, sqlitePreferences, retrySQLiteStorage }'],
    ['import { commitWorkbookChange }', 'import { planWorkbookDeletion, workbookDeletionIds } from "./工作簿删除规则";\nimport { workbookDeletionGate } from "./工作簿删除门禁";\nimport { commitWorkbookChange }'],
    ['  const busy = useSyncExternalStore(', '  const operationBusy = useSyncExternalStore('],
    ['  const commitCurrent = useCallback(async () => {', '  const pendingWorkbookDeletion = useSyncExternalStore(workbookDeletionGate.subscribe, workbookDeletionGate.getSnapshot, workbookDeletionGate.getSnapshot);\n  const busy = operationBusy || Boolean(pendingWorkbookDeletion);\n  const commitCurrent = useCallback(async () => {\n    if (workbookDeletionGate.getSnapshot()) throw new Error("工作簿删除保存尚未确认，请在原确认框重试保存后继续。");'],
    ['  return { activeId, busy, createProduct, selectProduct, recycleProduct, restoreProduct, selectWorkbook, importWorkbook };', `  const deleteWorkbook = useCallback((owner: string, retry = false) => operations.run(async () => {
    const pending = workbookDeletionGate.getSnapshot();
    if (pending && pending !== owner) throw new Error("上一次工作簿删除尚未确认，请先重试保存。");
    if (retry) await retrySQLiteStorage();
    const ensureStopped = () => {
      const state = useCanvasStore.getState();
      const ids = workbookDeletionIds(state, owner);
      for (const id of ids) if (deletionGuards.get(id)?.() === false)
        throw new Error("该工作簿有生成任务运行中，请等待任务结束后再删除。");
      planWorkbookDeletion(state, owner, activeId);
      return ids;
    };
    await workbookDeletionGate.run(owner, {
      async commitCurrent() {
        ensureStopped();
        await commitCurrent();
        for (const id of ensureStopped()) if (id !== activeId && deletionGuards.has(id)) await saves.flush(id);
        await flushSQLiteStorage();
        ensureStopped();
      },
      plan: () => planWorkbookDeletion(withVisibleSelection(useCanvasStore.getState(), activeId), owner, activeId),
      publish: value => useCanvasStore.setState(value.state),
      isPublished: () => !useCanvasStore.getState().guanWorkbooks?.contract.productSets.some(book => book.id === owner),
      flush: flushSQLiteStorage,
      async navigate(value) {
        if (value.navigate) await finishWorkbook(useCanvasStore.getState());
      },
    });
  }), [activeId, commitCurrent, finishWorkbook]);
  return { activeId, busy, operationBusy, pendingWorkbookDeletion, createProduct, selectProduct, recycleProduct, restoreProduct, selectWorkbook, importWorkbook, deleteWorkbook };`],
  ]);
  核验Excel卡片完整包(integration.组合包, true);
  return { integration, delta, legacySource, legacyModule: extracted.module, extracted };
}
export function 预审工作簿删除(generate = false) {
  检查运行副本();
  const preview = 构建工作簿删除候选();
  预审卡片布局类型({ ...preview, delta: new Map([...preview.delta].filter(([file]) => /\.[jt]sx?$/.test(file))) });
  const patch = 生成审查差异(preview.delta);
  const manifest = { 日期: '2026-10-19', 状态: '待具体批准；仅内存候选，未接入/启动/重启3100', 上游提交: 基线.提交,
    前置记录: 工作簿删除前置记录, 前置差异SHA256: preview.integration.差异SHA256,
    旧来源目录: 工作簿删除旧目录, 旧来源SHA256: 工作簿删除旧指纹,
    旧删除函数体SHA256: 哈希(preview.extracted.body), 旧删除声明SHA256: 哈希(preview.extracted.declaration),
    自有来源: 工作簿删除自有文件.map(file => ({ 文件: '扩展功能/Excel删除/' + file, SHA256: 哈希(readFileSync(join(根目录, '扩展功能/Excel删除', file))) })),
    工具来源: ['开发工具/预审Excel工作簿删除.mjs', '开发工具/Excel工作簿删除.test.mjs'].map(文件 => ({ 文件, SHA256: 哈希(readFileSync(join(根目录, 文件))) })),
    差异SHA256: 哈希(patch), 文件数: preview.delta.size, 完整虚拟类型检查通过: true,
    已接入: false, 真实浏览器验收: false, 已修改作者仓库: false, 已访问正式数据: false,
    文件: [...preview.delta].map(([文件, item]) => ({ 文件, 原始SHA256: item.原文 === null ? null : 哈希(item.原文), 候选SHA256: 哈希(item.产物) })),
    范围: ['旧工作簿下拉删除入口/确认布局/危险操作文案，级联删除纯函数原文提取',
      '稳定工作簿ID、当前/后台产品检查点、运行/未决任务及回收站保护；不调用媒体文件清理',
      '跨归属冲突或旧级联未覆盖的自建产品关联记录明确拒绝，不扩大旧删除范围或遗留悬空记录',
      '同一产品操作锁，根ACK及导航确认前保持门禁；失败原队列显式重试，不重放旧快照',
      '后台删除保留当前产品；删除最后工作簿不造新产品；不做收费AI校准或生成调度',
      '仅批准后新独立完整包事务接入，再临时SQLite/独立浏览器/合成工作簿和旧版视觉验收；不含3100切换/发布'] };
  if (generate) {
    const outputs = [['patch', patch], ['json', JSON.stringify(manifest, null, 2) + '\n']]
      .map(([ext, value]) => [join(根目录, '上游适配/待审查/Excel工作簿删除.' + ext), value]);
    if (outputs.some(([path]) => existsSync(path))) throw Error('拒绝覆盖既有审查对象，请另建修订批次');
    for (const [path, value] of outputs) writeFileSync(path, value, { flag: 'wx', mode: 0o600 });
  }
  核验Excel卡片完整包(preview.integration.组合包, true); 检查运行副本();
  return manifest;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.slice(2).some(arg => arg !== '--生成审查差异')) throw Error('仅内存预审及生成审查；不接入或启动');
  console.log(JSON.stringify(预审工作簿删除(process.argv.includes('--生成审查差异')), null, 2));
}
