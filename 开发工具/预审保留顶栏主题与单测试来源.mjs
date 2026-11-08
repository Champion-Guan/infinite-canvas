import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { 根目录, 上游目录 } from './公共.mjs';
import { 检查运行副本, 运行目录, 哈希 } from './检查运行副本.mjs';
import { 精确替换, 预审类型, 生成审查差异, ts } from './检查首批功能适配.mjs';
import { 生成局部关闭候选 } from './预审仅系统主题与来源局部关闭.mjs';
import { 状态, 上游提交, 前置恢复SHA256, 测试来源ID, 移除内置来源ID, 关闭内容, 保留内容 } from '../上游适配/保留顶栏主题与单测试来源.mjs';
import { 修订前态指纹 } from '../上游适配/顶栏单来源批准.mjs';

export function 生成顶栏单来源候选() {
  // 前一份只是候选，从相同已批准前态重建；不能先应用旧候选。
  const files = new Map(生成局部关闭候选());
  files.delete('web/src/guan/旧版首页顶栏.tsx');
  files.delete('web/src/guan/三态主题状态.ts');
  // 旧候选中的策略、UI关闭仍复用；本次保留主题store及顶栏原字节。
  // 清除AST移除节点后留下的空白行缩进，不调整其他作者格式。
  for (const [path, item] of files) files.set(path, { ...item, 产物: item.产物.replace(/^[\t ]+$/gm, '').replace(/\n+$/, '\n') });

  const changeAuthorFile = (path, transform) => {
    if (files.has(path)) throw Error('候选路径重复');
    const before = readFileSync(join(上游目录, path), 'utf8');
    if (修订前态指纹(运行目录, path) !== 哈希(before)) throw Error('作者未适配文件前态不符：' + path);
    const after = transform(before);
    if (after === before) throw Error('候选没有差异：' + path);
    files.set(path, { 原文: before, 产物: after });
  };
  changeAuthorFile('web/src/services/api/prompt-source-presets.ts', before => {
    const src = ts.createSourceFile('presets.ts', before, ts.ScriptTarget.Latest, true);
    let declarations = [];
    const visit = node => {
      if (ts.isVariableDeclaration(node) && node.name.getText(src) === 'DEFAULT_PROMPT_SOURCES') declarations.push(node);
      ts.forEachChild(node, visit);
    };
    visit(src);
    if (declarations.length !== 1 || !ts.isArrayLiteralExpression(declarations[0].initializer)) throw Error('来源预置数组锚点不唯一');
    const calls = declarations[0].initializer.elements;
    const ids = calls.map(node => ts.isCallExpression(node) && ts.isStringLiteral(node.arguments[0]) ? node.arguments[0].text : null);
    if (calls.length !== 7 || ids[0] !== 测试来源ID || JSON.stringify(ids.slice(1)) !== JSON.stringify(移除内置来源ID)) throw Error('7个原内置来源不符，停止候选生成');
    let after = before;
    for (const node of [...calls].slice(1).reverse()) {
      const start = before.lastIndexOf('\n', node.getStart(src) - 1) + 1;
      const end = before.indexOf('\n', node.end);
      if (end < 0 || !/^\s*,\s*$/.test(before.slice(node.end, end))) throw Error('来源行格式不符');
      after = after.slice(0, start) + after.slice(end + 1);
    }
    return 精确替换(after, [['\nfunction registrySource(', '\n// 恢复旧配置时只过滤已移除的内置来源；自定义来源和缓存不删除。\nexport function filterWorkbenchPromptSources(sources: PromptSource[]): PromptSource[] {\n    return sources.filter((source) => !source.builtIn || DEFAULT_PROMPT_SOURCES.some((item) => item.id === source.id));\n}\n\nfunction registrySource(']]);
  });
  changeAuthorFile('web/src/services/config-file.ts', before => 精确替换(before, [
    ['import type { PromptSource } from "@/services/api/prompt-source-presets";', 'import { filterWorkbenchPromptSources, type PromptSource } from "@/services/api/prompt-source-presets";'],
    ['    usePromptSourceStore.setState(data.promptSources);', '    usePromptSourceStore.setState({ ...data.promptSources, sources: filterWorkbenchPromptSources(data.promptSources.sources) });'],
  ]));
  if (files.size !== 10) throw Error('修订候选应为精确10文件');
  return files;
}

export function 预审顶栏单来源({ 完整类型 = false, 生成差异 = false } = {}) {
  const files = 生成顶栏单来源候选();
  for (const [fileName, item] of files) {
    const result = ts.transpileModule(item.产物, { fileName, reportDiagnostics: true, compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } });
    if (result.diagnostics?.length) throw Error('候选语法错误：' + fileName);
  }
  if (完整类型) 预审类型(files);
  const patch = 生成审查差异(files);
  const applied = 检查运行副本().顶栏单来源已应用;
  const check = spawnSync('git', ['-C', 运行目录, 'apply', ...(applied ? ['--reverse'] : []), '--check', '--whitespace=error', '-'], { input: patch, encoding: 'utf8' });
  if (check.status !== 0) throw Error('修订标准差异检查失败：' + check.stderr);
  const manifest = { 状态, 上游提交, 前置恢复SHA256, 替代未批准候选: '仅系统主题与来源局部关闭', 测试来源ID, 移除内置来源ID, 关闭内容, 保留内容, 已应用到运行副本: false, 语法预审通过: true, 完整类型预审通过: 完整类型, 标准差异检查通过: true, 差异SHA256: 哈希(patch), 文件: [...files].map(([文件, item]) => ({ 文件, 原始SHA256: 哈希(item.原文), 候选SHA256: 哈希(item.产物) })) };
  if (生成差异) {
    if (!完整类型) throw Error('须先通过完整类型预审才能保存审查快照');
    const dir = join(根目录, '上游适配/待审查'); mkdirSync(dir, { recursive: true });
    for (const [name, content] of [['保留顶栏主题与单测试来源.patch', patch], ['保留顶栏主题与单测试来源.json', JSON.stringify(manifest, null, 2) + '\n']]) {
      const path = join(dir, name);
      if (existsSync(path) && readFileSync(path, 'utf8') !== content) throw Error('不覆盖不同审查快照');
      if (!existsSync(path)) writeFileSync(path, content);
    }
  }
  检查运行副本(); console.log(JSON.stringify(manifest, null, 2)); return manifest;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.slice(2).some(arg => !['--完整类型预审', '--生成审查差异'].includes(arg))) throw Error('仅供预审，不允许接入运行副本');
  预审顶栏单来源({ 完整类型: process.argv.includes('--完整类型预审'), 生成差异: process.argv.includes('--生成审查差异') });
}
