import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { 根目录, 基线 } from './公共.mjs';
import { 检查运行副本, 运行目录, 哈希 } from './检查运行副本.mjs';
import { 精确替换, 预审类型, 生成审查差异, ts } from './检查首批功能适配.mjs';
import { 生成用户候选 } from './检查用户功能适配.mjs';
import { 生成首页顶栏候选 } from './生成首页顶栏候选.mjs';
import { 生成脚本来源候选 } from './预审脚本与提示词来源.mjs';
import { 生成全局界面候选 } from './预审全局界面恢复.mjs';
import { 生成精简主题候选 } from './预审精简离线与三态主题.mjs';
import { 生成合并恢复候选 } from './预审音视频提示词与节点信息恢复.mjs';
import { 状态, 上游提交, 前置恢复SHA256, 关闭内容, 保留内容, 自有模块 } from '../上游适配/仅系统主题与来源局部关闭.mjs';
import { 修订前态指纹 } from '../上游适配/顶栏单来源批准.mjs';

function removeNodes(text, choose, expected) {
  const src = ts.createSourceFile('candidate.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const ranges = [];
  const visit = node => { if (choose(node, src)) ranges.push([node.getStart(src), node.end]); else ts.forEachChild(node, visit); };
  visit(src);
  if (ranges.length !== expected) throw Error('局部关闭语法锚点数量不符：' + ranges.length);
  for (const [start, end] of ranges.sort((a, b) => b[0] - a[0])) text = text.slice(0, start) + text.slice(end);
  return text;
}

export function 生成局部关闭候选() {
  const state = 检查运行副本();
  if (状态 !== '待单独批准' || 上游提交 !== 基线.提交 || !state.音视频提示词与节点信息恢复已应用 || state.合并恢复差异SHA256 !== 前置恢复SHA256) throw Error('局部关闭缺少精确10文件恢复前置');
  // 只从锁定上游和历史生成器重建权威内容，运行副本仅作前态校验。
  const previous = new Map([...生成用户候选(), ...生成首页顶栏候选(), ...生成脚本来源候选(), ...生成全局界面候选(), ...生成精简主题候选(), ...生成合并恢复候选()]);
  const files = new Map();
  const change = (path, transform) => {
    const before = previous.get(path)?.产物;
    if (!before || 修订前态指纹(运行目录, path) !== 哈希(before)) throw Error('局部关闭前态不符：' + path);
    const after = transform(before);
    if (after === before) throw Error('局部关闭没有差异：' + path);
    files.set(path, { 原文: before, 产物: after });
  };
  const replace = (path, pairs) => change(path, text => 精确替换(text, pairs));

  // 已有两处作者控件共享这个开关，连同画布外观里的手动选项一起关闭。
  replace('web/src/guan/功能开关.ts', [['    themeSwitch: true,', '    themeSwitch: false,']]);
  change('web/src/guan/旧版首页顶栏.tsx', text => {
    text = 精确替换(text, [
      ['import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";\n', ''],
      ['  const setTheme = useThemeStore((s) => s.setTheme);\n', ''],
    ]);
    return removeNodes(text, (node, src) => ts.isJsxElement(node) && node.openingElement.tagName.getText(src) === 'AnimatedThemeToggler', 1);
  });
  replace('web/src/components/layout/app-config-modal.tsx', [
    ['import { ThemePreference } from "@/guan/三态主题设置";\n', ''],
    ['                                <ThemePreference />\n', ''],
  ]);
  for (const [source, target] of 自有模块) change(target, () => readFileSync(join(根目录, source), 'utf8'));

  replace('web/src/guan/脚本与提示词来源.ts', [
    ['// 全局界面恢复批次：恢复R02/R03；S03仍关闭，不清空来源、间隔或缓存。', '// 局部关闭：保留已有来源和单源手动刷新，拒绝新增、自动刷新及全部拉取；不重置原配置。'],
    ['"modelScripts" | "promptSources" | "promptRefresh";', '"modelScripts" | "promptSources" | "promptRefresh" | "promptSourceCreate" | "promptRefreshAll";'],
    ['    promptRefresh: true,', '    promptRefresh: false,\n    promptSourceCreate: false,\n    promptRefreshAll: false,'],
    ['    promptRefresh: "提示词自动刷新与缓存更新",', '    promptRefresh: "提示词自动刷新",\n    promptSourceCreate: "新增提示词来源",\n    promptRefreshAll: "全部提示词来源拉取",'],
  ]);
  change('web/src/components/layout/config-prompt-sources.tsx', text => {
    text = 精确替换(text, [
      ['App, Button, Select, Switch, Tag', 'App, Button, Switch, Tag'],
      ['Eye, Pencil, Plus, RefreshCw, Trash2', 'Eye, Pencil, RefreshCw, Trash2'],
      ['fetchPromptSourceStatuses, refreshAllSources, refreshSource', 'fetchPromptSourceStatuses, refreshSource'],
      ['PROMPT_SOURCE_INTERVALS, usePromptSourceStore', 'usePromptSourceStore'],
      ['    const schedule = usePromptSourceStore((state) => state.schedule);\n', ''],
      ['    const addSource = usePromptSourceStore((state) => state.addSource);\n', ''],
      ['    const updateSchedule = usePromptSourceStore((state) => state.updateSchedule);\n', ''],
      ['    const [refreshingAll, setRefreshingAll] = useState(false);\n', ''],
      ['    const intervalOptions = PROMPT_SOURCE_INTERVALS.map((value) => ({ value, label: t(`config.promptSources.intervals.${intervalKey(value)}`) }));\n', ''],
    ]);
    text = removeNodes(text, (node, src) => ts.isVariableStatement(node) && node.declarationList.declarations.some(item => item.name.getText(src) === 'handleRefreshAll'), 1);
    text = removeNodes(text, (node, src) => ts.isJsxElement(node) && node.openingElement.tagName.getText(src) === 'div' && node.openingElement.attributes.getText(src) === 'className="mb-4 flex flex-wrap items-center justify-end gap-3"', 1);
    text = removeNodes(text, (node, src) => ts.isJsxElement(node) && node.openingElement.tagName.getText(src) === 'section' && node.getText(src).includes('config.promptSources.schedule'), 1);
    return removeNodes(text, node => ts.isFunctionDeclaration(node) && node.name?.text === 'intervalKey', 1);
  });
  replace('web/src/stores/use-prompt-source-store.ts', [
    ['        (set) => ({', '        (set, get) => ({'],
    ['addSource: () => { requireBusinessFeature("promptSources");', 'addSource: () => { requireBusinessFeature("promptSourceCreate");'],
    ['                requireBusinessFeature("promptSources");\n                return set((state)', '                requireBusinessFeature("promptSources");\n                if (!get().sources.some((item) => item.id === source.id)) requireBusinessFeature("promptSourceCreate");\n                return set((state)'],
  ]);
  replace('web/src/components/layout/client-root-init.tsx', [
    ['import { usePromptSourceScheduler } from "@/hooks/use-prompt-source-scheduler";\n', ''],
    ['    usePromptSourceScheduler();\n', ''],
  ]);
  replace('web/src/services/api/prompts.ts', [
    ['export async function refreshAllSources(): Promise<PromptSourceRefreshSummary> {\n    requireBusinessFeature("promptSources");', 'export async function refreshAllSources(): Promise<PromptSourceRefreshSummary> {\n    requireBusinessFeature("promptRefreshAll");'],
  ]);
  if (files.size !== 10) throw Error('局部关闭不是精确10份产物');
  return files;
}

export function 预审局部关闭({ 完整类型 = false, 生成差异 = false } = {}) {
  const files = 生成局部关闭候选();
  for (const [fileName, item] of files) {
    const result = ts.transpileModule(item.产物, { fileName, reportDiagnostics: true, compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } });
    if (result.diagnostics?.length) throw Error('局部关闭候选语法错误：' + fileName);
  }
  if (完整类型) 预审类型(files);
  const patch = 生成审查差异(files);
  const check = spawnSync('git', ['-C', 运行目录, 'apply', '--check', '-'], { input: patch, encoding: 'utf8' });
  if (check.status !== 0) throw Error('局部关闭标准差异检查失败：' + check.stderr);
  const manifest = { 状态, 上游提交, 前置恢复SHA256, 关闭内容, 保留内容, 已应用到运行副本: false, 语法预审通过: true, 完整类型预审通过: 完整类型, 标准差异检查通过: true, 差异SHA256: 哈希(patch), 文件: [...files].map(([文件, item]) => ({ 文件, 原始SHA256: 哈希(item.原文), 候选SHA256: 哈希(item.产物) })) };
  if (生成差异) {
    if (!完整类型) throw Error('须先通过完整类型预审才能保存审查快照');
    const dir = join(根目录, '上游适配/待审查'); mkdirSync(dir, { recursive: true });
    for (const [name, content] of [['仅系统主题与来源局部关闭.patch', patch], ['仅系统主题与来源局部关闭.json', JSON.stringify(manifest, null, 2) + '\n']]) {
      const path = join(dir, name);
      if (existsSync(path) && readFileSync(path, 'utf8') !== content) throw Error('不覆盖不同审查快照');
      if (!existsSync(path)) writeFileSync(path, content);
    }
  }
  检查运行副本(); console.log(JSON.stringify(manifest, null, 2)); return manifest;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.slice(2).some(arg => !['--完整类型预审', '--生成审查差异'].includes(arg))) throw Error('仅供预审，不允许接入运行副本');
  预审局部关闭({ 完整类型: process.argv.includes('--完整类型预审'), 生成差异: process.argv.includes('--生成审查差异') });
}
