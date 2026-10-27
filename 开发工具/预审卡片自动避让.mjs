import { existsSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { 根目录, 基线 } from './公共.mjs';
import { 哈希, 检查运行副本 } from './检查运行副本.mjs';
import { 精确替换, 生成审查差异, ts } from './检查首批功能适配.mjs';
import { 读取日常启动复验记录, 核验日常启动完整源码 } from './接入SQLite日常启动隔离副本.mjs';

export const 卡片布局前置记录 = join(根目录, '.运行/SQLite日常启动-GStYZu/日常启动接入记录.json');
export const 卡片布局旧目录 = '/Users/guanchengbin/CodexProjects/guan-ai-workbench-projects/guan-ai-workbench';
export const 卡片布局自有来源 = '扩展功能/画布布局/卡片自动避让.ts';
export const 卡片布局来源指纹 = Object.freeze({
  'src/canvas/lib/canvas/canvas-node-placement.ts': '9e95193590ca10d83866d36e645c9d1324785fe27fce9286dcb39dc3b8779889',
  'src/canvas/pages/canvas/project.tsx': '1fa007d1bdac287c1bee26ac1e186d5a69e544d89b7c57907843bfc8678e0bfb',
  'src/canvas/components/canvas/canvas-top-bar.tsx': '386a1abf27e66e47f662470725b81f02affc46292b05ab32ad7b871caa5bf442',
  'src/canvas/types/canvas.ts': 'fb02101c01e2d028075270606ce809129b972a3ac3b7165b1c0f92a12c67cf95',
  'tests/canvas-node-placement.test.mjs': '8405c48078a4878874cfb8b912b50d6d8f893656194e492d5306fedeba8fceec',
});
function 读取锁定来源() {
  const sources = new Map();
  for (const [path, hash] of Object.entries(卡片布局来源指纹)) {
    const file = join(卡片布局旧目录, path), stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw Error('旧布局来源不是独立普通文件');
    const source = readFileSync(file, 'utf8');
    if (哈希(source) !== hash) throw Error('旧布局来源指纹改变，停止；不可擅自更新锁定值');
    sources.set(path, source);
  }
  const copied = readFileSync(join(根目录, 卡片布局自有来源), 'utf8');
  if (copied !== sources.get('src/canvas/lib/canvas/canvas-node-placement.ts')) throw Error('自有几何模块必须与旧版逐字节一致');
  return sources;
}
function 唯一片段(source, start, end) {
  if (source.split(start).length !== 2 || source.split(end).length !== 2) throw Error('旧片段边界不唯一');
  const a = source.indexOf(start), b = source.indexOf(end);
  if (b <= a) throw Error('旧片段边界顺序错误');
  return source.slice(a, b);
}
function 唯一行(source, marker) {
  const lines = source.split('\n').filter(line => line.includes(marker));
  if (lines.length !== 1) throw Error('旧迁入行不唯一');
  return lines[0];
}

// 只在内存派生四文件，未提供接入、运行或重启选项。
export function 构建卡片自动避让候选() {
  const sources = 读取锁定来源();
  const integration = 读取日常启动复验记录(卡片布局前置记录);
  const oldProject = sources.get('src/canvas/pages/canvas/project.tsx');
  const oldMenu = sources.get('src/canvas/components/canvas/canvas-top-bar.tsx');
  const delta = new Map();
  const stateBridge = 唯一片段(oldProject, '    const [nodes, setNodeState]', '    const [connections, setConnections]');
  const organizer = 唯一片段(oldProject, '    const organizeOverlappingNodes = useCallback(', '    const createAndOpenProject = useCallback(');
  const resultIndex = 唯一片段(oldProject, '                    const resultIndex = connectionsRef.current.filter(', '                    const rootId = reuseImageNode');
  const resultPosition = 唯一片段(oldProject, '                        position: reuseImageNode ? parentPosition : nextGenerationResultPosition(', '                        width: reuseImageNode');
  const retryLine = 唯一行(oldProject, 'generationStartedAt: Date.now(), status: NODE_STATUS_LOADING');
  const menuLine = 唯一行(oldMenu, '{ key: "organize"');
  const path = 'web/src/pages/canvas/project.tsx', original = readFileSync(join(integration.副本, path), 'utf8');
  let candidate = 精确替换(original, [
    ['import { fitNodeSize, nodeSizeFromRatio } from "@/lib/canvas/canvas-node-size";',
      'import { fitNodeSize, nodeSizeFromRatio } from "@/lib/canvas/canvas-node-size";\nimport { arrangeOverlappingCanvasNodes, nextGenerationResultPosition, placeCanvasNode, placeNewCanvasNodes } from "@/guan/卡片自动避让";'],
    ['normalizeConnection, snapNodesIntoGroup', 'normalizeConnection, nodeBounds, snapNodesIntoGroup'],
    ['    const nodesRef = useRef(nodes);\n', ''],
    ['    const [nodes, setNodes] = useState<CanvasNodeData[]>([]);\n', stateBridge],
    ['            setNodes(restoredNodes);', '            setRawNodes(restoredNodes);'],
    ['    }, [hydrated, navigate, openProject, projectId]);', '    }, [hydrated, navigate, openProject, projectId, setRawNodes]);'],
    ['        nodesRef.current = nodes;\n        connectionsRef.current', '        if (nodes === nodeTransactionRef.current) nodesRef.current = nodes;\n        connectionsRef.current'],
    ['            const newNode = createCanvasNode(type, targetPosition, configMetadata);', [
      '            const currentViewport = viewportRef.current;',
      '            const newNode = placeCanvasNode(createCanvasNode(type, targetPosition, configMetadata), nodesRef.current, position ? undefined : {',
      '                x: (24 - currentViewport.x) / currentViewport.k,',
      '                y: (80 - currentViewport.y) / currentViewport.k,',
      '                width: (size.width - 48) / currentViewport.k,',
      '                height: (size.height - 190) / currentViewport.k,',
      '            });',
    ].join('\n')],
    ['effectiveConfig.size, getCanvasCenter],', 'effectiveConfig.size, getCanvasCenter, size.width, size.height, setNodes],'],
    ['        setNodes(entry.nodes);', '        setRawNodes(entry.nodes);'],
    ['    const createAndOpenProject = useCallback(', organizer + '    const createAndOpenProject = useCallback('],
    [[
      '                    setNodes((prev) =>',
      '                        prev.map((node) => {',
      '                            const initial = initialPositions.get(node.id);',
      '                            return initial ? { ...node, position: { x: initial.x + dx, y: initial.y + dy } } : node;',
      '                        }),',
      '                    );',
    ].join('\n'), '                    setRawNodes(previewNodes);'],
    ['            let pendingChildIds: string[] = [];\n', '            let pendingChildIds: string[] = [];\n            const generationStartedAt = Date.now();\n'],
    [唯一行(oldProject, 'if (markSourceStatus) setNodes').replace('generationStartedAt, ', ''), 唯一行(oldProject, 'if (markSourceStatus) setNodes')],
    ['                    const rootId = reuseImageNode ? nodeId : nanoid();', resultIndex + '                    const rootId = reuseImageNode ? nodeId : nanoid();'],
    [[
      '                        position: {',
      '                            x: reuseImageNode ? parentPosition.x : parentPosition.x + parentConfig.width + 96,',
      '                            y: parentPosition.y + parentConfig.height / 2 - imageConfig.height / 2,',
      '                        },',
    ].join('\n') + '\n', resultPosition],
    ['                            primaryImageId: undefined,\n                            ...generationMetadata,', '                            primaryImageId: undefined,\n                            ...generationMetadata,\n                            generationStartedAt,'],
    ['                            model: generationConfig.model,\n                            size: generationConfig.size,\n                            seconds:', '                            model: generationConfig.model,\n                            generationStartedAt,\n                            size: generationConfig.size,\n                            seconds:'],
    [retryLine.replace('generationStartedAt: Date.now(), ', ''), retryLine],
    ['                    onExportProject={exportCurrentProject}\n', '                    onExportProject={exportCurrentProject}\n                    onOrganizeOverlaps={organizeOverlappingNodes}\n'],
  ]);
  const historyBefore = 唯一片段(candidate, '    const applyHistory = useCallback(', '    const undoCanvas = useCallback(');
  candidate = 精确替换(candidate, [[historyBefore, 精确替换(historyBefore, [['    }, []);', '    }, [setRawNodes]);']])]]);
  delta.set(path, { 原文: original, 产物: candidate });
  const menuPath = 'web/src/components/canvas/canvas-top-bar.tsx', menu = readFileSync(join(integration.副本, menuPath), 'utf8');
  const undoLine = 唯一行(menu, '{ key: "undo"');
  delta.set(menuPath, { 原文: menu, 产物: 精确替换(menu, [
    ['Download, Home, Images', 'Download, Grid2x2, Home, Images'],
    ['    onExportProject,\n', '    onExportProject,\n    onOrganizeOverlaps,\n'],
    ['    onExportProject: () => void;\n', '    onExportProject: () => void;\n    onOrganizeOverlaps: () => void;\n'],
    [undoLine, menuLine + '\n' + undoLine],
  ]) });
  const typePath = 'web/src/types/canvas.ts', type = readFileSync(join(integration.副本, typePath), 'utf8');
  delta.set(typePath, { 原文: type, 产物: 精确替换(type, [
    ['    errorDetails?: string;\n    fontSize?: number;', '    errorDetails?: string;\n    generationStartedAt?: number;\n    fontSize?: number;'],
  ]) });
  const modulePath = 'web/src/guan/卡片自动避让.ts';
  if (existsSync(join(integration.副本, modulePath))) throw Error('候选模块已存在，停止');
  delta.set(modulePath, { 原文: null, 产物: sources.get('src/canvas/lib/canvas/canvas-node-placement.ts') });
  核验日常启动完整源码(integration.副本, true);
  return { integration, delta };
}

// 完整检查日常前置及候选四文件；新增目录和导入均在虚拟CompilerHost内解析。
export function 预审卡片布局类型(preview) {
  const root = preview.integration.副本, web = join(root, 'web');
  const overrides = new Map([...preview.delta].map(([path, item]) => [resolve(root, path), item.产物]));
  const config = ts.readConfigFile(join(web, 'tsconfig.json'), ts.sys.readFile);
  if (config.error) throw Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, web);
  const host = ts.createCompilerHost(parsed.options);
  const read = path => overrides.get(resolve(path)) ?? ts.sys.readFile(path);
  host.readFile = read;
  host.fileExists = path => overrides.has(resolve(path)) || ts.sys.fileExists(path);
  host.directoryExists = path => [...overrides.keys()].some(file => file.startsWith(resolve(path) + sep)) || ts.sys.directoryExists(path);
  host.getCurrentDirectory = () => web;
  host.getSourceFile = (path, version) => {
    const content = read(path);
    return content === undefined ? undefined : ts.createSourceFile(path, content, version);
  };
  const program = ts.createProgram([...new Set([...parsed.fileNames, ...overrides.keys()].map(path => resolve(path)))],
    { ...parsed.options, incremental: false, noEmit: true }, host);
  const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
  if (diagnostics.length) throw Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCurrentDirectory: () => web, getCanonicalFileName: path => path, getNewLine: () => '\n',
  }));
  return true;
}
function 保存新审查(path, content) {
  if (existsSync(path) && readFileSync(path, 'utf8') !== content) throw Error('拒绝覆盖旧审查产物，请另建修订批次');
  if (!existsSync(path)) writeFileSync(path, content, { flag: 'wx', mode: 0o600 });
}
export function 预审卡片自动避让(generate = false) {
  检查运行副本();
  const preview = 构建卡片自动避让候选();
  预审卡片布局类型(preview);
  const patch = 生成审查差异(preview.delta);
  const manifest = {
    日期: '2026-10-18', 状态: '待具体差异批准；未接入隔离副本或3100',
    上游提交: 基线.提交, 前置记录: 卡片布局前置记录, 前置日常启动差异SHA256: preview.integration.日常启动差异SHA256,
    旧来源目录: 卡片布局旧目录, 旧来源指纹: 卡片布局来源指纹,
    自有来源: 卡片布局自有来源, 自有模块SHA256: 哈希(readFileSync(join(根目录, 卡片布局自有来源))),
    差异SHA256: 哈希(patch), 完整候选类型检查通过: true,
    真实浏览器验收: false, 已修改作者仓库: false, 已接管或重启3100: false,
    文件: [...preview.delta].map(([文件, item]) => ({ 文件, 原始SHA256: item.原文 === null ? null : 哈希(item.原文), 候选SHA256: 哈希(item.产物) })),
    范围: ['原几何模块逐字节迁入自有目录；新卡片同帧预留占位，已有卡片不自动整理',
      '旧版结果卡横向顺序、结果间距48和源间距32；生成媒体尺寸变化保留旧版避让标记',
      '加载、撤销恢复、拖动RAF使用原坐标快速入口；不在拖动每帧运行避让',
      '旧菜单原文、图标和整理撤销逻辑；不修改连线、CSS、主题、已关闭功能或SQLite协议',
      '用户批准后仅新隔离副本事务接入及真实画布验收；生产启用需另行当前维护确认'],
  };
  if (generate) {
    保存新审查(join(根目录, '上游适配/待审查/卡片自动避让原样迁入.patch'), patch);
    保存新审查(join(根目录, '上游适配/待审查/卡片自动避让原样迁入.json'), JSON.stringify(manifest, null, 2) + '\n');
  }
  核验日常启动完整源码(preview.integration.副本, true);
  检查运行副本();
  return manifest;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.slice(2).some(arg => arg !== '--生成审查差异')) throw Error('本工具只预审，不支持接入或重启');
  console.log(JSON.stringify(预审卡片自动避让(process.argv.includes('--生成审查差异')), null, 2));
}
