import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { 根目录, 基线 } from './公共.mjs';
import { 哈希, 检查运行副本 } from './检查运行副本.mjs';
import { 精确替换, 生成审查差异, ts } from './检查首批功能适配.mjs';
import { 读取产品入口隔离记录 } from './接入产品入口竞态隔离副本.mjs';
import { 读取产品旧来源, 产品旧来源指纹 } from './预审产品核心迁入.mjs';

export const 产品删除前置记录 = join(根目录, '.运行/产品入口竞态-gLU7Bv/产品入口竞态接入记录.json');
export const 产品删除自有来源 = ['扩展功能/产品/产品回收规则.ts', '扩展功能/产品/产品回收面板.tsx'];

function localizedLegacyCSS(source, web) {
  const require = createRequire(join(web, 'package.json'));
  const postcss = createRequire(require.resolve('vite/package.json'))('postcss');
  const sheet = postcss.parse(source), result = [];
  const wanted = selector => /\.guan-product-delete|\.guan-product-capsule-wrap:(hover|focus-within)|\.guan-product-file-note|\.guan-product-trash-(card|list|row)|\.guan-dc-confirm-(card|icon|copy|actions)/.test(selector);
  const localize = selector => {
    const dark = selector.startsWith('html[data-workbench-theme="dark"] ');
    const base = dark ? selector.slice('html[data-workbench-theme="dark"] '.length) : selector;
    return (dark ? ':global(.dark) ' : '') + '.root :global(' + base + ')';
  };
  for (const node of sheet.nodes) {
    if (node.type === 'rule' && wanted(node.selector)) {
      const copy = node.clone(); copy.selector = node.selectors.map(localize).join(', '); result.push(copy.toString());
    } else if (node.type === 'atrule' && node.name === 'media' && node.params === '(hover: none)') {
      const copy = node.clone(); copy.walkRules(rule => { rule.selector = rule.selectors.map(localize).join(', '); }); result.push(copy.toString());
    } else if (node.type === 'atrule' && node.name === 'keyframes' && /^guan-dc-(confirm-(in|out)|row-in)$/.test(node.params)) result.push(node.toString());
  }
  result.push('.root { --dc-muted: #72757a; --dc-border: rgba(20, 24, 32, .12); --dc-soft: #f5f5f5; }\n:global(.dark) .root { --dc-muted: #a1a1aa; --dc-border: rgba(255, 255, 255, .14); --dc-soft: #27282b; }\n.legacyModal { max-width: calc(100vw - 32px); }\n@media (prefers-reduced-motion: reduce) { .root :global(.guan-product-delete), .root :global(.guan-dc-confirm-card), .root :global(.guan-product-trash-row), .root :global(.guan-product-trash-row button) { animation: none !important; transition: none !important; } }');
  return '\n/* 下列实际样式来自锁定旧项目；仅局部化选择器及现有.dark主题。 */\n' + result.join('\n') + '\n';
}

