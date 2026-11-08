import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { 根目录, 基线 } from './公共.mjs';
import { 检查运行副本, 运行目录, 哈希 } from './检查运行副本.mjs';
import { 精确替换, 生成审查差异, ts } from './检查首批功能适配.mjs';
import { 生成用户候选 } from './检查用户功能适配.mjs';
import { 状态, 上游提交, 原始SHA256, 自有模块, 接入差异 } from '../上游适配/右上双入口关闭.mjs';

export function 生成双入口候选() {
  if (状态 !== '待单独批准' || 上游提交 !== 基线.提交) throw Error('候选状态或锁定上游不符。');
  const 保护 = 检查运行副本();
  if (!保护.用户功能关闭已应用 || !保护.首页顶栏已应用) throw Error('当前已批准基线不完整。');
  // 按原批准功能产物重建本批，不将后续运行文件当成新权威来源。
  const 原文 = 生成用户候选().get(接入差异.文件).产物;
  if (哈希(原文) !== 原始SHA256) throw Error('共享顶栏指纹不符，停止预审。');
  if (existsSync(join(运行目录, 自有模块.产物)) && !保护.右上双入口关闭已应用) throw Error('未知双入口模块已在运行副本中，停止预审。');
  return new Map([
    [接入差异.文件, { 原文, 产物: 精确替换(原文, 接入差异.替换) }],
    [自有模块.产物, { 原文: null, 产物: readFileSync(join(根目录, 自有模块.来源), 'utf8') }],
  ]);
}

export function 预审双入口({ 生成差异 = false } = {}) {
  const 候选 = 生成双入口候选();
  for (const [fileName, 项] of 候选) {
    const result = ts.transpileModule(项.产物, {
      fileName, reportDiagnostics: true,
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
    });
    if (result.diagnostics?.length) throw Error(`候选语法检查失败：${fileName}`);
  }
  const patch = 生成审查差异(候选);
  const result = spawnSync('git', ['-C', 运行目录, 'apply', '--check', '-'], { input: patch, encoding: 'utf8' });
  if (result.status !== 0) throw Error(`候选差异检查失败：${result.stderr}`);
  const 清单 = {
    状态, 上游提交, 已应用到运行副本: false,
    范围: ['共享顶栏配置按钮不渲染', '共享顶栏原作者GitHub链接不渲染'],
    语法预审通过: true, 标准差异检查通过: true,
    全量类型检查: '尚未运行', 浏览器验收: '待具体差异获批接入后进行',
    差异SHA256: 哈希(patch),
    文件: [...候选].map(([文件, 项]) => ({ 文件, 原始SHA256: 项.原文 === null ? null : 哈希(项.原文), 候选SHA256: 哈希(项.产物) })),
  };
  if (生成差异) {
    const 目录 = join(根目录, '上游适配/待审查');
    mkdirSync(目录, { recursive: true });
    for (const [名称, 内容] of [['右上双入口关闭.patch', patch], ['右上双入口关闭.json', JSON.stringify(清单, null, 2) + '\n']]) {
      const 目标 = join(目录, 名称);
      if (existsSync(目标) && readFileSync(目标, 'utf8') !== 内容) throw Error('拒绝覆盖不同的审查产物。');
      if (!existsSync(目标)) writeFileSync(目标, 内容);
    }
  }
  检查运行副本();
  console.log(JSON.stringify(清单, null, 2));
  return 清单;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const 参数 = process.argv.slice(2);
  if (参数.some(arg => arg !== '--生成审查差异')) throw Error('只允许预审，不能应用或修改运行副本。');
  预审双入口({ 生成差异: 参数.includes('--生成审查差异') });
}
