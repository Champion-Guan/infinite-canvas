import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { 根目录, 基线 } from './公共.mjs';
import { 哈希, 检查运行副本 } from './检查运行副本.mjs';
import { 精确替换, 生成审查差异, ts } from './检查首批功能适配.mjs';
import { buildCombinedCandidate, fallbackBackend, fallbackFrontend, fallbackOldSources } from './预审代理与Fallback闭环.mjs';
import { 网络代理后端文件, 网络代理前端文件 } from './预审内置网络代理.mjs';
import { 构建安全与批量候选, 读取普通来源, 唯一片段 } from './预审安全与批量迁移.mjs';
import { 配置安全旧目录 } from './预审配置文件安全.mjs';
import { 创建类型依赖只读镜像 } from './类型依赖只读镜像.mjs';
import { 核验凭据网关任务完整包 } from './接入凭据网关任务隔离副本.mjs';

export const 扩大旧来源 = Object.freeze({
  'src/canvas/pages/canvas/project.tsx': '1fa007d1bdac287c1bee26ac1e186d5a69e544d89b7c57907843bfc8678e0bfb',
  'src/canvas/components/canvas/canvas-node.tsx': '0f7b67ca9219893da2c3c0b15027019255c82a219ef518c94a4c2484e90285a1',
  'src/canvas/components/canvas/canvas-node-hover-toolbar.tsx': '139aa4eed6a53f7510a7ad97ee3b18a4779b052ffb8f999735c930cbd51f3e89',
  'src/canvas/components/canvas/canvas-image-toolbar-tools.tsx': 'c22201101f96dddec46319ebb34ff50a2f7e0cb8b5060e681072de9ec37e429a',
  'src/canvas/lib/canvas/canvas-generation-helpers.ts': '0fcfa8d1c4297e738db1c5a3b7013d38fdad9bb54077f9294a9288045c3db2e0',
  'src/canvas/lib/canvas/prompt-variable-highlight.js': 'ccd969879532208fd442919d307c91be6dd9fe67934db656e99511f375be5a62',
  'src/canvas/lib/canvas/prompt-theme-labels.js': 'ba69d3869675a05a3a1d3aea36820d6e892dd354ec9cdd8ebbf383b9e3b441a7',
  'src/canvas/services/media-download.ts': 'a4e5c60338a84b14d45e964bf26041002a591450278eab027fa193fb90e7f196',
});
export const 扩大输入指纹 = Object.freeze({
  '安全与批量迁移.patch': 'bf3ca4807a964c13ea82e858c62b8b0410a109a90aac712cdb79b62978fa23d6',
  '安全与批量迁移.json': 'a591feec59fd04c1b9fdb74be076a0c9b0214dbe52076f0758a850d053381710',
});
const own = path => 读取普通来源(根目录, path);
// Textual composition only, in a disposable system temp directory. A conflict,
// unequal base, add/add, or unknown merge status always rejects the candidate.
export function 合并同前态候选(left, right) {
  if (left.原文 !== right.原文 || left.原文 === null) throw Error('整批合并拒绝不同前态或新增路径冲突');
  const temp = mkdtempSync(join(tmpdir(), 'guan-expand-merge-'));
  try {
    for (const [name, value] of [['left', left.产物], ['base', left.原文], ['right', right.产物]]) writeFileSync(join(temp, name), value, { flag: 'wx', mode: 0o600 });
    const result = spawnSync('git', ['merge-file', '-p', join(temp, 'left'), join(temp, 'base'), join(temp, 'right')], { encoding: 'utf8', timeout: 10_000, maxBuffer: 8 * 1024 * 1024 });
    if (result.error || result.status !== 0 || result.signal) throw Error('整批候选存在未审查合并冲突');
    return { 原文: left.原文, 产物: result.stdout };
  } finally { rmSync(temp, { recursive: true, force: true }); }
}
export function 构建迁移扩大整批候选() {
  for (const [name, hash] of Object.entries(扩大输入指纹)) if (哈希(own('上游适配/待审查/' + name)) !== hash) throw Error('冻结前批改变：' + name);
  const previous = JSON.parse(own('上游适配/待审查/安全与批量迁移.json'));
  for (const item of [...previous.自有来源, ...previous.工具来源]) if (哈希(own(item.文件)) !== item.SHA256) throw Error('冻结前批来源变化：' + item.文件);
  const combined = buildCombinedCandidate(), safety = 构建安全与批量候选();
  if (combined.integration.组合包 !== safety.integration.组合包) throw Error('整批前置不一致');
  if (safety.delta.size !== previous.文件数 || 哈希(生成审查差异(safety.delta)) !== previous.差异SHA256) throw Error('冻结14文件不能重建');
  const { integration } = combined, delta = new Map(combined.delta), merged = [];
  for (const [path, item] of safety.delta) {
    const target = '画布副本/' + path;
    if (delta.has(target)) { delta.set(target, 合并同前态候选(delta.get(target), item)); merged.push(target); }
    else delta.set(target, item);
  }
  const old = new Map(Object.entries(扩大旧来源).map(([path, hash]) => {
    const value = 读取普通来源(配置安全旧目录, path);
    if (哈希(value) !== hash) throw Error('扩大批次旧来源变化：' + path);
    return [path.slice('src/canvas/'.length), value];
  }));
  const read = path => delta.get(path)?.产物 ?? 读取普通来源(integration.组合包, path);
  function set(path, 产物) {
    const prior = delta.get(path);
    delta.set(path, { 原文: prior ? prior.原文 : existsSync(join(integration.组合包, path)) ? 读取普通来源(integration.组合包, path) : null, 产物 });
  }
  const edit = (path, pairs) => {
    let value = read(path);
    for (const [before, after] of pairs) {
      if (value.split(before).length !== 2) throw Error('扩大适配锚点不唯一：' + path + ' / ' + before.slice(0, 140));
      value = 精确替换(value, [[before, after]]);
    }
    set(path, value);
  };
  for (const [source, path] of [['lib/canvas/prompt-variable-highlight.js', 'guan/prompt/prompt-variable-highlight.js'], ['lib/canvas/prompt-theme-labels.js', 'guan/prompt/prompt-theme-labels.js'], ['services/media-download.ts', 'services/media-download.ts']]) {
    const target = '画布副本/web/src/' + path, value = own('扩展功能/画布迁移扩展/' + source.split('/').at(-1));
    if (value !== old.get(source) || delta.has(target) || existsSync(join(integration.组合包, target))) throw Error('新增模块必须逐字节继承旧来源');
    set(target, value);
  }
  const projectPath = '画布副本/web/src/pages/canvas/project.tsx', oldProject = old.get('pages/canvas/project.tsx');
  const refCallback = 精确替换(唯一片段(oldProject, '    const useImageAsGlobalReference = useCallback(', '    useEffect(() => {\n        if (!referencePickerNodeId)'), [
    ['(imageNode: CanvasNodeData) => {', '(requestedNode: CanvasNodeData) => {\n        const imageNode = nodesRef.current.find(node => node.id === requestedNode.id);\n        if (!imageNode) return;'],
  ]);
  const connectPatch = 唯一片段(oldProject, '                const promptNode = nextNodes.find', '                if (adaptiveNode && promptNode)');
  const callbackStart = '    const generateImageFromTextNode = useCallback(', callbackEnd = '    const addGenerationConfigsForPromptNodes = useCallback(';
  const single = 唯一片段(read(projectPath), callbackStart, callbackEnd);
  const singleNew = 精确替换(single, [
    ['                    count: getGenerationCount(effectiveConfig.canvasImageCount || effectiveConfig.count),', '                    count: getGenerationCount(effectiveConfig.canvasImageCount || effectiveConfig.count),\n                    ...detectedPromptConfig(sourceNode, nodesRef.current, connectionsRef.current, effectiveConfig),'],
    ['[effectiveConfig.canvasImageCount, effectiveConfig.count, effectiveConfig.imageModel, effectiveConfig.model, effectiveConfig.size, message, t]', '[effectiveConfig, message, setNodes, t]'],
  ]);
  const downloadOld = 唯一片段(oldProject, '    const downloadNodeImage = useCallback(', '    const captureVideoNodeFrame = useCallback(');
  const downloadNew = 精确替换(downloadOld, [
    ['const name = node.type === CanvasNodeType.Image ? generatedImageName(node, node.metadata.primaryImageId) : node.title || `canvas-${node.type}-${node.id}`;', 'const name = `canvas-${node.type}-${node.id}`;'],
    ['generatedImageName(node, imageId).replace(/[\\\\/:*?"<>|]/g, "_")', '`canvas-image-${node.id}-${image.id}`.replace(/[\\\\/:*?"<>|]/g, "_")'],
  ]);
  edit(projectPath, [
    ['import { saveAs } from "file-saver";', 'import { saveAs } from "file-saver";\nimport { readDownloadBlob } from "@/services/media-download";'],
    ['const INHERITED_GENERATION_SETTINGS', `function detectedPromptConfig(source: CanvasNodeData, all: CanvasNodeData[], connections: CanvasConnection[], config: ReturnType<typeof useEffectiveConfig>): CanvasNodeMetadata {
    const mode = promptGenerationMode(source, all, connections) || "image";
    return {
        model: config.imageModel || config.model, size: config.size,
        count: getGenerationCount(config.canvasImageCount || config.count),
        ...promptGenerationPatch(String(source.metadata?.content || source.metadata?.prompt || "")),
        ...generationSettingsFromNode(source), generationMode: mode,
        ...(mode !== "image" ? { model: mode === "video" ? config.videoModel : mode === "audio" ? config.audioModel : config.textModel } : {}),
        generationParamsSourceNodeId: source.id,
    };
}

const INHERITED_GENERATION_SETTINGS`],
    ['                try {\n                const bound = bindExcelParameters(nodesRef.current,', '                try {\n                let nextNodes = nodesRef.current;\n' + connectPatch + '                if (nextNodes !== nodesRef.current) setNodes(nextNodes);\n                const bound = bindExcelParameters(nextNodes,'],
    ['        [message, t],\n    );\n\n    const createConnectedNode', '        [effectiveConfig, message, setNodes, t],\n    );\n\n    const createConnectedNode'],
    ['            const newNode = createCanvasNode(type, pending.position, metadata);', '            const source = nodesRef.current.find(node => node.id === pending.connection.nodeId);\n            const newNode = createCanvasNode(type, pending.position, type === CanvasNodeType.Config && source ? { ...metadata, ...detectedPromptConfig(source, nodesRef.current, connectionsRef.current, effectiveConfig) } : metadata);'],
    ['[effectiveConfig.canvasImageCount, effectiveConfig.count, effectiveConfig.imageModel, effectiveConfig.model, effectiveConfig.size, message, setConnecting, t]', '[effectiveConfig, message, setConnecting, setNodes, t]'],
    ['    const deselectCanvas = useCallback(', refCallback + '    const deselectCanvas = useCallback('],
    [single, singleNew],
    [唯一片段(read(projectPath), '    const downloadNodeImage = useCallback(', '    const captureVideoNodeFrame = useCallback('), downloadNew],
    ['                            registryVersion={nodeRegistryVersion}', '                            registryVersion={nodeRegistryVersion}\n                            promptHighlightSource={node.metadata?.promptVariableSourceNodeId ? nodeById.get(node.metadata.promptVariableSourceNodeId) : undefined}\n                            promptHighlightParameters={node.metadata?.promptVariablePreviewOf ? nodeById.get(node.metadata.promptVariablePreviewOf) : undefined}'],
    ['                    onSaveAsset={(node) => void saveNodeAsset(node)}', '                    onSaveAsset={(node) => void saveNodeAsset(node)}\n                    onUseAsGlobalReference={useImageAsGlobalReference}'],
    ['[completeVideoNodeTask, effectiveConfig, finishGenerationRequest, isAiConfigReady, message, openConfigDialog, projectId, recordImageGatewayTask, startGenerationRequest, t]', '[completeVideoNodeTask, effectiveConfig, finishGenerationRequest, isAiConfigReady, message, openConfigDialog, projectId, recordImageGatewayTask, setNodes, startGenerationRequest, t]'],
    ['[completeVideoNodeTask, effectiveConfig, finishGenerationRequest, isAiConfigReady, message, openConfigDialog, pollVideoNodeTask, projectId, recordImageGatewayTask, startGenerationRequest, t]', '[completeVideoNodeTask, effectiveConfig, finishGenerationRequest, isAiConfigReady, message, openConfigDialog, pollVideoNodeTask, projectId, recordImageGatewayTask, setNodes, startGenerationRequest, t]'],
  ]);
  // This short array reads an external-store snapshot. Recompute it on the
  // subscribed render, instead of a memo with a synthetic unused dependency.
  const pickerPath = '画布副本/web/src/components/model-picker.tsx';
  const optionsLine = read(pickerPath).split('\n').find(line => line.includes('const options = useMemo('));
  if (!optionsLine) throw Error('模型选择器选项锚点缺失');
  edit(pickerPath, [
    ['useEffect, useId, useMemo, useState', 'useEffect, useId, useState'],
    ['const fallbackRevision = useFallbackRevision();', 'useFallbackRevision();'],
    [optionsLine, 精确替换(optionsLine, [['useMemo(() => ', ''], [', [capability, config, value, fallbackRevision]);', ';']])],
  ]);
  const toolbar = old.get('components/canvas/canvas-node-hover-toolbar.tsx');
  edit('画布副本/web/src/components/canvas/canvas-node-hover-toolbar.tsx', [
    ['Info, MessageSquare', 'Info, Link2, MessageSquare'],
    ['    onSaveAsset: (node: CanvasNodeData) => void;', '    onSaveAsset: (node: CanvasNodeData) => void;\n    onUseAsGlobalReference: (node: CanvasNodeData) => void;'],
    ['    onSaveAsset,\n', '    onSaveAsset,\n    onUseAsGlobalReference,\n'],
    ['        ...(hasImage || hasVideo || hasAudio ? [{ id: "download",', 唯一片段(toolbar, '        ...(hasImage ? [{ id: "globalReference",', '        ...(hasImage || hasVideo || hasAudio ? [{ id: "download",') + '        ...(hasImage || hasVideo || hasAudio ? [{ id: "download",'],
  ]);
  edit('画布副本/web/src/components/canvas/canvas-image-toolbar-tools.tsx', [
    ['"saveAsset" | "download"', '"saveAsset" | "globalReference" | "download"'],
    ['["info", "delete", "saveAsset", "download"]', '["info", "delete", "saveAsset", "globalReference", "download"]'],
  ]);
  const nodePath = '画布副本/web/src/components/canvas/canvas-node.tsx', nodeOld = old.get('components/canvas/canvas-node.tsx');
  const props = '    promptHighlightSource?: CanvasNodeData;\n    promptHighlightParameters?: CanvasNodeData;\n';
  const nodeNew = 精确替换(read(nodePath), [
    ['import React,', 'import { promptHighlightSegments } from "@/guan/prompt/prompt-variable-highlight.js";\nimport { localizePromptTheme } from "@/guan/prompt/prompt-theme-labels.js";\nimport React,'],
    ['    pluginHost?: CanvasPluginHost;', '    pluginHost?: CanvasPluginHost;\n' + props],
    ['    pluginContext?: CanvasNodeContext | null;', '    pluginContext?: CanvasNodeContext | null;\n' + props],
    ['    pluginHost,\n', '    pluginHost,\n    promptHighlightSource,\n    promptHighlightParameters,\n'],
    ['                        node={data}\n', '                        node={data}\n                        promptHighlightSource={promptHighlightSource}\n                        promptHighlightParameters={promptHighlightParameters}\n'],
    [唯一片段(read(nodePath), 'function TextContent(', 'function ExpandedTextCard('), 唯一片段(nodeOld, 'function TextContent(', 'function ExpandedTextCard(')],
  ]);
  set(nodePath, nodeNew);
  return { integration, delta, merged, combinedFileCount: combined.delta.size, safetyFileCount: safety.delta.size };
}

