import { existsSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { 根目录, 基线, 检查 } from './公共.mjs';
import { 哈希 } from './检查运行副本.mjs';
import { 精确替换, 生成审查差异 } from './检查首批功能适配.mjs';
import { 预审卡片布局类型 } from './预审卡片自动避让.mjs';
import { 读取凭据网关任务隔离记录 } from './接入凭据网关任务隔离副本.mjs';
import { 构建原版图片协议, 图片来源指纹 } from './构建原版图片协议.mjs';

export const 图片闭环前置 = join(根目录, '.运行/凭据网关任务-qD9PwY/凭据网关任务接入记录.json');
export const 图片闭环自有来源 = ['扩展功能/画布生成/图片任务衔接.mjs', '扩展功能/画布生成/原画布图片调用.ts', '扩展功能/画布生成/画布检查点.mjs'];
function own(path) {
  const file = join(根目录, path), stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw Error('图片闭环来源不是独立文件');
  return readFileSync(file, 'utf8');
}
function section(source, start, end) {
  const first = source.indexOf(start), last = source.indexOf(end, first + start.length);
  if (first < 0 || last <= first || source.indexOf(start, first + start.length) >= 0) throw Error('图片调用片段不唯一');
  return source.slice(first, last);
}
export function 构建原画布图片闭环候选() {
  const integration = 读取凭据网关任务隔离记录(图片闭环前置), delta = new Map();
  function add(path, 产物) {
    if (existsSync(join(integration.组合包, path))) throw Error('图片闭环新增路径已存在');
    delta.set(path, { 原文: null, 产物 });
  }
  function change(path, pairs) {
    const 原文 = readFileSync(join(integration.组合包, path), 'utf8');
    delta.set(path, { 原文, 产物: 精确替换(原文, pairs) });
  }
  add('画布副本/web/src/guan/generation/原版图片协议.ts', 构建原版图片协议());
  add('画布副本/web/src/guan/generation/图片任务衔接.mjs', own(图片闭环自有来源[0])
    .replace("'../本机存储/协议.mjs'", "'../sqlite/协议.mjs'").replace("'../生成网关/生成协议.mjs'", "'./生成协议.mjs'"));
  add('画布副本/web/src/guan/generation/原画布图片调用.ts', own(图片闭环自有来源[1]));
  add('画布副本/扩展功能/画布生成/画布检查点.mjs', own(图片闭环自有来源[2]));
  change('画布副本/扩展功能/生成网关/生成HTTP入口.mjs', [
    ['origin, authorize, gateway, tasks, maxRequests', 'origin, authorize, gateway, tasks, readCanvasCheckpoint, maxRequests'],
    ["      else if (exactKeys(value, ['operation', 'task']) && value.operation === 'submit')", "      else if (exactKeys(value, ['operation', 'id']) && value.operation === 'checkpoint' && jobLike(value.id) && typeof readCanvasCheckpoint === 'function') result = await readCanvasCheckpoint(value.id);\n      else if (exactKeys(value, ['operation', 'task']) && value.operation === 'submit')"],
  ]);
  change('画布副本/扩展功能/生成网关/生成服务装配.mjs', [
    ["import { requireValue }", "import { createCanvasCheckpointReader } from '../画布生成/画布检查点.mjs';\nimport { requireValue }"],
    ['origin, gateway, tasks, authorize });', 'origin, gateway, tasks, authorize, readCanvasCheckpoint: createCanvasCheckpointReader({ workspace, tasks }) });'],
  ]);
  change('画布副本/web/src/guan/generation/生成任务客户端.mjs', [
    ["    get: id => call({ operation: 'get', id }),", "    checkpoint: id => call({ operation: 'checkpoint', id }),\n    get: id => call({ operation: 'get', id }),"],
  ]);
  change('画布副本/web/src/guan/产品操作.ts', [
    ['const saves = new ProductSaveRegistry();', 'const saves = new ProductSaveRegistry();\n// 结果保存复用原产品真实layout-effect提交票据，不根据当前激活路由选择画布。\nexport async function saveProductCanvas(id: string) {\n  if (!useCanvasStore.getState().openProject(id)) throw new Error("原产品不存在，结果仍保留在任务账本。");\n  await saves.flush(id);\n  await flushSQLiteStorage();\n}'],
  ]);
  change('画布副本/web/src/types/canvas.ts', [
    ['export type CanvasNodeMetadata = {', 'export type CanvasNodeMetadata = {\n    gatewayGenerationTasks?: Array<{ taskId: string; slotId: string; binding: string; requestHash: string }>;\n    gatewayGenerationReceipts?: Array<{ taskId: string; responseHash: string }>;'],
  ]);
  const path = '画布副本/web/src/pages/canvas/project.tsx', source = readFileSync(join(integration.组合包, path), 'utf8');
  const main = section(source, '                                const image = referenceImages.length', '                                return true;');
  let mainApply = main.slice(main.indexOf('                                const uploaded ='));
  mainApply = mainApply.replace('if (node.metadata?.primaryImageId) return { ...node, metadata: { ...node.metadata, images } };',
    'if (node.metadata?.primaryImageId) return { ...node, metadata: { ...node.metadata, images, status: NODE_STATUS_SUCCESS, gatewayGenerationReceipts: [...(node.metadata?.gatewayGenerationReceipts || []).filter(item => item.taskId !== receipt.taskId), receipt] } };');
  mainApply = mainApply.replace('                                                ...node.metadata,\n                                                content: item.content,',
    '                                                ...node.metadata,\n                                                status: NODE_STATUS_SUCCESS,\n                                                gatewayGenerationReceipts: [...(node.metadata?.gatewayGenerationReceipts || []).filter(item => item.taskId !== receipt.taskId), receipt],\n                                                content: item.content,');
  const mainReplacement = `                                await requestCanvasImage({
                                    config: generationConfig, prompt: effectivePrompt, references: referenceImages,
                                    scope: { productId: projectId, nodeId: rootId, slotId: imageId }, signal: controller.signal,
                                    recordTask: task => recordImageGatewayTask(rootId, task),
                                    applyAndSave: async (image, receipt) => {
${mainApply}                                        await saveProductCanvas(projectId);
                                    },
                                });
`;
  const retry = section(source, '                const image = useReferenceImages\n', '            } catch (error) {\n                if (isGenerationCanceled(error)) return;\n                const errorDetails = error instanceof Error ? error.message : t("canvas.projectPage.generationFailed");');
  let retryApply = retry.slice(retry.indexOf('                const uploadedImage ='));
  retryApply = retryApply.replace('id: imageId || node.metadata?.primaryImageId || nanoid(),', 'id: gatewaySlotId,');
  retryApply = retryApply.replace('                                ...item.metadata,\n                                ...(makePrimary',
    '                                ...item.metadata,\n                                gatewayGenerationReceipts: [...(item.metadata?.gatewayGenerationReceipts || []).filter(entry => entry.taskId !== receipt.taskId), receipt],\n                                ...(makePrimary');
  const retryReplacement = `                const gatewaySlotId = imageId || node.metadata?.primaryImageId || node.metadata?.images?.[0]?.id || node.id;
                await requestCanvasImage({
                    config: generationConfig, prompt, references: useReferenceImages ? retryImages : [],
                    scope: { productId: projectId, nodeId: node.id, slotId: gatewaySlotId },
                    previous: node.metadata?.gatewayGenerationTasks?.find(item => item.slotId === gatewaySlotId),
                    retry: true, signal: controller.signal,
                    recordTask: task => recordImageGatewayTask(node.id, task),
                    applyAndSave: async (image, receipt) => {
${retryApply}                        await saveProductCanvas(projectId);
                    },
                });
`;
  change(path, [
    ['import { useProductCanvasSave, useProductNavigation }', 'import { requestCanvasImage, type CanvasImageTask } from "@/guan/generation/原画布图片调用";\nimport { saveProductCanvas, useProductCanvasSave, useProductNavigation }'],
    ['    useEffect(() => {\n        if (!dialogNodeId)', `    const recordImageGatewayTask = useCallback(async (id: string, task: CanvasImageTask) => {
        if (!nodesRef.current.some(node => node.id === id)) throw new Error("原结果卡片已删除，未发送生成请求。");
        setNodes(prev => prev.map(node => node.id !== id ? node : { ...node, metadata: {
            ...node.metadata, gatewayGenerationTasks: [...(node.metadata?.gatewayGenerationTasks || []).filter(item => item.slotId !== task.slotId), task],
        } }));
        await saveProductCanvas(projectId);
    }, [projectId, setNodes]);

    useEffect(() => {
        if (!dialogNodeId)`],
    [main, mainReplacement], [retry, retryReplacement],
    ['{ ...image, status: NODE_STATUS_ERROR, errorDetails } : image)) } } : node)));', '{ ...image, status: image.content ? NODE_STATUS_SUCCESS : NODE_STATUS_ERROR, errorDetails } : image)) } } : node)));'],
    ['image.id === imageId ? { ...image, status: NODE_STATUS_ERROR, errorDetails } : image)),', 'image.id === imageId ? { ...image, status: image.content ? NODE_STATUS_SUCCESS : NODE_STATUS_ERROR, errorDetails } : image)),'],
    ['[completeVideoNodeTask, effectiveConfig, finishGenerationRequest, isAiConfigReady, message, openConfigDialog, startGenerationRequest, t],', '[completeVideoNodeTask, effectiveConfig, finishGenerationRequest, isAiConfigReady, message, openConfigDialog, projectId, recordImageGatewayTask, startGenerationRequest, t],'],
    ['[completeVideoNodeTask, effectiveConfig, finishGenerationRequest, isAiConfigReady, message, openConfigDialog, pollVideoNodeTask, startGenerationRequest, t],', '[completeVideoNodeTask, effectiveConfig, finishGenerationRequest, isAiConfigReady, message, openConfigDialog, pollVideoNodeTask, projectId, recordImageGatewayTask, startGenerationRequest, t],'],
  ]);
  return { integration, delta };
}
export function 预审原画布图片闭环(generate = false) {
  检查();
  const preview = 构建原画布图片闭环候选();
  预审卡片布局类型({ integration: preview.integration, delta: new Map([...preview.delta].filter(([path]) => path.startsWith('画布副本/')).map(([path, value]) => [path.slice('画布副本/'.length), value])) });
  const patch = 生成审查差异(preview.delta);
  const manifest = { 日期: '2026-10-20', 状态: '待具体批准；未装配候选、未启动浏览器、未接管3100', 上游提交: 基线.提交,
    前置记录: 图片闭环前置, 前置差异SHA256: preview.integration.差异SHA256, 文件数: preview.delta.size, 差异SHA256: 哈希(patch),
    完整虚拟类型检查通过: true, 原版图片来源: 图片来源指纹,
    自有来源: 图片闭环自有来源.map(文件 => ({ 文件, SHA256: 哈希(own(文件)) })),
    工具来源: ['开发工具/构建原版图片协议.mjs', '开发工具/预审原画布图片闭环.mjs', '开发工具/原画布图片闭环.test.mjs'].map(文件 => ({ 文件, SHA256: 哈希(own(文件)) })),
    原画布接入范围: ['常规图片生成', '图片及批量图片重试；已成功未保存任务复用原响应'],
    尚未接入: ['蒙版与角度生成', '插件生成（保持关闭）', '文字、视频、音频网关', '远程图片URL受限下载', '渠道编辑器及模型查询', '旧兼容配置禁止密钥回读'],
    已接管3100: false, 已访问真实数据或凭据: false,
    文件: [...preview.delta].map(([文件, item]) => ({ 文件, 原始SHA256: item.原文 === null ? null : 哈希(item.原文), 候选SHA256: 哈希(item.产物) })) };
  if (generate) for (const [suffix, value] of [['patch', patch], ['json', JSON.stringify(manifest, null, 2) + '\n']]) {
    const path = join(根目录, '上游适配/待审查/原画布图片闭环.' + suffix);
    if (existsSync(path)) throw Error('拒绝覆盖图片闭环审查原件');
    writeFileSync(path, value, { flag: 'wx', mode: 0o600 });
  }
  return manifest;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.slice(2).some(arg => arg !== '--生成审查差异')) throw Error('本工具只生成候选与审查差异');
  console.log(JSON.stringify(预审原画布图片闭环(process.argv.includes('--生成审查差异')), null, 2));
}
