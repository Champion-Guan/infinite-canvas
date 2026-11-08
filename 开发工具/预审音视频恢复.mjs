import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { 根目录, 基线 } from './公共.mjs';
import { 检查运行副本, 运行目录, 哈希 } from './检查运行副本.mjs';
import { 精确替换, 预审类型, 生成审查差异, ts } from './检查首批功能适配.mjs';
import { 生成精简主题候选 } from './预审精简离线与三态主题.mjs';
import { 状态, 上游提交, 前置精简SHA256, 恢复编号, 保持关闭, 策略来源, 策略产物, 设置产物 } from '../上游适配/音视频恢复.mjs';
import { 合并恢复历史映射 } from '../上游适配/音视频提示词与节点信息恢复批准.mjs';

export function 生成音视频恢复候选() {
  const status = 检查运行副本();
  if (状态 !== '待单独批准' || 上游提交 !== 基线.提交 || !status.精简离线与三态主题已应用 || status.精简主题差异SHA256 !== 前置精简SHA256) throw Error('恢复前置不是精确批准的精简主题批次');
  const previous = 生成精简主题候选();
  const policy = readFileSync(join(根目录, 策略来源), 'utf8');
  // 设置面板回到锁定的上一批准实现，只保留本批之前已批准的三态主题接入。
  // 不从运行副本复制开发，不重新实现作者的音视频参数控件。
  const config = 精确替换(previous.get(设置产物).原文, [
    ['import { businessFeatures', 'import { ThemePreference } from "@/guan/三态主题设置";\nimport { businessFeatures'],
    ['                            <Form layout="vertical" requiredMark={false}>\n                                <div className="mb-2 text-sm font-semibold">{t("config.preferences.defaultModels")}', '                            <Form layout="vertical" requiredMark={false}>\n                                <ThemePreference />\n                                <div className="mb-2 text-sm font-semibold">{t("config.preferences.defaultModels")}'],
  ]);
  const files = new Map([[策略产物, { 原文: previous.get(策略产物).产物, 产物: policy }], [设置产物, { 原文: previous.get(设置产物).产物, 产物: config }]]);
  for (const [path, item] of files) {
    const successor = 合并恢复历史映射(运行目录).get(path);
    if ((successor ? successor.原始SHA256 !== 哈希(item.原文) : readFileSync(join(运行目录, path), 'utf8') !== item.原文) || item.产物 === item.原文) throw Error('当前产物与本批前置不符：' + path);
  }
  return files;
}

export function 预审音视频恢复({ 完整类型 = false, 生成差异 = false } = {}) {
  const files = 生成音视频恢复候选();
  for (const [fileName, item] of files) {
    const result = ts.transpileModule(item.产物, { fileName, reportDiagnostics: true, compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } });
    if (result.diagnostics?.length) throw Error('候选语法错误：' + fileName);
  }
  if (完整类型) 预审类型(files);
  const patch = 生成审查差异(files);
  const check = spawnSync('git', ['-C', 运行目录, 'apply', '--check', '-'], { input: patch, encoding: 'utf8' });
  if (check.status !== 0) throw Error('标准差异检查失败：' + check.stderr);
  const manifest = { 状态, 上游提交, 前置精简SHA256, 恢复编号, 保持关闭, 已应用到运行副本: false, 语法预审通过: true, 完整类型预审通过: 完整类型, 标准差异检查通过: true, 差异SHA256: 哈希(patch), 文件: [...files].map(([文件, item]) => ({ 文件, 原始SHA256: 哈希(item.原文), 候选SHA256: 哈希(item.产物) })) };
  if (生成差异) {
    if (!完整类型) throw Error('必须先通过完整类型预审');
    const directory = join(根目录, '上游适配/待审查'); mkdirSync(directory, { recursive: true });
    for (const [name, content] of [['音视频恢复.patch', patch], ['音视频恢复.json', JSON.stringify(manifest, null, 2) + '\n']]) {
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
  预审音视频恢复({ 完整类型: process.argv.includes('--完整类型预审'), 生成差异: process.argv.includes('--生成审查差异') });
}