export function 检查扩大整批类型(preview) {
  const root = preview.integration.副本, web = join(root, 'web');
  const dependencies = 创建类型依赖只读镜像(ts.sys.readFile, join(web, 'node_modules/.pnpm/lock.yaml'));
  const overrides = new Map([...preview.delta].filter(([path]) => path.startsWith('画布副本/web/')).map(([path, item]) => [resolve(preview.integration.组合包, path), item.产物]));
  const read = path => overrides.get(resolve(path)) ?? dependencies.read(path);
  const config = ts.readConfigFile(join(web, 'tsconfig.json'), read);
  if (config.error) throw Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, web), host = ts.createCompilerHost(parsed.options);
  host.readFile = read;
  host.fileExists = path => overrides.has(resolve(path)) || ts.sys.fileExists(path);
  host.directoryExists = path => [...overrides.keys()].some(file => file.startsWith(resolve(path) + sep)) || ts.sys.directoryExists(path);
  host.getCurrentDirectory = () => web;
  host.getSourceFile = (path, version) => { const content = read(path); return content === undefined ? undefined : ts.createSourceFile(path, content, version); };
  const codeOverrides = [...overrides.keys()].filter(path => /\.(?:tsx?|mjs|js)$/.test(path));
  const program = ts.createProgram([...new Set([...parsed.fileNames, ...codeOverrides].map(path => resolve(path)))], { ...parsed.options, incremental: false, noEmit: true }, host);
  const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
  if (diagnostics.length) throw Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCurrentDirectory: () => web, getCanonicalFileName: path => path, getNewLine: () => '\n' }));
  return dependencies.report();
}
export function 预审迁移扩大整批(generate = false) {
  检查运行副本();
  const preview = 构建迁移扩大整批候选(), types = 检查扩大整批类型(preview);
  const patch = 生成审查差异(preview.delta);
  const prior = JSON.parse(own('上游适配/待审查/安全与批量迁移.json'));
  const manifests = ['上游适配/待审查/原画布图片闭环.json', '上游适配/待审查/内置网络代理基础.json'].map(path => JSON.parse(own(path)));
  const paths = [...new Set([
    ...prior.自有来源.map(item => item.文件), ...prior.工具来源.map(item => item.文件),
    ...manifests.flatMap(manifest => [...manifest.自有来源, ...manifest.工具来源].map(item => item.文件)),
    ...网络代理后端文件.map(name => '扩展功能/网络代理/' + name), ...网络代理前端文件.map(name => '扩展功能/网络代理/' + name),
    ...[...fallbackBackend, ...fallbackFrontend].map(name => '扩展功能/故障切换/' + name),
    '开发工具/预审代理与Fallback闭环.mjs', '开发工具/代理与Fallback闭环.test.mjs',
    '开发工具/公共.mjs', '开发工具/检查首批功能适配.mjs', '开发工具/检查运行副本.mjs',
    '开发工具/预审迁移扩大整批.mjs', '开发工具/迁移扩大整批.test.mjs', '开发工具/检查迁移扩大整批代码.mjs',
    ...['prompt-variable-highlight.js', 'prompt-theme-labels.js', 'media-download.ts'].map(name => '扩展功能/画布迁移扩展/' + name),
  ])].sort();
  const manifest = {
    日期: '2026-10-20', 状态: '扩大整批候选，待具体隔离接入批准；未装配或切换3100', 上游提交: 基线.提交,
    前置记录: '凭据网关任务-qD9PwY', 前置差异SHA256: preview.integration.差异SHA256,
    文件数: preview.delta.size, 差异SHA256: 哈希(patch), 完整虚拟类型检查通过: true, 类型检查依赖: types,
    组成: { 安全批量: preview.safetyFileCount, 代理Fallback图片任务: preview.combinedFileCount, 同前态合并: preview.merged },
    冻结输入: Object.keys(扩大输入指纹).concat(['原画布图片闭环.json', '原画布图片闭环.patch', '内置网络代理基础.json', '内置网络代理基础.patch']).map(name => ({ 文件: '上游适配/待审查/' + name, SHA256: 哈希(own('上游适配/待审查/' + name)) })),
    旧来源: 扩大旧来源, 继承旧来源: { 安全批量: prior.旧来源指纹, 代理: manifests[0].来源, 图片任务: manifests[1].原版图片来源, Fallback: fallbackOldSources },
    自有来源与工具: paths.map(文件 => ({ 文件, SHA256: 哈希(own(文件)) })),
    文件: [...preview.delta].map(([文件, item]) => ({ 文件, 原始SHA256: item.原文 === null ? null : 哈希(item.原文), 候选SHA256: 哈希(item.产物) })),
    新增覆盖: ['代理基础、四类Fallback设置和图片自动切换与安全批量候选整合', '普通图片及参考图生成、单槽重试接持久任务账本与保存ACK', '单条提示词创建配置、拖连创建及已有卡连线的类型/尺寸识别', '全局参考图工具和重复连线保护', 'Excel及最终提示词变量高亮、主题说明，编辑正文保持', '节点/批次图片及音视频下载优先持久Blob、去重缓存和真实MIME后缀'],
    未完成: ['真实Mihomo核心分发/运行、完整节点诊断及线路持久记忆', '历史页签、分类排序、历史ZIP、失败批次重试和稳定业务编号', '节点回收站、按产品素材隔离与ZIP合并导入', '原图/交付图双份保存、尺寸适配及完整详情', '视频未决远端任务保护、文本/视频/音频安全网关、翻译及AI校准'],
    边界: ['本批仅内存候选、自动专项和完整类型检查；未做磁盘隔离装配、浏览器或视觉验收', 'Fallback四类设置均保留；本轮自动切换仅接普通图片，其他类型不冒充已接线', '仅明确401/403/404/429自动切换；未知结果不自动重复收费；全链锁定网络租约', '代理核心仍用模拟核心验收，CONNECT/TLS为真实loopback测试；不使用真实订阅或收费渠道', '下载沿用旧兼容网络边界，未宣称所有媒体下载已由受限凭据网关代理', '保留现行稳定节点ID文件名；未迁业务分类命名GAP-26', '兼容凭据read和页内明文边界仍存在；自动媒体清理保持保守保留', '未迁应用全域停机门禁；局部批量锁/活动计数不能替代持久任务准入'],
    已隔离接入: false, 已切换3100: false, 已访问正式数据或真实凭据: false,
  };
  核验凭据网关任务完整包(preview.integration.组合包, true); 检查运行副本();
  if (generate) {
    const outputs = [['patch', patch], ['json', JSON.stringify(manifest, null, 2) + '\n']].map(([suffix, value]) => [join(根目录, '上游适配/待审查/迁移扩大整批.' + suffix), value]);
    if (outputs.some(([path]) => existsSync(path))) throw Error('拒绝覆盖整批审查原件');
    for (const [path, value] of outputs) writeFileSync(path, value, { flag: 'wx', mode: 0o600 });
  }
  return manifest;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.slice(2).some(value => value !== '--生成审查差异')) throw Error('只允许候选预审，不提供接入或服务操作');
  console.log(JSON.stringify(预审迁移扩大整批(process.argv.includes('--生成审查差异')), null, 2));
}
