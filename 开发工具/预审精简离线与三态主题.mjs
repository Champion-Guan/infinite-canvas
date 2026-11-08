import { readFileSync, existsSync, mkdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { 根目录, 上游目录, 基线 } from './公共.mjs';
import { 检查运行副本, 运行目录, 哈希 } from './检查运行副本.mjs';
import { 精确替换, 预审类型, 生成审查差异, ts } from './检查首批功能适配.mjs';
import { 生成用户候选 } from './检查用户功能适配.mjs';
import { 生成首页顶栏候选 } from './生成首页顶栏候选.mjs';
import { 生成脚本来源候选 } from './预审脚本与提示词来源.mjs';
import { 生成全局界面候选 } from './预审全局界面恢复.mjs';
import { 状态, 上游提交, 前置全局恢复SHA256, 关闭编号, 离线调整, 自有模块 } from '../上游适配/精简离线与三态主题.mjs';
import { 合并恢复历史映射 } from '../上游适配/音视频提示词与节点信息恢复批准.mjs';
import { 读取精简主题批准, 精简主题历史映射 } from '../上游适配/精简离线与三态主题批准.mjs';
import { 修订前态指纹 } from '../上游适配/顶栏单来源批准.mjs';
import { 脚本来源后继SHA256 } from '../上游适配/首页批次后继.mjs';

const policy = 'import { isGenerationModeEnabled, requireGenerationMode, requireAuxiliaryFeature, offlinePrompt } from "@/guan/精简与离线策略";\n';
const use = (...names) => policy.replace('isGenerationModeEnabled, requireGenerationMode, requireAuxiliaryFeature, offlinePrompt', names.join(', '));

let 历史批次产物缓存;
let 历史批次原文缓存;
function 读取补丁前态(patch, file) {
  const marker = `--- a/${file}\n+++ b/${file}\n`;
  const start = patch.indexOf(marker);
  if (start < 0) return null;
  const end = patch.indexOf('\n--- ', start + marker.length);
  const section = patch.slice(start + marker.length, end < 0 ? patch.length : end);
  const lines = section.split('\n');
  const body = [];
  for (const line of lines) {
    if (line.startsWith('@@')) continue;
    if (line.startsWith(' ') || line.startsWith('-')) body.push(line.slice(1));
  }
  return body.length ? body.join('\n') + '\n' : null;
}
function 读取历史批次产物(seed = new Map()) {
  if (历史批次产物缓存) return 历史批次产物缓存;
  const patch = readFileSync(join(根目录, '上游适配/待审查/精简离线与三态主题.patch'), 'utf8');
  // Use the original approved manifest here.  The successor-aware map is
  // only for validating the current runtime; it would select the later
  // merged bytes and change the already-approved patch fingerprint.
  const historical = new Map(读取精简主题批准().文件.map(item => [item.文件, item]));
  const discovered = new Map();
  const beforeDiscovered = new Map();
  const inventory = spawnSync('find', [join(根目录, '.运行'), '-type', 'f'], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  // `find` may return a non-zero status while a transient file disappears;
  // its stdout is still a valid source of historical candidates.  Trust the
  // paths that were actually emitted instead of falling back to patch replay
  // merely because the directory changed during the scan.
  if (inventory.stdout) for (const file of inventory.stdout.split('\n').filter(Boolean)) {
    const relative = file.slice(file.lastIndexOf('/web/src/') + 1);
    const metadata = historical.get(relative);
    const expected = metadata?.候选SHA256;
    const original = metadata?.原始SHA256;
    if ((!expected || discovered.has(relative)) && (!original || beforeDiscovered.has(relative))) continue;
    try { const value = readFileSync(file, 'utf8'); if (哈希(value) === expected) discovered.set(relative, value); } catch { /* 临时文件可能在扫描时退出，继续查找其他副本。 */ }
    try { const value = readFileSync(file, 'utf8'); if (original && 哈希(value) === original) beforeDiscovered.set(relative, value); } catch { /* 同一文件可能在扫描时退出，继续查找其他副本。 */ }
  }
  if (discovered.size >= historical.size) { 历史批次产物缓存 = discovered; 历史批次原文缓存 = beforeDiscovered; return discovered; }
  const files = new Set([...patch.matchAll(/^\+\+\+ b\/(.+)$/gm)].map(match => match[1]));
  const newFiles = new Set([...patch.matchAll(/^--- \/dev\/null\n\+\+\+ b\/(.+)$/gm)].map(match => match[1]));
  const temporary = mkdtempSync(join(tmpdir(), 'guan-offline-approved-'));
  try {
    for (const file of files) {
      const target = join(temporary, file);
      mkdirSync(dirname(target), { recursive: true });
      const seeded = newFiles.has(file) ? undefined : seed.get(file)?.产物 ?? 读取补丁前态(patch, file);
      const source = join(上游目录, file);
      if (seeded !== undefined) writeFileSync(target, seeded);
      else if (existsSync(source)) writeFileSync(target, readFileSync(source));
    }
    const applied = spawnSync('git', ['apply', '-'], { cwd: temporary, input: patch, encoding: 'utf8' });
    if (applied.status !== 0) throw Error(`读取历史批准产物失败：${applied.stderr}`);
    历史批次产物缓存 = new Map([...files].map(file => [file, readFileSync(join(temporary, file), 'utf8')]));
    历史批次原文缓存 = new Map([...historical].filter(([, item]) => item.原始SHA256 !== null).map(([file, item]) => [file, 哈希(读取补丁前态(patch, file) || '') === item.原始SHA256 ? 读取补丁前态(patch, file) : null]).filter(([, value]) => value !== null));
    return 历史批次产物缓存;
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}

// 只对锁定的语法节点生成补丁；匹配数量不符即停止，拒绝宽泛正则删除。
function removeNodes(text, choose, expected) {
  const source = ts.createSourceFile('candidate.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const ranges = [];
  const visit = node => {
    if (choose(node, source)) ranges.push([node.getStart(source), node.end]);
    else ts.forEachChild(node, visit);
  };
  visit(source);
  if (ranges.length !== expected) throw Error(`语法节点数量不符：${ranges.length}，预期${expected}`);
  for (const [start, end] of ranges.sort((a, b) => b[0] - a[0])) text = text.slice(0, start) + text.slice(end);
  return text;
}

export function 生成精简主题候选() {
  const status = 检查运行副本();
  if (状态 !== '待单独批准' || 上游提交 !== 基线.提交 || !status.全局界面恢复已应用 || status.全局恢复差异SHA256 !== 前置全局恢复SHA256) throw Error('候选前置不是已批准全局恢复批次');
  // 权威来源是锁定上游与既有生成器，不将运行副本当作开发源码。
  const previous = new Map([...生成用户候选(), ...生成首页顶栏候选(), ...生成脚本来源候选(), ...生成全局界面候选()]);
  const files = new Map();
  const change = (path, transform) => {
    const before = previous.get(path)?.产物 ?? readFileSync(join(上游目录, path), 'utf8');
    const after = transform(before);
    if (!status.精简离线与三态主题已应用 && readFileSync(join(运行目录, path), 'utf8') !== before) throw Error('当前产物与批准前置不符：' + path);
    if (after === before) throw Error('候选没有变化：' + path);
    files.set(path, { 原文: before, 产物: after });
  };
  const replace = (path, pairs) => change(path, text => 精确替换(text, pairs));

  // S06：启动不读URL，显式导入入口也先拒绝，不影响普通渠道和配置文件导入。
  change('web/src/components/layout/client-root-init.tsx', () => `import type { ReactNode } from "react";
import { usePromptSourceScheduler } from "@/hooks/use-prompt-source-scheduler";
export function ClientRootInit({ children }: { children: ReactNode }) {
    usePromptSourceScheduler();
    return <>{children}</>;
}
`);
  replace('web/src/stores/use-config-store.ts', [
    ['import { requireBusinessFeature', use('requireAuxiliaryFeature') + 'import { requireBusinessFeature'],
    ['            importChannelCredentials: (input) => {\n', '            importChannelCredentials: (input) => {\n                requireAuxiliaryFeature("urlCredentials");\n'],
  ]);

  // C15：移除信息按钮与面板挂载，不再对节点做JSON序列化。
  change('web/src/components/canvas/canvas-node-hover-toolbar.tsx', text => {
    text = 精确替换(text, [
      ['useEffect, useMemo, useState', 'useEffect, useState'], ['App, Modal, Segmented, Tooltip', 'App, Tooltip'],
      ['Image as ImageIcon, Info, MessageSquare', 'Image as ImageIcon, MessageSquare'],
      ['import { canvasThemes } from "@/lib/canvas-theme";\n', ''],
      ['import { getNodeDefinition } from "@/lib/canvas/node-registry";\n', ''],
      ['import { formatBytes, getDataUrlByteSize } from "@/lib/image-utils";\n', ''],
      ['import { useThemeStore } from "@/stores/use-theme-store";\n', ''],
      ['    onInfo: (node: CanvasNodeData) => void;\n', ''], ['    onInfo,\n', ''],
      ['    onSuperResolve: (node: CanvasNodeData) => void;\n', ''], ['    onSuperResolve,\n', ''],
      ['onUpscale, onSuperResolve, onAngle', 'onUpscale, onAngle'],
      ['        { id: "info", title: t("canvas.nodeToolbar.infoTitle"), label: t("canvas.nodeToolbar.info"), icon: <Info className="size-4" />, onClick: () => onInfo(node) },\n', ''],
      ['const canRetry = node.metadata?.status === "error"', 'const canRetry = isGenerationModeEnabled(isVideo ? "video" : isAudio ? "audio" : node.metadata?.generationMode || "image") && node.metadata?.status === "error"'],
      ['...(isVideo ? [{ id: "edit"', '...(isVideo && isGenerationModeEnabled("video") ? [{ id: "edit"'],
    ]);
    text = removeNodes(text, node => ts.isFunctionDeclaration(node) && ['CanvasNodeInfoModal', 'InfoRow'].includes(node.name?.text), 2);
    return use('isGenerationModeEnabled') + text;
  });
  change('web/src/components/canvas/canvas-image-toolbar-tools.tsx', text => {
    text = 精确替换(text, [['Scissors, Sparkles, Upload', 'Scissors, Upload'], ['= ["info", "delete", "saveAsset", "download"];', '= ["delete", "saveAsset", "download"];'], ['    onSuperResolve: (node: CanvasNodeData) => void;\n', '']]);
    // 连同后随逗号删除唯一占位对象，旧工具配置不会被清空。
    const start = text.indexOf('    {\n        id: "superResolve",');
    const end = text.indexOf('    {\n        id: "angle",', start);
    if (start < 0 || end < start) throw Error('超分占位锚点不符');
    return text.slice(0, start) + text.slice(end);
  });

  // V03/A02：API执行边界。查询/轮询/结果存储函数保持原样。
  for (const [path, signature, mode] of [
    ['web/src/services/api/audio.ts', 'export async function requestAudioGeneration(config: AiConfig, prompt: string, options?: RequestOptions): Promise<Blob> {\n', 'audio'],
    ['web/src/services/api/video.ts', 'export async function createVideoGenerationTask(config: AiConfig, prompt: string, references: ReferenceImage[] = [], options?: VideoMediaOptions): Promise<VideoGenerationTask> {\n', 'video'],
  ]) replace(path, [['import axios', use('requireGenerationMode') + 'import axios'], [signature, signature + `    requireGenerationMode("${mode}");\n`]]);

  change('web/src/pages/canvas/project.tsx', text => {
    text = 精确替换(text, [
      ['import { CanvasNodeHoverToolbar, CanvasNodeInfoModal }', 'import { CanvasNodeHoverToolbar }'],
      ['                    onInfo={(node) => setInfoNodeId(node.id)}\n', ''],
      ['                <CanvasNodeInfoModal node={infoNode} open={Boolean(infoNode)} onClose={() => setInfoNodeId(null)} />\n', ''],
      ['    const [infoNodeId, setInfoNodeId] = useState<string | null>(null);\n', ''],
      ['    const [superResolveNodeId, setSuperResolveNodeId] = useState<string | null>(null);\n', ''],
      ['    const infoNode = infoNodeId ? nodeById.get(infoNodeId) || null : null;\n', ''],
      ['    const superResolveNode = superResolveNodeId ? nodeById.get(superResolveNodeId) || null : null;\n', ''],
      ['            setInfoNodeId((current) => (current && allIds.has(current) ? null : current));\n', ''],
      ['\n        setInfoNodeId(null);\n', '\n'],
      ['\n                setInfoNodeId(null);\n', '\n'],
      ['                    onSuperResolve={(node) => setSuperResolveNodeId(node.id)}\n', ''],
      ['async (nodeId: string, mode: CanvasNodeGenerationMode, prompt: string) => {\n', 'async (nodeId: string, mode: CanvasNodeGenerationMode, prompt: string) => {\n            if (!isGenerationModeEnabled(mode)) { message.info("视频和语音新生成已关闭；已有媒体与视频任务保留。"); return; }\n'],
    ]);
    text = removeNodes(text, (node, src) => ts.isJsxElement(node) && node.openingElement.tagName.getText(src) === 'Modal' && node.openingElement.attributes.getText(src).includes('superResolve'), 1);
    return use('isGenerationModeEnabled') + text;
  });

  replace('web/src/components/canvas/canvas-config-node-panel.tsx', [
    ['import type { CSSProperties }', use('isGenerationModeEnabled') + 'import type { CSSProperties }'],
    ['                        ]}\n', '                        ].filter((option) => isGenerationModeEnabled(option.value))}\n'],
    ['            <div className="mb-2 grid min-w-0 cursor-default grid-cols-[minmax(0,1fr)_148px]', '            {isGenerationModeEnabled(mode) ? <div className="mb-2 grid min-w-0 cursor-default grid-cols-[minmax(0,1fr)_148px]'],
    ['            </div>\n\n            <Button', '            </div> : <div role="status" className="mb-2 text-xs opacity-60">此卡片的视频/语音生成已关闭，原参数保留；可切换图片或文本。</div>}\n\n            <Button'],
    ['disabled={!isRunning && !canGenerate}', 'disabled={!isRunning && (!isGenerationModeEnabled(mode) || !canGenerate)}'],
  ]);
  replace('web/src/components/canvas/canvas-node-prompt-panel.tsx', [
    ['import { useEffect', use('isGenerationModeEnabled') + 'import { useEffect'],
    ['    const submit = () => {\n', '    const submit = () => {\n        if (!isGenerationModeEnabled(mode)) return;\n'],
    ['    return (\n        <div\n            data-canvas-no-zoom', '    if (!isGenerationModeEnabled(mode)) return <div role="status" className="rounded-xl border p-3 text-sm" style={{ background: theme.toolbar.panel, color: theme.node.text }}>视频和语音新生成及参数编辑已关闭；已有媒体、任务和原参数保留。{isRunning ? <Button onClick={() => onStop(node.id)}>停止当前任务</Button> : null}</div>;\n\n    return (\n        <div\n            data-canvas-no-zoom'],
  ]);

  change('web/src/components/layout/app-config-modal.tsx', text => {
    text = 精确替换(text, [
      ['import { videoResolutionOptions } from "@/components/video-settings-panel";\n', ''],
      ['import { audioFormatOptions, audioVoiceOptions, normalizeAudioSpeedValue } from "@/lib/audio-generation";\n', ''],
      ['mediaScaleOptions, parseVideoResolution', 'mediaScaleOptions'],
      ['{modelGroups.map((group)', '{modelGroups.filter((group) => isGenerationModeEnabled(group.capability)).map((group)'],
      ['                            <Form layout="vertical" requiredMark={false}>\n                                <div className="mb-2 text-sm font-semibold">{t("config.preferences.defaultModels")}', '                            <Form layout="vertical" requiredMark={false}>\n                                <ThemePreference />\n                                <div className="mb-2 text-sm font-semibold">{t("config.preferences.defaultModels")}'],
    ]);
    text = removeNodes(text, (node, src) => ts.isJsxElement(node) && node.openingElement.tagName.getText(src) === 'Form.Item' && /config\.preferences\.(videoResolution|audioVoice|audioFormat|audioSpeed|audioInstructions)"/.test(node.openingElement.attributes.getText(src)), 5);
    return use('isGenerationModeEnabled') + 'import { ThemePreference } from "@/guan/三态主题设置";\n' + text;
  });

  // 主题只替换store边界，原组件继续消费解析后的light/dark；旧手选偏好保留。
  change('web/src/stores/use-theme-store.ts', () => 'export { useThemeStore, type ThemeName, type ThemeMode } from "@/guan/三态主题状态";\n');
  replace('web/src/components/layout/app-providers.tsx', [
    ['import type { ReactNode }', 'import { SystemThemeSync } from "@/guan/三态主题设置";\nimport type { ReactNode }'],
    ['        <ConfigProvider locale=', '        <ConfigProvider locale='],
    ['            <ProConfigProvider dark={dark}>', '            <SystemThemeSync />\n            <ProConfigProvider dark={dark}>'],
  ].filter(([a, b]) => a !== b));

  // R02保留离线查看。R03禁止所有联网刷新，包括低层运行器直调。
  const currentPromptSource = previous.get('web/src/guan/脚本与提示词来源.ts')?.产物;
  if (currentPromptSource && 哈希(currentPromptSource) === 脚本来源后继SHA256) {
    // 当前维护源码已经包含离线后继，保留完整后态并跳过重复替换。
    files.set('web/src/guan/脚本与提示词来源.ts', { 原文: currentPromptSource, 产物: currentPromptSource });
  } else {
    replace('web/src/guan/脚本与提示词来源.ts', [
      ['// 全局界面恢复批次：恢复R02/R03；S03仍关闭，不清空来源、间隔或缓存。', '// 离线批次：R02仅保留本地查看，R03停止联网刷新；S03仍关闭，不清空来源、间隔或缓存。'],
      ['    promptRefresh: true,', '    promptRefresh: false,'],
    ]);
  }
  change('web/src/components/layout/config-prompt-sources.tsx', () => 'export { LocalPromptSources as ConfigPromptSources } from "@/guan/离线提示词来源";\n');
  replace('web/src/services/api/prompts.ts', [
    ['import { businessFeatures', use('requireAuxiliaryFeature', 'offlinePrompt') + 'import { businessFeatures'],
  ].filter(([a, b]) => a !== b));
  // 上面文件后续变换在内存叠加，不写运行副本。
  const prompts = files.get('web/src/services/api/prompts.ts');
  if (prompts.产物.split('    requireBusinessFeature("promptSources");').length !== 4) throw Error('来源联网门禁数量不符');
  prompts.产物 = prompts.产物.replaceAll('    requireBusinessFeature("promptSources");', '    requireAuxiliaryFeature("promptNetwork");');
  prompts.产物 = 精确替换(prompts.产物, [
    ['    return items.map((item) => ({', '    return items.map((item) => offlinePrompt({'],
    ['        githubUrl: item.sourceUrl || source.homepage,\n    }));', '        githubUrl: item.sourceUrl || source.homepage,\n    }));'],
  ]);
  replace('web/src/services/api/prompt-source-runtime.ts', [
    ['import { requireBusinessFeature } from "@/guan/脚本与提示词来源";', use('requireAuxiliaryFeature').trim()],
    ['    requireBusinessFeature("promptSources");', '    requireAuxiliaryFeature("promptNetwork");'],
  ]);
  replace('web/src/components/layout/prompt-source-content-modal.tsx', [
    ['onClick={() => void load(true)}', 'onClick={() => void load(false)}'],
    ['{t("config.promptSources.content.refresh")}', '重新读取本地缓存'],
  ]);
  for (const [source, output] of 自有模块) {
    const sourceContent = readFileSync(join(根目录, source), 'utf8');
    const currentPath = join(运行目录, output);
    const currentContent = existsSync(currentPath) ? readFileSync(currentPath, 'utf8') : null;
    const historical = status.精简离线与三态主题已应用 ? 精简主题历史映射(运行目录).get(output) : null;
    // 历史批次已完整接入后，候选继续重放批准过的字节；根目录后续演进由新的小补丁接入。
    const content = sourceContent;
    const successor = 合并恢复历史映射(运行目录).get(output);
    const currentHash = currentContent === null ? null : 修订前态指纹(运行目录, output);
    // 当前运行副本已经与维护源码完全一致时，允许把它视为同一完整后继。
    // 这覆盖了历史批准映射之前的后继来源，同时继续拒绝任何未知改动。
    const matchesMaintainedSource = currentHash === 哈希(content);
    if (existsSync(join(运行目录, output)) && !status.精简离线与三态主题已应用 && (!matchesMaintainedSource && (successor ? successor.原始SHA256 !== 哈希(content) : currentHash !== 哈希(content)))) throw Error('自有产物已存在或不符，拒绝覆盖：' + output);
    files.set(output, { 原文: null, 产物: content });
  }
  if (status.精简离线与三态主题已应用) {
    const historical = new Map(读取精简主题批准().文件.map(item => [item.文件, item]));
    const approved = 读取历史批次产物(previous);
    // 运行副本可能已经接入后续小补丁；历史预审仍严格重放原批准21文件字节。
    for (const [path, item] of files) {
      const expected = historical.get(path)?.候选SHA256;
      const value = approved.get(path);
      const before = 历史批次原文缓存?.get(path);
      if (expected && value && 哈希(value) === expected) files.set(path, { ...item, 原文: before ?? item.原文, 产物: value });
    }
  }
  // prompts等文件有多步内存变换，只能在全部变换结束后比较最终后态。
  if (status.精简离线与三态主题已应用) for (const [path, item] of files) {
    const successor = 合并恢复历史映射(运行目录).get(path);
    const historical = 精简主题历史映射(运行目录).get(path);
    // The generated candidate intentionally replays this batch's original
    // post-state.  A later successor may be installed in the runtime, so its
    // pre-state is the expected byte string for this historical check.
    const expected = successor?.原始SHA256 ?? historical?.候选SHA256 ?? 修订前态指纹(运行目录, path);
    if (expected !== 哈希(item.产物)) throw Error('当前产物与批准后态不符：' + path);
  }
  return files;
}

export function 预审精简主题({ 完整类型 = false, 生成差异 = false } = {}) {
  const files = 生成精简主题候选();
  for (const [fileName, item] of files) {
    const out = ts.transpileModule(item.产物, { fileName, reportDiagnostics: true, compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } });
    if (out.diagnostics?.length) throw Error('候选语法错误：' + fileName);
  }
  if (完整类型) 预审类型(files);
  const patch = 生成审查差异(files);
  const applied = 检查运行副本().精简离线与三态主题已应用;
  const check = spawnSync('git', ['-C', 运行目录, 'apply', ...(applied ? ['--reverse'] : []), '--check', '-'], { input: patch, encoding: 'utf8' });
  if (check.status !== 0) throw Error('标准差异预检查失败：' + check.stderr);
  const manifest = { 状态, 上游提交, 前置全局恢复SHA256, 关闭编号, 离线调整, 已应用到运行副本: false, 语法预审通过: true, 完整类型预审通过: 完整类型, 标准差异检查通过: true, 差异SHA256: 哈希(patch), 文件: [...files].map(([文件, item]) => ({ 文件, 原始SHA256: item.原文 === null ? null : 哈希(item.原文), 候选SHA256: 哈希(item.产物) })) };
  if (生成差异) {
    if (!完整类型) throw Error('必须先通过完整类型预审');
    const dir = join(根目录, '上游适配/待审查'); mkdirSync(dir, { recursive: true });
    for (const [name, content] of [['精简离线与三态主题.patch', patch], ['精简离线与三态主题.json', JSON.stringify(manifest, null, 2) + '\n']]) {
      const path = join(dir, name);
      if (existsSync(path) && readFileSync(path, 'utf8') !== content) throw Error('不覆盖不同审查快照');
      if (!existsSync(path)) writeFileSync(path, content);
    }
  }
  检查运行副本();
  console.log(JSON.stringify(manifest, null, 2));
  return manifest;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.slice(2).some(arg => !['--完整类型预审', '--生成审查差异'].includes(arg))) throw Error('仅供预审，无接入权限');
  预审精简主题({ 完整类型: process.argv.includes('--完整类型预审'), 生成差异: process.argv.includes('--生成审查差异') });
}
