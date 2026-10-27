import { existsSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { 根目录, 基线 } from './公共.mjs';
import { 哈希, 检查运行副本 } from './检查运行副本.mjs';
import { 精确替换, 生成审查差异, ts } from './检查首批功能适配.mjs';
import { 预审卡片布局类型 } from './预审卡片自动避让.mjs';
import { 读取Excel视觉继承隔离记录, 核验Excel视觉继承完整包 } from './接入Excel视觉继承隔离副本.mjs';

export const Excel卡片前置记录 = join(根目录, '.运行/Excel视觉继承-7nFs1T/Excel视觉继承接入记录.json');
export const Excel卡片旧目录 = '/Users/guanchengbin/CodexProjects/guan-ai-workbench-projects/guan-ai-workbench';
export const Excel卡片旧指纹 = Object.freeze({
  'components/canvas/nodes/prompt-variables-node.tsx': '67c2903421bcf5566459ba4282b2f20e857754930ba0e85877fc16362ec9e38f',
  'lib/canvas/prompt-theme-labels.js': 'ba69d3869675a05a3a1d3aea36820d6e892dd354ec9cdd8ebbf383b9e3b441a7',
  'lib/canvas/excel-prompt-sync.ts': '36dc7db4fdd40fd0b507c1efdce702e6c54e662ee6cd2b0a6c77145b95f97227',
  'lib/canvas/parameter-memory.js': '7b83c6b7958cdf8e4b524dc7296d88bdee24e6955c64110c9ae87b83e53696de',
  'public/excel-prompts-bridge.js': '3bee43457c505123a51010c7e7fe8b7d080aa18ee9045976e26557ce75d36744',
  'pages/canvas/project.tsx': '1fa007d1bdac287c1bee26ac1e186d5a69e544d89b7c57907843bfc8678e0bfb',
  'types/canvas.ts': 'fb02101c01e2d028075270606ce809129b972a3ac3b7165b1c0f92a12c67cf95',
  'components/canvas/canvas-toolbar.tsx': 'dadf9b13c4c91bb7e5066882accf3f794454cdf4d28d56572a8d841a83e7f45b',
  'components/canvas/canvas-side-panel.tsx': 'f76927e69b86d1b77af6df1d650940025fddc09139a8e2c8fa450cf52d523503',
  'components/canvas/nodes/builtin-nodes.tsx': '5acb55cc075dcf2d9d21a458bbff8dce7ed6817ead107c885faa83bd0be847df',
});
export const Excel卡片自有文件 = ['Excel卡片上下文.ts', 'Excel画布上下文.tsx', 'Excel参数记忆.ts', 'Excel卡片事务.ts', 'Excel提示词列表.tsx', 'Excel提示词列表.css'];
export function 读取Excel卡片旧来源() {
  return new Map(Object.entries(Excel卡片旧指纹).map(([path, hash]) => {
    const file = join(Excel卡片旧目录, 'src/canvas', path), stat = lstatSync(file), source = readFileSync(file, 'utf8');
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || 哈希(source) !== hash) throw Error('Excel卡片旧来源改变：' + path);
    return [path, source];
  }));
}
function section(source, start, end) {
  if (source.split(start).length !== 2) throw Error('Excel卡片起点不唯一：' + start);
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  if (b < 0) throw Error('Excel卡片终点不存在：' + end);
  return source.slice(a, b);
}
function declaration(source, name) {
  const ast = ts.createSourceFile('legacy.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const items = ast.statements.filter(node => node.name?.text === name);
  if (items.length !== 1) throw Error('Excel卡片声明不唯一：' + name);
  return source.slice(items[0].getStart(ast), items[0].end);
}
export function 提取Excel卡片片段(legacy) {
  const original = legacy.get('components/canvas/nodes/prompt-variables-node.tsx');
  const rawRules = section(original, 'export const PROMPT_VARIABLES_NODE_TYPE', 'export function PromptVariablesContent');
  const rules = 'import { localizePromptTheme } from "./旧版主题翻译.js";\nimport type { CanvasNodeContext, CanvasNodeResource } from "@/types/canvas-plugin";\nimport type { CanvasNodeData, CanvasNodeMetadata } from "@/types/canvas";\n'
    + 精确替换(rawRules, [
      [declaration(original, 'WindowWithExcelPromptContext'), ''],
      [declaration(original, 'readExcelPromptContext'), ''],
      ['context = readExcelPromptContext()', 'context: ExcelPromptContext = { fileName: "", activeProductName: "", templates: [] }'],
      ['previousValues: Record<string, string> = readCurrentParameterValues()', 'previousValues: Record<string, string> = {}'],
    ]) + '\nexport { variableLabel, pickCurrentTemplate, productVariableTokens };\n';
  const rawUI = declaration(original, 'PromptVariablesContent');
  const analyze = section(rawUI, '    const analyzeThemes = () => {', '    useEffect(() => {');
  const subscription = section(rawUI, '    useEffect(() => {\n        const refresh =', '    useEffect(() => {\n        if (!tokens.length)');
  const ui = 'import { useEffect, useMemo } from "react";\nimport { Braces } from "lucide-react";\nimport { Button } from "antd";\nimport { canvasThemes } from "@/lib/canvas-theme";\nimport { useThemeStore } from "@/stores/use-theme-store";\nimport type { CanvasNodeContext } from "@/types/canvas-plugin";\nimport type { CanvasNodeMetadata } from "@/types/canvas";\nimport { promptVariableTokens, resolvePromptVariables, variableLabel, productVariableTokens } from "./旧版参数规则";\nimport { useExcelProductId, useExcelPromptContext } from "./Excel画布上下文";\nimport { readProductParameterValues, saveProductParameterValues } from "./Excel参数记忆";\n'
    + 精确替换(rawUI, [
      ['    const { modal, message } = App.useApp();\n    const config = useEffectiveConfig();\n    const [analyzing, setAnalyzing] = useState(false);', '    const productId = useExcelProductId();'],
      ['    const [context, setContext] = useState(readExcelPromptContext);', '    const context = useExcelPromptContext(productId);'],
      ['    const currentTemplate = useMemo(() => pickCurrentTemplate(context, metadata), [context, metadata.promptVariableTemplateId]);\n', ''],
      [analyze, ''], [subscription, ''],
      ['...readCurrentParameterValues()', '...readProductParameterValues(productId)'],
      ['saveCurrentParameterValues(restored);', 'saveProductParameterValues(productId, restored);'],
      ['    }, [ctx.node.id]);', '    }, [ctx.node.id, productId]);'],
      ['saveCurrentParameterValues({ [token]: value });', 'saveProductParameterValues(productId, { [token]: value });'],
      ['<Button size="small" loading={analyzing} onClick={analyzeThemes} title="按需调用已配置的文本模型识别已连接卡片主题，可能产生费用">AI 校准主题</Button>', '<Button size="small" disabled title="AI 校准需后续接入受限凭据网关；当前仅使用旧版离线主题规则，不发送提示词。">AI 校准主题</Button>'],
    ]) + '\n';
  const sync = legacy.get('lib/canvas/excel-prompt-sync.ts').replace('"@/components/canvas/nodes/prompt-variables-node"', '"./旧版参数规则"');
  const previewTitle = declaration(legacy.get('pages/canvas/project.tsx'), 'finalPromptPreviewTitle');
  const metadata = section(legacy.get('types/canvas.ts'), '    // Values and source prompt', '\n};');
  const toolbar = section(legacy.get('components/canvas/canvas-toolbar.tsx'), '                <ToolbarButton id="tool-prompt-variables"', '                <ToolbarButton id="tool-text"');
  const registry = `import { Settings2 } from "lucide-react";\nimport { registerNodeDefinitions } from "@/lib/canvas/node-registry";\nimport { PROMPT_VARIABLES_NODE_TYPE, promptVariablesResource } from "./旧版参数规则";\nimport { PromptVariablesContent } from "./旧版参数卡片";\nexport function registerExcelParameterNode() {\nregisterNodeDefinitions([{ type: PROMPT_VARIABLES_NODE_TYPE, title: "产品参数设置", description: "产品参数设置", icon: <Settings2 className="size-4" />, minimapColor: "#14b8a6", Content: PromptVariablesContent, resource: promptVariablesResource, hidePanel: true, showInCreateMenu: false, defaultSize: { width: 420, height: 520 }, defaultMetadata: { status: "success" } }]);\n}\n`;
  return { rawRules, rawUI, previewTitle, metadata, toolbar,
    generated: new Map([
      ['旧版参数规则.ts', rules], ['旧版参数卡片.tsx', ui], ['旧版主题翻译.js', legacy.get('lib/canvas/prompt-theme-labels.js')],
      ['旧版提示词同步.ts', sync], ['旧版最终提示词标题.ts', 'import type { CanvasNodeData } from "@/types/canvas";\nexport ' + previewTitle + '\n'], ['Excel参数节点注册.tsx', registry],
    ]) };
}

export function 构建Excel卡片候选() {
  const integration = 读取Excel视觉继承隔离记录(Excel卡片前置记录), legacy = 读取Excel卡片旧来源();
  const snippets = 提取Excel卡片片段(legacy), delta = new Map();
  const read = path => readFileSync(join(integration.副本, path), 'utf8');
  const edit = (path, changes) => { const 原文 = read(path); let 产物 = 原文; for (const change of changes) { if (产物.split(change[0]).length !== 2) throw Error('Excel卡片接入锚点不唯一：' + path + ' ' + change[0]); 产物 = 精确替换(产物, [change]); } delta.set(path, { 原文, 产物 }); };
  const add = (file, 产物) => { const path = 'web/src/guan/' + file; if (existsSync(join(integration.副本, path))) throw Error('Excel卡片新增路径已存在'); delta.set(path, { 原文: null, 产物 }); };
  for (const file of Excel卡片自有文件) add(file, readFileSync(join(根目录, '扩展功能/Excel画布', file), 'utf8'));
  for (const [file, content] of snippets.generated) add(file, content);
  edit('web/src/types/canvas.ts', [['    interactive?: boolean; // Plugin node interaction/move state; see CanvasNodeDefinition.interactionToggle.', '    interactive?: boolean; // Plugin node interaction/move state; see CanvasNodeDefinition.interactionToggle.\n' + snippets.metadata]]);
  edit('web/src/components/canvas/asset-picker-modal.tsx', [
    ['{ kind: "text"; content: string; title: string }', '{ kind: "text"; content: string; title: string; excelProductId?: string; excelPrompt?: { templateId?: string; key?: string; label?: string; theme?: string; compositionLock?: string; purpose?: string; tokens?: string[] } }'],
    ['export type InsertAssetPayload = ', 'export type InsertAssetPayload = { kind: "excel-batch"; productId: string; includeVideo: boolean } | '],
  ]);
  edit('web/src/components/canvas/canvas-side-panel.tsx', [
    ['import { fetchSourcePrompts, type Prompt }', 'import { ExcelPromptGroup } from "@/guan/Excel提示词列表";\nimport { fetchSourcePrompts, type Prompt }'],
    ['import { ExcelPromptGroup }', 'import { useExcelProductId, useExcelPromptContext } from "@/guan/Excel画布上下文";\nimport { ExcelPromptGroup }'],
    ['    const enabledSources = useMemo(() => sources.filter((source) => source.enabled), [sources]);', '    const enabledSources = useMemo(() => sources.filter((source) => source.enabled), [sources]);\n    const localExcel = useExcelPromptContext(useExcelProductId());\n    const hasExcelPrompts = localExcel.templates.some(template => Object.values(template.prompts).some(value => value.trim()));'],
    ['                    {enabledSources.length ? enabledSources.map', '                    <ExcelPromptGroup keyword={keyword} theme={theme} onInsert={onInsert} onView={setDetail} renderRow={(item, insert, view) => <PromptRow item={item} theme={theme} onInsert={insert} onView={view} />} />\n                    {enabledSources.length ? enabledSources.map'],
    [')) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("canvas.sidePanel.noPrompts")} className="pt-12" />}', ')) : !hasExcelPrompts ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("canvas.sidePanel.noPrompts")} className="pt-12" /> : null}'],
  ]);
  edit('web/src/components/canvas/canvas-toolbar.tsx', [
    ['import { CircleDot,', 'import { Braces, CircleDot,'], ['    onAddText,', '    onAddText,\n    onAddPromptVariables,'],
    ['    onAddText: () => void;', '    onAddText: () => void;\n    onAddPromptVariables: () => void;'],
    ['                <ToolbarButton id="tool-text"', snippets.toolbar.replace('t("canvas.toolbar.promptVariables")', '"产品参数设置"') + '                <ToolbarButton id="tool-text"'],
    ['function toolLabel(id: string, t: (key: string) => string) {', 'function toolLabel(id: string, t: (key: string) => string) {\n    if (id === "tool-prompt-variables") return "产品参数设置";'],
  ]);
  const project = read('web/src/pages/canvas/project.tsx');
  const insert = `    const insertExcelCards = useCallback((request: ExcelInsertRequest, center?: Position) => {
        if (!productActive || !projectLoaded || restoredProjectIdRef.current !== projectId) return;
        try {
            const result = insertExcelPromptCards(nodesRef.current, connectionsRef.current, excelContext, request, center || getCanvasCenter(), excelFactory,
                node => window.confirm(\`「\${node.title || "提示词"}」已手动修改，是否使用 Excel 新内容覆盖？\`), syncExcelPromptNodes);
            setNodes(result.nodes); connectionsRef.current = result.connections; setConnections(result.connections);
            setSelectedNodeIds(new Set(result.selectedIds)); setSelectedConnectionId(null);
        } catch (error) { message.error(error instanceof Error ? error.message : "Excel提示词插入失败，原画布保留"); }
    }, [productActive, projectLoaded, projectId, excelContext, getCanvasCenter, setNodes, message]);

    useEffect(() => {
        if (!projectLoaded) return;
        const next = syncExcelPromptNodes(nodesRef.current, excelContext, node => productActive ? window.confirm(\`「\${node.title || "提示词"}」已手动修改，是否使用 Excel 新内容覆盖？\`) : undefined);
        if (next !== nodesRef.current) setNodes(next);
    }, [excelContext, projectLoaded, productActive, setNodes]);

`;
  const connectBody = `                const bound = bindExcelParameters(nodesRef.current, connectionsRef.current, fromNodeId, toNodeId, excelFactory);
                if (bound) { setNodes(bound.nodes); connectionsRef.current = bound.connections; setConnections(bound.connections); }
                else setConnections((prev) => [...prev, { id: nanoid(), fromNodeId, toNodeId }]);`;
  const deletionStart = section(project, '            const allIds = new Set(ids);', '            setSelectedNodeIds(new Set());');
  const deletion = deletionStart.replace('const allIds = new Set(ids)', 'const allIds = excelDeletionIds(nodesRef.current, ids)').replace('                    const groupId = node.metadata?.groupId;', '                    node = clearDeletedExcelRelations(node, allIds);\n                    const groupId = node.metadata?.groupId;');
  const dropStart = '            event.preventDefault();\n            const files = Array.from(event.dataTransfer.files)';
  edit('web/src/pages/canvas/project.tsx', [
    ['import { useProductActive }', 'import { ExcelCanvasScope, useExcelPromptContext } from "@/guan/Excel画布上下文";\nimport { registerExcelParameterNode } from "@/guan/Excel参数节点注册";\nimport { PROMPT_VARIABLES_NODE_TYPE } from "@/guan/旧版参数规则";\nimport { readProductParameterValues } from "@/guan/Excel参数记忆";\nimport { syncExcelPromptNodes } from "@/guan/旧版提示词同步";\nimport { bindExcelParameters, createProductParameterNode, insertExcelPromptCards, reconcileExcelPreviews, excelDeletionIds, clearDeletedExcelRelations, disconnectExcelParameters, remapCopiedExcelRelations, type ExcelInsertRequest } from "@/guan/Excel卡片事务";\nimport { EXCEL_PROMPT_DRAG_TYPE } from "@/guan/Excel提示词列表";\nimport { useProductActive }'],
    ['registerBuiltinNodes();', 'registerBuiltinNodes();\nregisterExcelParameterNode();\nconst excelFactory = { create: createCanvasNode, edgeId: nanoid, place: placeCanvasNode };'],
    ['    const projectId = params.id || "";', '    const projectId = params.id || "";\n    const excelContext = useExcelPromptContext(projectId);'],
    ['placeNewCanvasNodes(previous, typeof update === "function" ? update(previous) : update)', 'placeNewCanvasNodes(previous, reconcileExcelPreviews(previous, typeof update === "function" ? update(previous) : update))'],
    ['    const connectNodes = useCallback(', insert + '    const connectNodes = useCallback('],
    ['                setConnections((prev) => [...prev, { id: `conn-${Date.now()}`, fromNodeId, toNodeId }]);', '                try {\n' + connectBody + '\n                } catch (error) { message.warning(error instanceof Error ? error.message : "参数连接失败"); }'],
    ['            setNodes((prev) => [...prev, newNode]);\n            setConnections((prev) => [...prev, { id: nanoid(), ...connection }]);', '            const bound = bindExcelParameters([...nodesRef.current, newNode], connectionsRef.current, connection.fromNodeId, connection.toNodeId, excelFactory);\n            if (bound) { setNodes(bound.nodes); connectionsRef.current = bound.connections; setConnections(bound.connections); }\n            else { setNodes((prev) => [...prev, newNode]); setConnections((prev) => [...prev, { id: nanoid(), ...connection }]); }'],
    ['            const newNode = placeCanvasNode(createCanvasNode(type, targetPosition, configMetadata), nodesRef.current, position ? undefined : {', '            const newNode = placeCanvasNode(type === PROMPT_VARIABLES_NODE_TYPE ? createProductParameterNode(excelContext, targetPosition, readProductParameterValues(projectId), excelFactory) : createCanvasNode(type, targetPosition, configMetadata), nodesRef.current, position ? undefined : {'],
    ['effectiveConfig.size, getCanvasCenter, size.width, size.height, setNodes],', 'effectiveConfig.size, getCanvasCenter, size.width, size.height, setNodes, excelContext, projectId],'],
    [deletionStart, deletion],
    ['        setConnections((prev) => prev.filter((conn) => conn.id !== connectionId));', '        const detached = disconnectExcelParameters(nodesRef.current, connectionsRef.current, connectionId);\n        if (detached) { setNodes(detached.nodes); connectionsRef.current = detached.connections; setConnections(detached.connections); }\n        else setConnections((prev) => prev.filter((conn) => conn.id !== connectionId));'],
    ['    const disconnectNodeReference = useCallback((fromNodeId: string, toNodeId: string) => {\n        setConnections((prev) => prev.filter((connection) => connection.fromNodeId !== fromNodeId || connection.toNodeId !== toNodeId));\n    }, []);', '    const disconnectNodeReference = useCallback((fromNodeId: string, toNodeId: string) => {\n        const edge = connectionsRef.current.find(connection => connection.fromNodeId === fromNodeId && connection.toNodeId === toNodeId);\n        if (edge) deleteConnection(edge.id);\n    }, [deleteConnection]);'],
    ['        const pastedNodes = nextNodes.map((node) => {', '        const pastedNodes = nextNodes.map((node: CanvasNodeData) => {\n            node = remapCopiedExcelRelations(node, idMap);'],
    [dropStart, `            event.preventDefault();
            const excelDrag = event.dataTransfer.getData(EXCEL_PROMPT_DRAG_TYPE);
            if (excelDrag) {
                try {
                    const request: unknown = JSON.parse(excelDrag);
                    if (!request || typeof request !== "object" || !("productId" in request) || !("templateId" in request) || !("key" in request) || typeof request.productId !== "string" || typeof request.templateId !== "string" || typeof request.key !== "string") throw Error("Excel拖入数据格式错误");
                    insertExcelCards({ productId: request.productId, templateId: request.templateId, key: request.key }, screenToCanvas(event.clientX, event.clientY));
                } catch (error) { message.warning(error instanceof Error ? error.message : "Excel拖入失败"); }
                return;
            }
            const files = Array.from(event.dataTransfer.files)`],
    ['        [createAudioFileNode, createImageFileNode, createVideoFileNode, screenToCanvas],', '        [createAudioFileNode, createImageFileNode, createVideoFileNode, screenToCanvas, insertExcelCards, message],'],
    ['            if (payload.kind === "text") {\n                insertAssistantText(payload.content, payload.title);', '            if (payload.kind === "excel-batch") {\n                insertExcelCards(payload);\n            } else if (payload.kind === "text" && payload.excelPrompt) {\n                insertExcelCards({ productId: payload.excelProductId || "", templateId: payload.excelPrompt.templateId, key: payload.excelPrompt.key });\n            } else if (payload.kind === "text") {\n                insertAssistantText(payload.content, payload.title);'],
    ['        [insertAssistantImage, insertAssistantText, screenToCanvas, size.height, size.width],', '        [insertAssistantImage, insertAssistantText, screenToCanvas, size.height, size.width, insertExcelCards],'],
    ['                    onAddExtensionNode={(type) => createNode(type)}', '                    onAddPromptVariables={() => createNode(PROMPT_VARIABLES_NODE_TYPE)}\n                    onAddExtensionNode={(type) => createNode(type)}'],
    ['        <main className="flex h-full', '        <ExcelCanvasScope productId={projectId}><main className="flex h-full'],
    ['        </main>\n    );', '        </main></ExcelCanvasScope>\n    );'],
  ]);
  核验Excel视觉继承完整包(integration.组合包, true);
  return { integration, legacy, snippets, delta };
}
export function 预审Excel卡片(generate = false) {
  检查运行副本();
  const preview = 构建Excel卡片候选();
  预审卡片布局类型({ ...preview, delta: new Map([...preview.delta].filter(([path]) => /\.[jt]sx?$/.test(path))) });
  const patch = 生成审查差异(preview.delta);
  const manifest = { 日期: '2026-10-19', 状态: '待具体批准；仅内存候选，未接入/运行/重启3100', 上游提交: 基线.提交,
    前置记录: Excel卡片前置记录, 前置差异SHA256: preview.integration.差异SHA256,
    旧来源目录: Excel卡片旧目录, 旧来源SHA256: Excel卡片旧指纹,
    自有来源: Excel卡片自有文件.map(file => ({ 文件: '扩展功能/Excel画布/' + file, SHA256: 哈希(readFileSync(join(根目录, '扩展功能/Excel画布', file))) })),
    原文片段SHA256: Object.fromEntries(['rawRules', 'rawUI', 'previewTitle', 'metadata', 'toolbar'].map(key => [key, 哈希(preview.snippets[key])])),
    工具来源: ['开发工具/预审Excel卡片与变量迁入.mjs', '开发工具/Excel卡片与变量迁入.test.mjs'].map(文件 => ({ 文件, SHA256: 哈希(readFileSync(join(根目录, 文件))) })),
    差异SHA256: 哈希(patch), 文件数: preview.delta.size, 完整虚拟类型检查通过: true,
    已接入: false, 真实浏览器验收: false, 已修改作者仓库: false, 已访问正式数据: false,
    文件: [...preview.delta].map(([文件, item]) => ({ 文件, 原始SHA256: item.原文 === null ? null : 哈希(item.原文), 候选SHA256: 哈希(item.产物) })),
    范围: ['Excel本地提示词源、原列表行/详情、视频开关、单独及一键插入、拖入', '原参数卡420×520、英文主题翻译、尺寸优先规则、变量替换、最终提示词预览', '稳定产品ID隔离、SQLite参数记忆、重传手改保护、去重、删除/撤销关系一致性', '一键导入只连接已有参数卡；不自动整理客户既有卡片，不沿用旧DOM扫描/定时点击', 'AI校准按钮保持外观但禁用并解释，收费调用/生成联动/工作簿整批删除另批', '批准后独立后继保护器、原态快照事务及临时SQLite真实浏览器/视觉对照；不含3100切换或发布'] };
  if (generate) for (const [ext, value] of [['patch', patch], ['json', JSON.stringify(manifest, null, 2) + '\n']]) {
    const path = join(根目录, '上游适配/待审查/Excel卡片与变量迁入.' + ext);
    if (existsSync(path)) throw Error('拒绝覆盖既有审查产物，请另建修订批次');
    writeFileSync(path, value, { flag: 'wx', mode: 0o600 });
  }
  核验Excel视觉继承完整包(preview.integration.组合包, true); 检查运行副本();
  return manifest;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.slice(2).some(arg => arg !== '--生成审查差异')) throw Error('仅支持内存预审及生成审查，不接入或启动');
  console.log(JSON.stringify(预审Excel卡片(process.argv.includes('--生成审查差异')), null, 2));
}
