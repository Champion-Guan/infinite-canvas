import { existsSync, lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { 根目录, 基线 } from './公共.mjs';
import { 哈希, 检查运行副本 } from './检查运行副本.mjs';
import { 精确替换, 生成审查差异, ts } from './检查首批功能适配.mjs';
import { 创建类型依赖只读镜像 } from './类型依赖只读镜像.mjs';
import { 构建配置文件安全候选, 配置安全旧目录, 配置安全旧指纹, 配置安全来源, 配置安全前置 } from './预审配置文件安全.mjs';
import { 核验凭据网关任务完整包 } from './接入凭据网关任务隔离副本.mjs';

export const 安全批量旧指纹 = Object.freeze({
  'src/canvas/lib/recovery-read-gate.ts': 'dda24b04617e8849b714217d3aca2f2aa5941f60b9eadc59251233ab4167ac82',
  'src/canvas/lib/persistence-checkpoint.ts': '4ea8db7b50699adcf3b96450c2d9bfc7e82418979e94d129ecce67952b090edb',
  'src/canvas/lib/update-activity.ts': '1512cf30a4ee4ae369b80548b62d36b83576591de7a250d5d6bca95d5c4a5ffb',
  'src/canvas/lib/settle-activity-group.ts': 'cf6f772980dbd9f48d63c840c9dda750a0ae6c36262de87a7b30f6806c2ad327',
  'src/canvas/lib/canvas/prompt-generation-mode.ts': '2af4914578fcf360406e39e08d2c3ccaa1cd11882f078d589d886604fab3d3f5',
  'src/canvas/services/file-storage.ts': '332b7a04acce97dc7437028d7be1e5823b2abb402a5f4015ac6d5a3d4037d3d3',
  'src/canvas/services/image-storage.ts': '1c4fb9464264f33510f54284b21aa42eaa2da05a63a4c71d7fbdf032e7c298b7',
  'src/canvas/services/api/video.ts': '32126f385f83abf151021a8021d5d82cb8ba9ab342963ce0686b153b54fe789d',
  'src/canvas/stores/use-asset-store.ts': '1838a6ea55da2d0833f88020202940cab7fd8ef35cf9b922c824c2cddf86f62c',
  'src/canvas/pages/canvas/project.tsx': '1fa007d1bdac287c1bee26ac1e186d5a69e544d89b7c57907843bfc8678e0bfb',
  'src/canvas/components/canvas/canvas-toolbar.tsx': 'dadf9b13c4c91bb7e5066882accf3f794454cdf4d28d56572a8d841a83e7f45b',
  'src/canvas/types/canvas.ts': 'fb02101c01e2d028075270606ce809129b972a3ac3b7165b1c0f92a12c67cf95',
});
export function 读取普通来源(root, path) {
  const file = join(root, path), stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || realpathSync(file) !== resolve(file)) throw Error('迁入来源必须为独立普通文件');
  return readFileSync(file, 'utf8');
}
export function 唯一片段(source, start, end) {
  if (source.split(start).length !== 2 || source.split(end).length !== 2) throw Error('迁入片段边界不唯一：' + start);
  const a = source.indexOf(start), b = source.indexOf(end);
  if (b <= a) throw Error('迁入片段顺序错误');
  return source.slice(a, b);
}
export function 构建安全与批量候选() {
  const old = new Map(Object.entries(安全批量旧指纹).map(([path, hash]) => {
    const source = 读取普通来源(配置安全旧目录, path);
    if (哈希(source) !== hash) throw Error('旧来源变化，请重新审查：' + path);
    return [path.slice('src/canvas/'.length), source];
  }));
  const preview = 构建配置文件安全候选(), { integration, delta } = preview;
  function edit(path, adapt) {
    const original = 读取普通来源(integration.副本, path);
    if (delta.has(path)) throw Error('批次重复路径');
    delta.set(path, { 原文: original, 产物: adapt(original) });
  }
  for (const path of ['lib/recovery-read-gate.ts', 'lib/persistence-checkpoint.ts', 'lib/update-activity.ts', 'lib/settle-activity-group.ts', 'lib/canvas/prompt-generation-mode.ts']) {
    const name = path.split('/').at(-1), target = 'web/src/guan/recovery/' + name;
    const source = 读取普通来源(根目录, '扩展功能/安全与批量/' + name);
    if (source !== old.get(path) || existsSync(join(integration.副本, target))) throw Error('纯模块须逐字节继承且新增路径不存在');
    delta.set(target, { 原文: null, 产物: source });
  }
  edit('web/src/stores/use-asset-store.ts', original => {
    const callback = 唯一片段(old.get('stores/use-asset-store.ts'), '            onRehydrateStorage:', '        },\n    ),');
    return 精确替换(original, [
      ['import { create } from "zustand";', 'import { create } from "zustand";\nimport { createRecoveryReadGate } from "@/guan/recovery/recovery-read-gate";\nimport { createPersistenceCheckpoint } from "@/guan/recovery/persistence-checkpoint";\nimport { settleActivityGroup } from "@/guan/recovery/settle-activity-group";'],
      ['const assetStorage:', 'const assetReadGate = createRecoveryReadGate();\nconst assetCleanupCheckpoint = createPersistenceCheckpoint();\n\nconst assetStorage:'],
      ['getItem: async (name) => {', 'getItem: async (name) => assetReadGate.read(name, async () => {'],
      ['        return parsed;\n    },', '        return parsed;\n    }),'],
      ['    setItem: (name, value) => localForageStorage.setItem(name, JSON.stringify(value)),', '    setItem: (name, value) => { assetReadGate.assertWritable(name); return localForageStorage.setItem(name, JSON.stringify(value)); },'],
      ['    removeItem: (name) => localForageStorage.removeItem(name),', '    removeItem: (name) => { assetReadGate.assertWritable(name); return localForageStorage.removeItem(name); },'],
      ['                window.setTimeout(async () => {', '                window.setTimeout(() => {\n                    void assetCleanupCheckpoint.run("cleanup", async () => {'],
      ['                    await cleanupUnusedImages({ assets: get().assets, projects, extra });\n                    await cleanupUnusedMedia({ assets: get().assets, projects, extra });', '                    await settleActivityGroup([cleanupUnusedImages({ assets: get().assets, projects, extra }), cleanupUnusedMedia({ assets: get().assets, projects, extra })]);\n                    }).catch(() => undefined);'],
      [唯一片段(original, '            onRehydrateStorage:', '        },\n    ),'), callback],
    ]);
  });
  const oldFile = old.get('services/file-storage.ts');
  edit('web/src/services/file-storage.ts', original => 精确替换(original, [
    [唯一片段(original, 'export async function uploadMediaFile(', 'export async function resolveMediaUrl('),
      唯一片段(oldFile, 'async function uploadMediaFileImpl(', 'export async function resolveMediaUrl(').replace('async function uploadMediaFileImpl(input: string | Blob, prefix: string)', 'export async function uploadMediaFile(input: string | Blob, prefix = "file")')],
    [唯一片段(original, 'export async function cleanupUnusedMedia(', 'export function collectMediaStorageKeys('),
      唯一片段(oldFile, 'async function cleanupUnusedMediaImpl(', 'export function collectMediaStorageKeys(').replace('async function cleanupUnusedMediaImpl(', 'export async function cleanupUnusedMedia(')],
    [original.slice(original.indexOf('function readVideoMeta(')), oldFile.slice(oldFile.indexOf('function readVideoMeta('))],
  ]));
  edit('web/src/services/api/video.ts', original => 精确替换(original, [
    [唯一片段(original, 'export async function storeGeneratedVideo(', 'async function createOpenAIVideoTask('),
      唯一片段(old.get('services/api/video.ts'), 'export async function storeGeneratedVideo(', 'async function createOpenAIVideoTask(')],
  ]));
  const oldImage = old.get('services/image-storage.ts');
  edit('web/src/services/image-storage.ts', original => 精确替换(original, [
    ['import { nanoid } from "nanoid";', 'import { nanoid } from "nanoid";\nimport { createPersistenceCheckpoint } from "@/guan/recovery/persistence-checkpoint";\nimport { settleActivityGroup } from "@/guan/recovery/settle-activity-group";\nconst previewCheckpoint = createPersistenceCheckpoint();'],
    ['const IMAGE_PREVIEW_VERSION = 1;', 'const IMAGE_PREVIEW_VERSION = 2;'],
    [唯一片段(original, 'async function storeImage(', 'async function fetchImageBlob('), 唯一片段(oldImage, 'async function storeImage(', 'async function fetchImageBlob(')],
    [唯一片段(original, 'async function storeImagePreview(', 'function cacheImagePreview('), 唯一片段(oldImage, 'async function storeImagePreview(', 'function cacheImagePreview(')],
    [唯一片段(original, 'export async function cleanupUnusedImages(', 'export function collectImageStorageKeys('),
      唯一片段(oldImage, 'async function cleanupUnusedImagesImpl(', 'export function collectImageStorageKeys(').replace('async function cleanupUnusedImagesImpl(', 'export async function cleanupUnusedImages(')],
  ]));
  const oldProject = old.get('pages/canvas/project.tsx');
  edit('web/src/pages/canvas/project.tsx', original => {
    // Retain original callbacks and UI. Only the old task-scope boundary is
    // omitted: this candidate does not claim durable gateway task admission.
    let batch = 唯一片段(oldProject, '    const addGenerationConfigsForPromptNodes = useCallback(', '    const insertAssistantImage = useCallback(');
    batch = 精确替换(batch, [
      ['async (parentScope?: RootScope) => {\n        return runTaskActivity("canvas", async (scope) => {', 'async () => {'],
      ['node.metadata?.prompt || "", scope);', 'node.metadata?.prompt || "");'],
      ['    \n        }, parentScope);\n', ''],
      ['        return runTaskActivity("canvas", async (scope) => {\n', ''],
      ['await generateAllConfigNodes(scope);', 'await generateAllConfigNodes();'],
      ['    \n        });\n', ''],
      ['effectiveConfig.model, effectiveConfig.size, message]);', 'effectiveConfig.model, effectiveConfig.size, message, setNodes]);'],
    ]);
    return 精确替换(original, [
      ['// Register built-in nodes', 'import { promptGenerationMode } from "@/guan/recovery/prompt-generation-mode";\nimport { settleActivityGroup } from "@/guan/recovery/settle-activity-group";\n\n// Register built-in nodes'],
      ['registerBuiltinNodes();\n', 'registerBuiltinNodes();\n\n' + 唯一片段(oldProject, 'function promptGenerationPatch(', 'function imageDimensionsMatch(') + 唯一片段(oldProject, 'const INHERITED_GENERATION_SETTINGS', 'function applyGeneratedVideo(')],
      ['    const insertAssistantImage = useCallback(', batch + '    const insertAssistantImage = useCallback('],
      ['                    onAddGroup={() => createNode(CanvasNodeType.Group)}', '                    onAddGenerationConfigs={addGenerationConfigsForPromptNodes}\n                    onGenerateAllConfigs={() => void generateAllConfigNodes()}\n                    onCompleteAndGenerateAll={() => void completeAndGenerateAll()}\n                    onAddGroup={() => createNode(CanvasNodeType.Group)}'],
      // Existing config cards remain settings snapshots; non-config generation
      // can inherit connected settings just as in the source implementation.
      ['buildGenerationConfig(effectiveConfig, sourceNode, mode)', 'buildGenerationConfig(effectiveConfig, generationNodeForExecution(sourceNode, nodeId, nodesRef.current, connectionsRef.current), mode)'],
    ]);
  });
  const oldToolbar = old.get('components/canvas/canvas-toolbar.tsx');
  edit('web/src/components/canvas/canvas-toolbar.tsx', original => {
    const dropdown = 唯一片段(oldToolbar, '                <Dropdown\n', '                <ToolbarButton id="tool-group"');
    const returnAnchor = '    return (\n        <div ref={rootRef}';
    const effect = 唯一片段(oldToolbar, '    // Capture pointerdown', returnAnchor);
    return 精确替换(original, [
      ['{ Button, Segmented, Switch }', '{ Button, Dropdown, Segmented, Switch }'],
      ['Info, LocateFixed', 'Info, Link2, LocateFixed'], ['Palette, Puzzle', 'Palette, Play, Puzzle'],
      ['    onAddGroup,\n', '    onAddGroup,\n    onAddGenerationConfigs,\n    onGenerateAllConfigs,\n    onCompleteAndGenerateAll,\n'],
      ['    onAddGroup: () => void;\n', '    onAddGroup: () => void;\n    onAddGenerationConfigs: () => void;\n    onGenerateAllConfigs: () => void;\n    onCompleteAndGenerateAll: () => void;\n'],
      ['    // Keep extension plugin nodes', '    const [batchOpen, setBatchOpen] = useState(false);\n    const batchMenuRef = useRef<HTMLDivElement>(null);\n    // Keep extension plugin nodes'],
      [唯一片段(original, '    // Close extension-node', returnAnchor), effect],
      ['                <ToolbarButton id="tool-group"', dropdown + '                <ToolbarButton id="tool-group"'],
      ['    if (id === "tool-group")', '    if (id === "tool-batch-actions") return "批量操作";\n    if (id === "tool-group")'],
    ]);
  });
  edit('web/src/types/canvas.ts', original => 精确替换(original, [
    ['    generationStartedAt?: number;', '    generationStartedAt?: number;\n' + 唯一片段(old.get('types/canvas.ts'), '    // Parameters parsed from an image prompt', '    channel?: string;')],
    ['    quality?: string;', '    quality?: string;\n    moderation?: string;'],
  ]));
  return preview;
}

