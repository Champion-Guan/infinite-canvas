import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { 根目录 } from './公共.mjs';
import { 哈希 } from './检查运行副本.mjs';
import { 精确替换, 生成审查差异 } from './检查首批功能适配.mjs';
import { 媒体策略批准产物 } from './接入SQLite临时媒体隔离启动器.mjs';
import { 授权入口批准产物 } from './接入SQLite工作台授权隔离副本.mjs';
import { 媒体策略差异SHA256, 媒体启动器路径, 媒体启动器依赖 } from '../上游适配/SQLite临时媒体策略批准.mjs';
import { 授权入口差异SHA256 } from '../上游适配/SQLite工作台授权入口批准.mjs';

// 只在文档导航响应中交付内部一次性材料。fetch、iframe、跨站导航不能领取。
export function 免填码启动器候选(source) {
  return 精确替换(source, [[
    "    res.writeHead(200, { 'Content-Type': value.type + (['text/', 'application/json'].some(type => value.type.startsWith(type)) ? '; charset=utf-8' : ''), 'Content-Length': value.bytes.length });\n    res.end(req.method === 'HEAD' ? undefined : value.bytes);",
    `    let bytes = value.bytes;
    if (value.type === 'text/html') {
      if (req.method !== 'GET' || req.headers['sec-fetch-mode'] !== 'navigate' || req.headers['sec-fetch-dest'] !== 'document') {
        res.writeHead(403); res.end('请直接打开本机工作台地址。'); return;
      }
      // 不新增匿名签发API、不放URL/Cookie或动态脚本；无存储缓存的HTML只交给顶层导航。
      try {
        const html = bytes.toString('utf8');
        requireValue(html.split('</head>').length === 2 && !html.includes('guan-local-bootstrap'), 'invalid_web_bundle', '静态包不兼容自动入口。');
        const ticket = gateway.issueTicket();
        bytes = Buffer.from(html.replace('</head>', '<meta name="guan-local-bootstrap" content="' + ticket.code + '"></head>'));
      } catch { res.writeHead(503); res.end('本机启动暂时不可用；数据未改动，请稍后重新打开。'); return; }
    }
    res.writeHead(200, { 'Content-Type': value.type + (['text/', 'application/json'].some(type => value.type.startsWith(type)) ? '; charset=utf-8' : ''), 'Content-Length': bytes.length });
    res.end(req.method === 'HEAD' ? undefined : bytes);`,
  ]]);
}
export function 构建免填码候选() {
  const launcher = 媒体策略批准产物().get(媒体启动器路径).产物;
  const { delta: entry } = 授权入口批准产物();
  const target = 'web/src/guan/sqlite/启动工作台.mjs';
  return new Map([
    [媒体启动器路径, { 原文: launcher, 产物: 免填码启动器候选(launcher) }],
    [target, { 原文: entry.get(target).产物, 产物: readFileSync(join(根目录, '扩展功能/本机存储/自动启动工作台.mjs'), 'utf8') }],
    ['web/src/guan/sqlite/工作台自动入口.mjs', { 原文: null, 产物: readFileSync(join(根目录, '扩展功能/本机存储/工作台自动入口.mjs'), 'utf8') }],
  ]);
}
export async function 加载免填码预审启动器() {
  const source = 构建免填码候选().get(媒体启动器路径).产物.replace(/from '(\.[^']+)'/g,
    (_, path) => `from '${new URL(path, pathToFileURL(join(根目录, 媒体启动器路径))).href}'`);
  return import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
}
export function 预审SQLite免填码启动({ 生成差异 = false } = {}) {
  const delta = 构建免填码候选(), patch = 生成审查差异(delta);
  const manifest = { 日期: '2026-10-18', 状态: '自有模块已实现；3文件精确后继待审查，未接入原画布或3100', 差异SHA256: 哈希(patch),
    前置授权入口差异SHA256: 授权入口差异SHA256, 前置媒体策略差异SHA256: 媒体策略差异SHA256,
    文件: [...delta].map(([文件, item]) => ({ 文件, 原始SHA256: item.原文 === null ? null : 哈希(item.原文), 候选SHA256: 哈希(item.产物) })),
    保持约束: ['不修改原作者HTML/main/React布局；只替换自有启动模块并新增自有自动入口',
      '启动器仅顶层文档导航响应携带内部一次性材料；不是公开数据或匿名签发HTTP API',
      '不用手填码、不用Cookie/URL/localStorage/sessionStorage/IndexedDB保存能力；DOM材料使用后移除',
      'Host/Origin/跨站检查、会话/CSRF、首备份、媒体blob和外网阻止继续保留',
      '不覆盖任何已批准源码、历史JSON/patch或检查器，不接管3100，不读真实凭据或旧数据，不推送发布'],
    已知限制: ['每次文档导航内部签发新票据；旧页面租约仍按既有期限释放，暂未完成多次刷新/休眠的客户生命周期治理',
      '这些是隔离预审模块，原画布后继接入和日常3100切换分别需要审查和当前维护授权'],
    启动器依赖: 媒体启动器依赖(),
  };
  if (生成差异) for (const [name, content] of [['SQLite免填码启动.patch', patch], ['SQLite免填码启动.json', JSON.stringify(manifest, null, 2) + '\n']]) {
    const path = join(根目录, '上游适配/待审查', name);
    if (existsSync(path) && readFileSync(path, 'utf8') !== content) throw Error('不覆盖已有免填码启动审查产物');
    if (!existsSync(path)) writeFileSync(path, content);
  }
  return manifest;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.slice(2).some(arg => arg !== '--生成审查差异')) throw Error('只预审，不提供应用功能');
  console.log(JSON.stringify(预审SQLite免填码启动({ 生成差异: process.argv.includes('--生成审查差异') }), null, 2));
}