// 只组装内存候选；不修改冻结源文件、运行包、历史批准或数据。
export function 构建产品悬浮删除候选() {
  const integration = 读取产品入口隔离记录(产品删除前置记录), legacy = 读取产品旧来源(), delta = new Map();
  const read = path => readFileSync(join(integration.副本, path), 'utf8');
  const edit = (path, changes) => delta.set(path, { 原文: read(path), 产物: 精确替换(read(path), changes) });
  for (const source of 产品删除自有来源) {
    const path = 'web/src/guan/' + source.split('/').at(-1);
    if (existsSync(join(integration.副本, path))) throw Error('新增产品回收模块路径已存在');
    delta.set(path, { 原文: null, 产物: readFileSync(join(根目录, source), 'utf8') });
  }
  edit('web/src/stores/canvas/use-canvas-store.ts', [
    ['export type CanvasDeletedProject = {\n    id: string;\n    deletedAt: string;\n};', 'export type CanvasDeletedProject = {\n    id: string;\n    deletedAt: string;\n    project?: CanvasProject;\n    nextProductId?: string;\n};'],
  ]);
  edit('web/src/stores/use-asset-store.ts', [
    ['import { create } from "zustand";', 'import { create } from "zustand";\nimport { projectsWithRecycleMedia } from "@/guan/产品回收规则";'],
    ['                    await cleanupUnusedImages({ assets: get().assets, projects: useCanvasStore.getState().projects, extra });\n                    await cleanupUnusedMedia({ assets: get().assets, projects: useCanvasStore.getState().projects, extra });', '                    const projects = projectsWithRecycleMedia(useCanvasStore.getState());\n                    await cleanupUnusedImages({ assets: get().assets, projects, extra });\n                    await cleanupUnusedMedia({ assets: get().assets, projects, extra });'],
  ]);
  edit('web/src/guan/产品操作.ts', [
    ['import { ProductCommitCheckpoint } from "./产品保存检查点";', 'import { ProductCommitCheckpoint } from "./产品保存检查点";\nimport { planProductRecycle, planProductRestore, recycledProducts } from "./产品回收规则";\nimport { orderedProducts } from "./产品规则";'],
    ['const saves = new ProductSaveRegistry();', 'const saves = new ProductSaveRegistry();\nconst deletionGuards = new Map<string, () => boolean>();'],
    ['  persist: (snapshot: T) => Promise<void>,\n)', '  persist: (snapshot: T) => Promise<void>,\n  canDelete: () => boolean = () => true,\n)'],
    ['  const persistRef = useRef(persist);', '  const persistRef = useRef(persist);\n  const canDeleteRef = useRef(canDelete);'],
    ['    checkpoint.mount();', '    checkpoint.mount();\n    deletionGuards.set(projectId, () => canDeleteRef.current());'],
    ['      unregister();', '      unregister();\n      deletionGuards.delete(projectId);'],
    ['    persistRef.current = persist;', '    persistRef.current = persist;\n    canDeleteRef.current = canDelete;'],
    ['  return { activeId, busy, createProduct, selectProduct };', `  const recycleProduct = useCallback(
    (id: string) => operations.run(async () => {
      const ensureStopped = () => {
        if (deletionGuards.get(id)?.() === false)
          throw new Error("该产品有生成任务运行中，请等待任务结束后再删除。");
      };
      ensureStopped();
      await commitCurrent();
      if (id !== activeId && deletionGuards.has(id)) await saves.flush(id);
      ensureStopped();
      const before = useCanvasStore.getState();
      const planned = planProductRecycle(before, id, new Date().toISOString());
      if (planned !== before) useCanvasStore.setState(planned);
      // 失败不回滚/覆盖已确认代；完整快照仍在回收站及待确认队列，允许原UI显式重试。
      await flushSQLiteStorage();
      if (activeId === id) {
        const current = useCanvasStore.getState();
        const next = recycledProducts(current).find(entry => entry.id === id)?.nextProductId;
        const target = current.projects.find(item => item.id === next)?.id || orderedProducts(current.projects)[0]?.id;
        if (target) await enter(target);
        else {
          sqlitePreferences.removeItem(ACTIVE_PRODUCT_KEY);
          await flushSQLiteStorage();
          navigate("/", { replace: true });
        }
      }
    }),
    [activeId, commitCurrent, enter, navigate],
  );
  const restoreProduct = useCallback(
    (id: string) => operations.run(async () => {
      await commitCurrent();
      const before = useCanvasStore.getState(), planned = planProductRestore(before, id);
      if (planned !== before) useCanvasStore.setState(planned);
      await flushSQLiteStorage();
      await enter(id);
    }),
    [commitCurrent, enter],
  );
  return { activeId, busy, createProduct, selectProduct, recycleProduct, restoreProduct };`],
  ]);
  edit('web/src/guan/顶部产品胶囊.tsx', [
    ['import styles from "./产品胶囊.module.css";', 'import styles from "./产品胶囊.module.css";\nimport { ProductDeleteDialog, ProductTrashIcon } from "./产品回收面板";'],
    ['  const [error, setError] = useState("");', '  const [error, setError] = useState("");\n  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null);'],
    ['              </button>\n            </div>', `              </button>
              <button type="button" className="guan-product-delete"
                aria-label={\`删除\${label}及对应画布\`}
                title={product.status === "loading" ? "生成任务运行中，暂不能删除" : "删除产品及对应画布"}
                disabled={busy || product.status === "loading"}
                onClick={(event) => { event.stopPropagation(); setDeleting({ id: product.id, name: label }); }}>
                <ProductTrashIcon />
              </button>
            </div>`],
    ['      {error ? (', '      {deleting ? <ProductDeleteDialog id={deleting.id} name={deleting.name} onClose={() => setDeleting(null)} /> : null}\n      {error ? ('],
  ]);
  const cssPath = 'web/src/guan/产品胶囊.module.css', beforeCSS = read(cssPath);
  delta.set(cssPath, { 原文: beforeCSS, 产物: beforeCSS + localizedLegacyCSS(legacy.get('src/shared/data-contract/index.css'), join(integration.副本, 'web')) });
  edit('web/src/guan/旧版首页顶栏.tsx', [
    ['import { ProductCapsules } from "./顶部产品胶囊";', 'import { ProductCapsules } from "./顶部产品胶囊";\nimport { ProductTrashEntry } from "./产品回收面板";'],
    ['        <button type="button" disabled title={pending} aria-label="产品回收站"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6.5 7l.8 12h9.4l.8-12M9 7l1-3h4l1 3" /></svg></button>', '        <ProductTrashEntry />'],
  ]);
  edit('web/src/guan/画布入口.tsx', [
    ['import { Navigate } from "react-router-dom";', 'import { Navigate, useMatch } from "react-router-dom";'],
    ['  const projects = useCanvasStore(state => state.projects);', '  const projects = useCanvasStore(state => state.projects);\n  const routeId = useMatch("/canvas/:id")?.params.id;\n  const removedRouteProduct = useCanvasStore(state => Boolean(routeId && !state.projects.some(project => project.id === routeId) && state.deletedProjects.some(entry => entry.id === routeId && entry.project)));'],
    ['  if (id && !busy) return <Navigate', '  // 删除或后续导航保存未确认时，不由缺失路由的兜底入口抢先导航。\n  if (id && !busy && !removedRouteProduct) return <Navigate'],
  ]);
  edit('web/src/pages/canvas/project.tsx', [
    ['    const { createProduct } = useProductNavigation();', '    const { createProduct, recycleProduct } = useProductNavigation();'],
    ['    const deleteProjects = useCanvasStore((state) => state.deleteProjects);\n', ''],
    ['        deleteProjects([projectId]);\n        cleanupAssetImages();\n        navigate("/canvas");\n    }, [cleanupAssetImages, deleteProjects, navigate, projectId]);', '        void recycleProduct(projectId).catch(error => message.error(error instanceof Error ? error.message : String(error)));\n    }, [recycleProduct, message, projectId]);'],
    ['        });\n\n    useEffect(() => {\n        if (!dialogNodeId) setNodeImageSettingsOpen(false);', '        }, () => generationRequestsRef.current.size === 0 && runningNodeId === null);\n\n    useEffect(() => {\n        if (!dialogNodeId) setNodeImageSettingsOpen(false);'],
    ['metadata: { prompt: effectivePrompt, status: NODE_STATUS_LOADING, ...buildAudioGenerationMetadata(generationConfig) },', 'metadata: { prompt: effectivePrompt, status: NODE_STATUS_LOADING, ...buildAudioGenerationMetadata(generationConfig), generationStartedAt },'],
    ['                        textCount,\n                        texts: textIds.map', '                        textCount,\n                        generationStartedAt,\n                        texts: textIds.map'],
  ]);
  return { integration, delta, legacy };
}

