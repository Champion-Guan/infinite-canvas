import { existsSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { 根目录, 基线 } from './公共.mjs';
import { 检查运行副本, 哈希 } from './检查运行副本.mjs';
import { 精确替换, 生成审查差异 } from './检查首批功能适配.mjs';
import { 卡片布局旧目录, 卡片布局来源指纹, 预审卡片布局类型 } from './预审卡片自动避让.mjs';
import { 读取视区跟随隔离记录, 核验视区跟随完整包 } from './接入新建卡片视区跟随隔离副本.mjs';

export const 产品前置记录 = join(根目录, '.运行/新建卡片视区跟随-nQKQLs/视区跟随接入记录.json');
export const 产品旧来源指纹 = Object.freeze({
  'src/shared/data-contract/index.js': '1b14b228241b07fa1a4f6fea8956c7f60112ef61bbfc8c33ec151bce5de7bb22',
  'src/shared/data-contract/index.css': '169d3c6de95793d5648e1f673e92307d804a9599010522941e932378d1baccff',
  'src/shared/data-contract/workbook-canvas-products.js': '8bb43e6bf44f74e3c6c18bacc46e2d9135a6170bc05eaead8922f79dccfb61bb',
  'src/canvas/services/product-recycle-bridge.ts': 'f774657e2d22c7863ac025c3c0b8383d75706827e09642928abfdda4aaf5e66a',
  'src/canvas/lib/canvas/task-summary.js': 'd7b665601ae5ebffd3d259092a6abd1bc906b5733f05b84ffc9aad09b6b74f6a',
  'src/canvas/lib/render-commit-checkpoint.ts': '5554e368fc3c95828fdf4effa2b9481f02246f3cbbffdaa4863de1ca8b1580fc',
  'public/assets/local-canvas/canvas.js': 'b0c9863c11a7dc51b7a86b94426ca8b515cfd54afb526d9b8da0b312aa3e757f',
  'src/canvas/services/canvas-visibility.ts': '9648251ff389731853f20216eb59d5e392e2a432ad6bc7d20b707590b33e38fa',
  'src/canvas/stores/canvas/use-canvas-store.ts': '7c842cb39e73702686378c99d94abb5cc186d57e437c4083ccc0ab207ffcd9e4',
  'src/canvas/pages/canvas/project.tsx': 卡片布局来源指纹['src/canvas/pages/canvas/project.tsx'],
});
export const 产品自有文件 = Object.freeze([
  '产品规则.ts', '产品保存检查点.ts', '产品操作.ts', '产品界面边界.tsx',
  '产品工作区.tsx', '顶部产品胶囊.tsx', '产品胶囊.module.css',
]);
export const 产品Portal文件 = Object.freeze([
  'canvas-audio-settings-popover.tsx', 'canvas-image-settings-popover.tsx',
  'canvas-text-settings-popover.tsx', 'canvas-video-settings-popover.tsx',
  'canvas-node-mask-edit-dialog.tsx', 'canvas-prompt-chip-input.tsx', 'canvas-resource-mention-textarea.tsx',
]);

export function 取唯一片段(source, start, end) {
  if (source.split(start).length !== 2) throw Error('产品迁入起点缺失或不唯一');
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  if (b <= a) throw Error('产品迁入结束边界缺失');
  return source.slice(a, b);
}
export function 读取产品旧来源() {
  const sources = new Map();
  for (const [relative, hash] of Object.entries(产品旧来源指纹)) {
    const path = join(卡片布局旧目录, relative), stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw Error('产品旧来源不是独立普通文件');
    const source = readFileSync(path, 'utf8');
    if (哈希(source) !== hash) throw Error('产品旧来源指纹改变：' + relative);
    sources.set(relative, source);
  }
  return sources;
}

// 全部候选只在内存Map中装配；没有写运行副本、启动、接管或数据访问入口。
export function 构建产品核心候选() {
  const integration = 读取视区跟随隔离记录(产品前置记录);
  const legacy = 读取产品旧来源();
  const delta = new Map();
  const source = path => readFileSync(join(integration.副本, path), 'utf8');
  const edit = (path, replacements) => delta.set(path, { 原文: source(path), 产物: 精确替换(source(path), replacements) });
  const add = (path, content) => {
    if (existsSync(join(integration.副本, path))) throw Error('产品新增路径已存在：' + path);
    delta.set(path, { 原文: null, 产物: content });
  };
  for (const file of 产品自有文件) add('web/src/guan/' + file, readFileSync(join(根目录, '扩展功能/产品', file), 'utf8'));
  const displayName = 取唯一片段(legacy.get('src/shared/data-contract/index.js'), 'function productDisplayName(', '\nfunction canvasDisplayName(');
  add('web/src/guan/旧版产品显示名.js', 'export ' + displayName.trimEnd() + '\n');
  const capsuleStatus = 取唯一片段(legacy.get('src/shared/data-contract/index.js'), 'function readCanvasCapsuleStatus(', '\nfunction renderHeaderControls(');
  add('web/src/guan/旧版产品胶囊状态.js', 'export ' + capsuleStatus.trimEnd() + '\n');
  add('web/src/guan/产品任务摘要.js', legacy.get('src/canvas/lib/canvas/task-summary.js'));

  edit('web/src/router.tsx', [
    ['import { CanvasEntry } from "@/guan/画布入口";', 'import { ProductWorkspace } from "@/guan/产品工作区";'],
    ['import CanvasProjectPage from "@/pages/canvas/project";\nimport NotFound from "@/pages/not-found";\n', ''],
    ['            { path: "/", element: <CanvasEntry /> },\n', ''],
    ['            { path: "/canvas/:id", element: <CanvasProjectPage /> },', '            { path: "*", element: <ProductWorkspace /> },'],
    ['    { path: "*", element: <UserLayout><NotFound /></UserLayout> },\n', ''],
  ]);
  edit('web/src/guan/旧版首页顶栏.tsx', [
    ['import { useNavigate } from "react-router-dom";\nimport { useTranslation } from "react-i18next";', 'import { App } from "antd";\nimport { ProductCapsules } from "./顶部产品胶囊";\nimport { useProductNavigation } from "./产品操作";'],
    ['import { useCanvasStore } from "@/stores/canvas/use-canvas-store";\n', ''],
    ['  const { t } = useTranslation();\n  const navigate = useNavigate();', '  const { message } = App.useApp();\n  const { createProduct, busy } = useProductNavigation();'],
    ['  const create = useCanvasStore((s) => s.createProject);\n', ''],
    ['      <div className={styles.productNav} />', '      <ProductCapsules />'],
    ['title="新建产品" onClick={() => navigate(`/canvas/${encodeURIComponent(create(t("canvas.defaultTitle", { count: 1 })))}`, { replace: true })}', 'title="新建产品" disabled={busy} onClick={() => { void createProduct().catch(error => message.error(error instanceof Error ? error.message : String(error))); }}'],
  ]);
  const entry = `import { Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { App } from "antd";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { sqlitePreferences } from "./上游浏览器存储桥";
import { ACTIVE_PRODUCT_KEY, useProductNavigation } from "./产品操作";
import { selectEntryProduct } from "./产品规则";
import { WorkbenchHome } from "./工作台首页";

export function CanvasEntry() {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const { createProduct } = useProductNavigation();
  const hydrated = useCanvasStore(state => state.hydrated);
  const projects = useCanvasStore(state => state.projects);
  const theme = useThemeStore(state => state.theme);
  const id = selectEntryProduct(projects, sqlitePreferences.getItem(ACTIVE_PRODUCT_KEY));
  if (!hydrated) return <main className="grid h-full place-items-center bg-background text-foreground" role="status">{t("canvas.opening")}</main>;
  if (id) return <Navigate to={"/canvas/" + encodeURIComponent(id)} replace />;
  return <WorkbenchHome theme={theme} onCreate={() => { void createProduct().catch(error => message.error(error instanceof Error ? error.message : String(error))); }} />;
}
`;
  delta.set('web/src/guan/画布入口.tsx', { 原文: source('web/src/guan/画布入口.tsx'), 产物: entry });
  const oldStore = legacy.get('src/canvas/stores/canvas/use-canvas-store.ts');
  const updateProject = 取唯一片段(oldStore, '            updateProject: (id, patch) =>', '\n        }),');
  edit('web/src/stores/canvas/use-canvas-store.ts', [
    ['import { nanoid } from "nanoid";', 'import { nanoid } from "nanoid";\nimport { nextProductTitle } from "@/guan/产品规则";'],
    ['createProject: (title = i18n.t("canvas.project.untitled")) => {', 'createProject: (title = nextProductTitle(get().projects)) => {'],
    [取唯一片段(source('web/src/stores/canvas/use-canvas-store.ts'), '            updateProject: (id, patch) =>', '\n        }),'), updateProject],
  ]);

  const projectPath = 'web/src/pages/canvas/project.tsx', project = source(projectPath);
  const oldProject = legacy.get('src/canvas/pages/canvas/project.tsx');
  const saveEffect = 取唯一片段(oldProject, '    useEffect(() => {\n        if (!projectLoaded || historyPausedRef.current || isNodeDragging', '\n    const updateFlushSnapshot');
  let checkpoint = 取唯一片段(oldProject, '    const updateFlushSnapshot = useMemo', '\n    useEffect(() => {\n        const flushForRecycle');
  checkpoint = 精确替换(checkpoint, [
    ['useCanvasUpdateFlush(updateFlushSnapshot,', 'useProductCanvasSave(projectId, updateFlushSnapshot,'],
    ['await flushCanvasPersistence();', 'await flushSQLiteStorage();'],
    ['                viewportSaveReleaseRef.current?.();\n                viewportSaveReleaseRef.current = null;\n', ''],
  ]);
  const oldSave = 取唯一片段(project, '    useEffect(() => {\n        if (!projectLoaded || historyPausedRef.current) return;', '\n    useEffect(() => {\n        if (!dialogNodeId)');
  const replacements = [
    ['import { isGenerationModeEnabled }', 'import { useProductActive } from "@/guan/产品界面边界";\nimport { useProductCanvasSave, useProductNavigation } from "@/guan/产品操作";\nimport { flushSQLiteStorage } from "@/guan/上游浏览器存储桥";\nimport { isGenerationModeEnabled }'],
    ['    const toolbarRect = document.querySelector<HTMLElement>', '    const toolbarRect = container.closest("[data-product-id]")?.querySelector<HTMLElement>'],
    ['    const dockRect = document.querySelector<HTMLElement>', '    const dockRect = container.closest("[data-product-id]")?.querySelector<HTMLElement>'],
    ['function InfiniteCanvasPage() {\n', 'function InfiniteCanvasPage() {\n    const productActive = useProductActive();\n    const { createProduct } = useProductNavigation();\n    const restoredProjectIdRef = useRef<string | null>(null);\n'],
    ['    const createProject = useCanvasStore((state) => state.createProject);\n', ''],
    ['        if (!hydrated) return;\n        setProjectLoaded(false);\n', '        if (!hydrated || restoredProjectIdRef.current === projectId) return;\n        let cancelled = false;\n        setProjectLoaded(false);\n        restoredProjectIdRef.current = null;\n'],
    ['            const restoredSessions = await hydrateAssistantImages(project.chatSessions || []);\n', '            const restoredSessions = await hydrateAssistantImages(project.chatSessions || []);\n            if (cancelled) return;\n'],
    ['            setProjectLoaded(true);\n', '            restoredProjectIdRef.current = projectId;\n            setProjectLoaded(true);\n'],
    ['        void restore();\n', '        void restore();\n        return () => { cancelled = true; };\n'],
    [oldSave, saveEffect + '\n' + checkpoint],
    ['        if (!referencePickerNodeId) return;\n        const exit = ', '        if (!productActive || !referencePickerNodeId) return;\n        const exit = '],
    ['    }, [exitNodeReferenceSelection, referencePickerNodeId]);', '    }, [productActive, exitNodeReferenceSelection, referencePickerNodeId]);'],
    ['    const createAndOpenProject = useCallback(() => {\n        const id = createProject(t("canvas.defaultTitle", { count: useCanvasStore.getState().projects.length + 1 }));\n        navigate(`/canvas/${id}`);\n    }, [createProject, navigate, t]);', '    const createAndOpenProject = useCallback(() => {\n        void createProduct().catch(error => message.error(error instanceof Error ? error.message : String(error)));\n    }, [createProduct, message]);'],
    ['    useEffect(() => {\n        const handlePointerUp = (event: PointerEvent)', '    useEffect(() => {\n        if (!productActive) return;\n        const handlePointerUp = (event: PointerEvent)'],
    ['    }, [finishNodeDrag, handleGlobalMouseMove, handleGlobalMouseUp, handleGlobalPointerMove]);', '    }, [productActive, finishNodeDrag, handleGlobalMouseMove, handleGlobalMouseUp, handleGlobalPointerMove]);'],
    ['    useEffect(() => {\n        const handleKeyDown = (event: KeyboardEvent)', '    useEffect(() => {\n        if (!productActive) return;\n        const handleKeyDown = (event: KeyboardEvent)'],
    ['    }, [copySelectedNodes, deleteConnection', '    }, [productActive, copySelectedNodes, deleteConnection'],
    ['    const confirmStopGeneration = useCallback(', '    const stopConfirmationRef = useRef<ReturnType<typeof modal.confirm> | null>(null);\n    useEffect(() => {\n        if (!productActive) stopConfirmationRef.current?.destroy();\n        return () => { stopConfirmationRef.current?.destroy(); };\n    }, [productActive]);\n\n    const confirmStopGeneration = useCallback('],
    ['            modal.confirm({', '            stopConfirmationRef.current = modal.confirm({'],
  ];
  for (const expression of ['Boolean(infoNode)', 'pluginManagerOpen', 'Boolean(cropNode)', 'Boolean(maskEditNode)', 'Boolean(splitNode)', 'Boolean(upscaleNode)', 'Boolean(angleNode)', 'Boolean(previewContent)', 'clearConfirmOpen', 'assetPickerOpen'])
    replacements.push([`open={${expression}}`, `open={productActive && ${expression}}`]);
  edit(projectPath, replacements);

  const canvasPath = 'web/src/components/canvas/infinite-canvas.tsx';
  edit(canvasPath, [
    ['import React, ', 'import { useProductActive } from "@/guan/产品界面边界";\nimport React, '],
    ['    const panState = useRef({', '    const productActive = useProductActive();\n    const panState = useRef({'],
    ['    useEffect(() => {\n        const handleKeyDown = ', '    useEffect(() => {\n        if (!productActive) return;\n        const handleKeyDown = '],
    ['            window.removeEventListener("blur", handleBlur);\n        };\n    }, []);', '            window.removeEventListener("blur", handleBlur);\n            handleBlur();\n        };\n    }, [productActive]);'],
    ['    useEffect(() => {\n        const handlePointerMove = ', '    useEffect(() => {\n        if (!productActive) return;\n        const handlePointerMove = '],
    ['            document.body.style.cursor = "";\n        };\n    }, [onCanvasDeselect, onViewportChange]);', '            if (frameRef.current) cancelAnimationFrame(frameRef.current);\n            frameRef.current = null;\n            nextViewportRef.current = null;\n            panState.current.isPanning = false;\n            document.body.style.cursor = "";\n        };\n    }, [productActive, onCanvasDeselect, onViewportChange]);'],
  ]);
  for (const file of 产品Portal文件) {
    const path = 'web/src/components/canvas/' + file;
    edit(path, [
      ['import { createPortal } from "react-dom";', 'import { createProductPortal } from "@/guan/产品界面边界";'],
      ['createPortal(', 'createProductPortal('],
    ]);
  }
  // Portal容器隔离之外，主动关闭隐藏产品的模态open，避免其滚动锁/键盘监听残留。
  const modalChanges = [
    ['canvas-config-composer.tsx', '    const [imagePreview, setImagePreview]', ['visible: true, src: imagePreview', 'visible: productActive, src: imagePreview']],
    ['canvas-prompt-chip-input.tsx', '    const [imagePreview, setImagePreview]', ['visible: true, src: imagePreview', 'visible: productActive, src: imagePreview']],
    ['canvas-side-panel.tsx', '    const [detail, setDetail]', ['<PromptDetailDialog prompt={detail}', '<PromptDetailDialog prompt={productActive ? detail : null}']],
    ['canvas-node-prompt-panel.tsx', '    const [expanded, setExpanded]', ['open={expanded}', 'open={productActive && expanded}']],
    ['canvas-zoom-controls.tsx', '    const [shortcutsOpen, setShortcutsOpen]', ['open={shortcutsOpen}', 'open={productActive && shortcutsOpen}']],
    ['canvas-top-bar.tsx', '    const [shortcutsOpen, setShortcutsOpen]', ['open={shortcutsOpen}', 'open={productActive && shortcutsOpen}']],
    ['canvas-prompt-library.tsx', '    const [open, setOpen]', ['<PromptSelectDialog open={open}', '<PromptSelectDialog open={productActive && open}']],
  ];
  for (const [file, anchor, change] of modalChanges) {
    const path = 'web/src/components/canvas/' + file;
    const before = source(path), current = delta.get(path)?.产物 || before;
    delta.set(path, { 原文: before, 产物: 'import { useProductActive } from "@/guan/产品界面边界";\n' + 精确替换(current, [
      [anchor, '    const productActive = useProductActive();\n' + anchor], change,
    ]) });
  }
  edit('web/src/components/canvas/canvas-node-hover-toolbar.tsx', [
    ['import { sqlitePreferences }', 'import { useProductActive } from "@/guan/产品界面边界";\nimport { sqlitePreferences }'],
    ['    const [imageToolSettingsOpen, setImageToolSettingsOpen] = useState(false);', '    const [imageToolSettingsOpen, setImageToolSettingsOpen] = useState(false);\n    const productActive = useProductActive();'],
    ['open={imageToolSettingsOpen}', 'open={productActive && imageToolSettingsOpen}'],
  ]);
  核验视区跟随完整包(integration.组合包, true);
  return { integration, legacy, delta, snippets: { displayName, capsuleStatus, updateProject, saveEffect, checkpoint } };
}

function 保存新审查(path, content) {
  if (existsSync(path) && readFileSync(path, 'utf8') !== content) throw Error('拒绝覆盖既有产品审查产物，请新建修订批次');
  if (!existsSync(path)) writeFileSync(path, content, { flag: 'wx', mode: 0o600 });
}
export function 预审产品核心(generate = false) {
  检查运行副本();
  const preview = 构建产品核心候选();
  预审卡片布局类型({ ...preview, delta: new Map([...preview.delta].filter(([path]) => /\.[cm]?[jt]sx?$/.test(path))) });
  const patch = 生成审查差异(preview.delta);
  const manifest = {
    日期: '2026-10-18', 状态: '待具体差异单独批准；未接入隔离副本或3100',
    上游提交: 基线.提交, 前置记录: 产品前置记录, 前置差异SHA256: preview.integration.差异SHA256,
    旧来源目录: 卡片布局旧目录, 旧来源SHA256: 产品旧来源指纹,
    片段SHA256: Object.fromEntries(Object.entries(preview.snippets).map(([key, value]) => [key, 哈希(value)])),
    自有来源: 产品自有文件.map(文件 => ({ 文件: '扩展功能/产品/' + 文件, SHA256: 哈希(readFileSync(join(根目录, '扩展功能/产品', 文件))) })),
    差异SHA256: 哈希(patch), 完整候选类型检查通过: true, 真实浏览器验收: false,
    已修改作者仓库: false, 已接管或重启3100: false, 已读取旧用户数据或Keychain: false,
    文件: [...preview.delta].map(([文件, item]) => ({ 文件, 原始SHA256: item.原文 === null ? null : 哈希(item.原文), 候选SHA256: 哈希(item.产物) })),
    范围: [
      '旧未命名产品N、显示名、胶囊SVG/尺寸/颜色及任务状态；入口统一命名，按创建顺序排列',
      '保留访问过的产品实例、视区、选择、撤销历史及后台任务；不迁旧iframe或浏览器数据',
      '复用现有唯一Zustand/SQLite分片保存，切换前真实React提交/SQLite确认，失败留当前产品',
      '隐藏产品不接收全局键鼠事件，Portal及弹窗按产品收容，不做DOM/CSS猴子补丁',
      'Excel、导入、回收站、旧数据迁移、桌面入口、更新/发布不在本批',
      '批准后另建完整后继保护器和事务隔离包；真实浏览器/视觉验收及3100切换尚未完成',
    ],
  };
  if (generate) {
    保存新审查(join(根目录, '上游适配/待审查/产品核心迁入.patch'), patch);
    保存新审查(join(根目录, '上游适配/待审查/产品核心迁入.json'), JSON.stringify(manifest, null, 2) + '\n');
  }
  核验视区跟随完整包(preview.integration.组合包, true);
  检查运行副本();
  return manifest;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.slice(2).some(arg => arg !== '--生成审查差异')) throw Error('仅支持内存预审与生成审查差异');
  console.log(JSON.stringify(预审产品核心(process.argv.includes('--生成审查差异')), null, 2));
}
