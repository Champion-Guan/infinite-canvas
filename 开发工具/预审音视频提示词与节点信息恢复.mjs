import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { 根目录, 基线 } from './公共.mjs';
import { 检查运行副本, 运行目录, 哈希 } from './检查运行副本.mjs';
import { 精确替换, 预审类型, 生成审查差异, ts } from './检查首批功能适配.mjs';
import { 生成精简主题候选 } from './预审精简离线与三态主题.mjs';
import { 生成音视频恢复候选 } from './预审音视频恢复.mjs';
import { 策略产物 } from '../上游适配/音视频恢复.mjs';
import { 状态, 上游提交, 前置精简SHA256, 恢复编号, 保持关闭, 提示词恢复文件 } from '../上游适配/音视频提示词与节点信息恢复.mjs';
import { 修订前态指纹 } from '../上游适配/顶栏单来源批准.mjs';

function 删除唯一超分弹窗(text) {
  const src = ts.createSourceFile('project.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const nodes = [];
  const visit = node => {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(src) === 'Modal' && node.openingElement.attributes.getText(src).includes('superResolve')) nodes.push(node);
    else ts.forEachChild(node, visit);
  };
  visit(src);
  if (nodes.length !== 1) throw Error('超分占位弹窗锚点不唯一');
  return text.slice(0, nodes[0].getStart(src)) + text.slice(nodes[0].end);
}

export function 生成合并恢复候选() {
  const status = 检查运行副本();
  if (状态 !== '待单独批准' || 上游提交 !== 基线.提交 || !status.精简离线与三态主题已应用 || status.精简主题差异SHA256 !== 前置精简SHA256) throw Error('不是精确批准的恢复前置');
  const previous = 生成精简主题候选();
  const files = 生成音视频恢复候选();
  const policy = files.get(策略产物);
  policy.产物 = 精确替换(policy.产物, [
    ['// 待审查恢复批次：恢复画布音视频生成；不恢复其他关闭项或独立页面。', '// 待审查合并恢复批次：恢复画布音视频、节点信息、提示词管理及联网刷新。'],
    ['["S06", "C15", "AI超分占位"]', '["S06", "AI超分占位"]'],
    ['nodeInfo: false, superResolve: false, promptNetwork: false', 'nodeInfo: true, superResolve: false, promptNetwork: true'],
  ]);
  // 还原到全局恢复获批后、离线化之前的真实来源实现，不重新编写界面或下载器。
  for (const path of 提示词恢复文件) {
    const item = previous.get(path);
    if (!item?.原文) throw Error('缺少提示词恢复前置：' + path);
    files.set(path, { 原文: item.产物, 产物: item.原文 });
  }
  const toolbarPath = 'web/src/components/canvas/canvas-node-hover-toolbar.tsx';
  const toolbar = previous.get(toolbarPath);
  files.set(toolbarPath, { 原文: toolbar.产物, 产物: 精确替换(toolbar.原文, [
    ['    onSuperResolve: (node: CanvasNodeData) => void;\n', ''],
    ['    onSuperResolve,\n', ''],
    ['onUpscale, onSuperResolve, onAngle', 'onUpscale, onAngle'],
  ]) });
  const toolsPath = 'web/src/components/canvas/canvas-image-toolbar-tools.tsx';
  const tools = previous.get(toolsPath);
  files.set(toolsPath, { 原文: tools.产物, 产物: 精确替换(tools.产物, [
    ['= ["delete", "saveAsset", "download"];', '= ["info", "delete", "saveAsset", "download"];'],
  ]) });
  const projectPath = 'web/src/pages/canvas/project.tsx';
  const project = previous.get(projectPath);
  const text = 精确替换(project.原文, [
    ['    const [superResolveNodeId, setSuperResolveNodeId] = useState<string | null>(null);\n', ''],
    ['    const superResolveNode = superResolveNodeId ? nodeById.get(superResolveNodeId) || null : null;\n', ''],
    ['                    onSuperResolve={(node) => setSuperResolveNodeId(node.id)}\n', ''],
    ['async (nodeId: string, mode: CanvasNodeGenerationMode, prompt: string) => {\n', 'async (nodeId: string, mode: CanvasNodeGenerationMode, prompt: string) => {\n            if (!isGenerationModeEnabled(mode)) { message.info("不支持的生成模式。"); return; }\n'],
  ]);
  files.set(projectPath, { 原文: project.产物, 产物: 'import { isGenerationModeEnabled } from "@/guan/精简与离线策略";\n' + 删除唯一超分弹窗(text) });
  if (files.size !== 10) throw Error('本批不是精确10文件');
  for (const [path, item] of files) if (修订前态指纹(运行目录, path) !== 哈希(status.音视频提示词与节点信息恢复已应用 ? item.产物 : item.原文) || item.产物 === item.原文) throw Error('恢复前后态不符：' + path);
  return files;
}

export function 预审合并恢复({ 完整类型 = false, 生成差异 = false } = {}) {
  const files = 生成合并恢复候选();
  for (const [fileName, item] of files) {
    const result = ts.transpileModule(item.产物, { fileName, reportDiagnostics: true, compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } });
    if (result.diagnostics?.length) throw Error('候选语法错误：' + fileName);
  }
  if (完整类型) 预审类型(files);
  const patch = 生成审查差异(files);
  const applied = 检查运行副本().音视频提示词与节点信息恢复已应用;
  const check = spawnSync('git', ['-C', 运行目录, 'apply', ...(applied ? ['--reverse'] : []), '--check', '-'], { input: patch, encoding: 'utf8' });
  if (check.status !== 0) throw Error('标准差异检查失败：' + check.stderr);
  const manifest = { 状态, 上游提交, 前置精简SHA256, 恢复编号, 保持关闭, 已应用到运行副本: false, 语法预审通过: true, 完整类型预审通过: 完整类型, 标准差异检查通过: true, 差异SHA256: 哈希(patch), 文件: [...files].map(([文件, item]) => ({ 文件, 原始SHA256: 哈希(item.原文), 候选SHA256: 哈希(item.产物) })) };
  if (生成差异) {
    if (!完整类型) throw Error('必须先通过完整类型预审');
    const directory = join(根目录, '上游适配/待审查'); mkdirSync(directory, { recursive: true });
    for (const [name, content] of [['音视频提示词与节点信息恢复.patch', patch], ['音视频提示词与节点信息恢复.json', JSON.stringify(manifest, null, 2) + '\n']]) {
      const path = join(directory, name);
      if (existsSync(path) && readFileSync(path, 'utf8') !== content) throw Error('不覆盖不同审查快照');
      if (!existsSync(path)) writeFileSync(path, content);
    }
  }
  检查运行副本();
  console.log(JSON.stringify(manifest, null, 2));
  return manifest;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.slice(2).some(arg => !['--完整类型预审', '--生成审查差异'].includes(arg))) throw Error('仅供预审，不允许应用运行副本');
  预审合并恢复({ 完整类型: process.argv.includes('--完整类型预审'), 生成差异: process.argv.includes('--生成审查差异') });
}