export function 预审产品悬浮删除类型(preview) {
  const root = preview.integration.副本, web = join(root, 'web');
  const overrides = new Map([...preview.delta].filter(([path]) => /\.[jt]sx?$/.test(path)).map(([path, item]) => [resolve(root, path), item.产物]));
  const config = ts.readConfigFile(join(web, 'tsconfig.json'), ts.sys.readFile);
  if (config.error) throw Error('读取类型配置失败');
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, web), host = ts.createCompilerHost(parsed.options);
  const read = path => overrides.get(resolve(path)) ?? ts.sys.readFile(path);
  host.readFile = read;
  host.fileExists = path => overrides.has(resolve(path)) || ts.sys.fileExists(path);
  host.directoryExists = path => [...overrides.keys()].some(file => file.startsWith(resolve(path) + sep)) || ts.sys.directoryExists(path);
  host.getCurrentDirectory = () => web;
  host.getSourceFile = (path, version) => { const source = read(path); return source === undefined ? undefined : ts.createSourceFile(path, source, version); };
  const program = ts.createProgram([...new Set([...parsed.fileNames, ...overrides.keys()])], { ...parsed.options, noEmit: true, incremental: false }, host);
  const errors = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
  if (errors.length) throw Error(ts.formatDiagnosticsWithColorAndContext(errors, { getCurrentDirectory: () => web, getCanonicalFileName: path => path, getNewLine: () => '\n' }));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.length !== 3 || process.argv[2] !== '--生成十文件审查') throw Error('仅生成审查，不接入或启动');
  检查运行副本();
  const preview = 构建产品悬浮删除候选(); 预审产品悬浮删除类型(preview);
  const patch = 生成审查差异(preview.delta), report = {
    日期: '2026-10-18', 状态: '待具体差异批准，未接入或启动', 上游提交: 基线.提交,
    前置记录: 产品删除前置记录, 前置差异SHA256: preview.integration.差异SHA256,
    旧来源指纹: 产品旧来源指纹, 自有来源: Object.fromEntries(产品删除自有来源.map(path => [path, 哈希(readFileSync(join(根目录, path)))])),
    差异SHA256: 哈希(patch), 文件数: preview.delta.size,
    文件: [...preview.delta].map(([文件, item]) => ({ 文件, 原始SHA256: item.原文 === null ? null : 哈希(item.原文), 候选SHA256: 哈希(item.产物) })),
    完整虚拟候选类型检查通过: true, 已接入: false, 已重启3100: false, 真实浏览器验收: false,
    范围: ['旧版悬浮/键盘聚焦/触屏删除入口、确认文案与样式；运行任务禁止删除', '完整画布归档及删除结果同一SQLite根提交；保留媒体并启用最小恢复入口，无永久删除', '统一保存和产品操作锁、失败显式重试、右邻/左邻选择、空产品首页', '文本/音频生成结果补同次任务时间戳，保留旧版任务摘要'],
  };
  for (const [suffix, value] of [['patch', patch], ['json', JSON.stringify(report, null, 2) + '\n']])
    writeFileSync(join(根目录, '上游适配/待审查/产品悬浮删除十文件.' + suffix), value, { flag: 'wx' });
  console.log(JSON.stringify(report, null, 2));
}