export function 预审安全与批量迁移(generate = false) {
  检查运行副本();
  const preview = 构建安全与批量候选();
  const root = preview.integration.副本, web = join(root, 'web');
  const dependencies = 创建类型依赖只读镜像(ts.sys.readFile, join(realpathSync(join(web, 'node_modules')), '.pnpm/lock.yaml'));
  const overrides = new Map([...preview.delta].map(([path, item]) => [resolve(root, path), item.产物]));
  const read = path => overrides.get(resolve(path)) ?? dependencies.read(path);
  const config = ts.readConfigFile(join(web, 'tsconfig.json'), read);
  if (config.error) throw Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, web);
  const host = ts.createCompilerHost(parsed.options);
  host.readFile = read;
  host.fileExists = path => overrides.has(resolve(path)) || ts.sys.fileExists(path);
  host.directoryExists = path => [...overrides.keys()].some(file => file.startsWith(resolve(path) + sep)) || ts.sys.directoryExists(path);
  host.getCurrentDirectory = () => web;
  host.getSourceFile = (path, version) => {
    const content = read(path);
    return content === undefined ? undefined : ts.createSourceFile(path, content, version);
  };
  const program = ts.createProgram([...new Set([...parsed.fileNames, ...overrides.keys()].map(path => resolve(path)))], { ...parsed.options, incremental: false, noEmit: true }, host);
  const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
  if (diagnostics.length) throw Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCurrentDirectory: () => web, getCanonicalFileName: path => path, getNewLine: () => '\n' }));
  const patch = 生成审查差异(preview.delta);
  const own = [配置安全来源, ...['recovery-read-gate.ts', 'persistence-checkpoint.ts', 'update-activity.ts', 'settle-activity-group.ts', 'prompt-generation-mode.ts'].map(x => '扩展功能/安全与批量/' + x)];
  const toolPaths = ['开发工具/预审安全与批量迁移.mjs', '开发工具/类型依赖只读镜像.mjs', '开发工具/安全与批量迁移.test.mjs', '开发工具/检查安全与批量迁移代码.mjs', '开发工具/预审配置文件安全.mjs', '开发工具/配置文件安全.test.mjs', '开发工具/检查配置文件安全代码.mjs'];
  const manifest = {
    日期: '2026-10-20', 状态: '扩大批次候选，待具体差异批准；未隔离接入或切换3100', 上游提交: 基线.提交,
    前置记录: 配置安全前置, 前置差异SHA256: preview.integration.差异SHA256,
    文件数: preview.delta.size, 差异SHA256: 哈希(patch), 完整虚拟类型检查通过: true,
    类型检查依赖: dependencies.report(),
    旧来源目录: 配置安全旧目录, 旧来源指纹: { ...配置安全旧指纹, ...安全批量旧指纹 },
    自有来源: own.map(文件 => ({ 文件, SHA256: 哈希(读取普通来源(根目录, 文件)) })),
    工具来源: toolPaths.map(文件 => ({ 文件, SHA256: 哈希(读取普通来源(根目录, 文件)) })),
    文件: [...preview.delta].map(([文件, item]) => ({ 文件, 原始SHA256: item.原文 === null ? null : 哈希(item.原文), 候选SHA256: 哈希(item.产物) })),
    覆盖: ['GAP-01 配置脱敏及安全导入', 'GAP-06 素材恢复读失败写入保护', 'GAP-07 不完整引用清单下自动保留媒体', 'GAP-13 批量补齐配置', 'GAP-14 最多3并发批量生成', 'GAP-15 一键补齐并生成及旧菜单', 'GAP-33 媒体缓存失败传播', 'GAP-34 有限解码等待、原图先交付、缩略图失败可重试'],
    部分覆盖: ['GAP-16 批量补齐时识别模式、像素和比例并快照；单条及拖连识别未迁'],
    边界: ['覆盖表示候选代码，未做真实React界面、磁盘隔离包构建或日常接入验收', '未接普通画布到受限凭据网关/持久任务账本，未迁视频未知远端任务保护GAP-04', '未迁节点回收站GAP-35、代理/Fallback及其他生成历史/交付增强', '读门禁保护磁盘原素材；失败action可能先改变页内状态，需重试恢复', '活动计数和checkpoint只记录本批局部证据，不是应用全域维护或停机门禁', '配置仍沿用兼容页内凭据及加密SQLite；两个store不是断电原子事务；不处理任意正文中的秘密', '媒体自动扫描只报告候选；显式删除保留，尚未建立可自动删除的完整引用清单', '媒体元数据超时采用旧尺寸兜底，不冒充真实探测尺寸', '批量沿用旧筛选：任意已有出线即跳过；调用沿用现有生成入口与现有错误语义'],
    已改作者仓库或历史批准: false, 已访问正式数据或真实凭据: false, 已切换3100: false,
  };
  核验凭据网关任务完整包(preview.integration.组合包, true);
  检查运行副本();
  if (generate) {
    const targets = [['patch', patch], ['json', JSON.stringify(manifest, null, 2) + '\n']].map(([suffix, data]) => [join(根目录, '上游适配/待审查/安全与批量迁移.' + suffix), data]);
    if (targets.some(([path]) => existsSync(path))) throw Error('拒绝覆盖审查原件，请新增后继批次');
    for (const [path, data] of targets) writeFileSync(path, data, { flag: 'wx', mode: 0o600 });
  }
  return manifest;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.slice(2).some(arg => arg !== '--生成审查差异')) throw Error('仅支持内存预审和冻结差异，不支持接入或服务操作');
  console.log(JSON.stringify(预审安全与批量迁移(process.argv.includes('--生成审查差异')), null, 2));
}
