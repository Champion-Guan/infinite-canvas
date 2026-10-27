import { existsSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { 根目录, 基线 } from './公共.mjs';
import { 哈希, 检查运行副本 } from './检查运行副本.mjs';
import { 精确替换, 生成审查差异 } from './检查首批功能适配.mjs';
import { 预审卡片布局类型 } from './预审卡片自动避让.mjs';
import { 读取Excel勾选隔离记录 } from './接入Excel勾选事件隔离副本.mjs';

export const 会话恢复前置记录 = join(根目录, '.运行/Excel勾选事件-25SJER/Excel勾选事件接入记录.json');
export const 会话恢复来源 = Object.freeze([
  ['扩展功能/本机服务/受控会话.mjs', '扩展功能/本机服务/可重连受控会话.mjs'],
  ['扩展功能/本机服务/本机授权网关.mjs', '扩展功能/本机服务/可重连授权网关.mjs'],
  ['web/src/guan/sqlite/本机授权客户端.mjs', '扩展功能/本机存储/可重连授权客户端.mjs'],
  ['web/src/guan/sqlite/续期数据客户端.mjs', '扩展功能/本机存储/可重连数据客户端.mjs'],
  ['web/src/guan/sqlite/工作台自动入口.mjs', '扩展功能/本机存储/可重连工作台入口.mjs'],
  ['web/src/guan/上游浏览器存储桥.ts', '扩展功能/本机存储/可重连存储桥.ts'],
  ['web/src/guan/保存状态条.tsx', '扩展功能/存储界面/可重连保存状态条.tsx'],
]);

// 只在内存派生，既不覆写历史来源，也不装配任何原画布副本。
export function 构建SQLite会话恢复候选() {
  const integration = 读取Excel勾选隔离记录(会话恢复前置记录), delta = new Map();
  for (const [path, source] of 会话恢复来源) {
    const file = join(根目录, source), stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw Error('会话恢复来源必须为独立普通文件');
    let 产物 = readFileSync(file, 'utf8');
    if (path.endsWith('/本机授权客户端.mjs')) 产物 = 精确替换(产物, [["from '../本机凭据/凭据客户端.mjs'", "from './凭据客户端.mjs'"]]);
    if (path.endsWith('/工作台自动入口.mjs')) 产物 = 精确替换(产物, [
      ["from './可重连授权客户端.mjs'", "from './本机授权客户端.mjs'"],
      ["from './可重连数据客户端.mjs'", "from './续期数据客户端.mjs'"],
    ]);
    const 原文 = readFileSync(join(integration.副本, path), 'utf8');
    if (原文 === 产物) throw Error('会话恢复候选缺少实际差异：' + path);
    delta.set(path, { 原文, 产物 });
  }
  return { integration, delta };
}
export function 预审SQLite会话恢复(generate = false) {
  检查运行副本();
  const preview = 构建SQLite会话恢复候选();
  预审卡片布局类型({ ...preview, delta: new Map([...preview.delta].filter(([path]) => path.startsWith('web/'))) });
  const patch = 生成审查差异(preview.delta);
  const manifest = { 日期: '2026-10-19', 状态: '待七文件精确差异批准，未接入任何工作台副本',
    上游提交: 基线.提交, 前置记录: 会话恢复前置记录, 前置差异SHA256: preview.integration.差异SHA256,
    差异SHA256: 哈希(patch), 文件数: preview.delta.size, 完整虚拟类型检查通过: true,
    文件: [...preview.delta].map(([文件, item]) => ({ 文件, 原始SHA256: 哈希(item.原文), 候选SHA256: 哈希(item.产物) })),
    自有来源: 会话恢复来源.map(([文件, 来源]) => ({ 文件, 来源, SHA256: 哈希(readFileSync(join(根目录, 来源))) })),
    已接入隔离副本: false, 已接入3100: false,
    约束: ['用户主动重新连接，普通业务请求和重试不自动复活过期会话',
      '沿用原页面能力，8小时绝对期限不延长，Host/Origin/CSRF和工作区验证不变',
      '恢复不重建应用、页面或队列；原operationId和revision继续校验，连接成功不等于保存成功',
      '响应丢失可明确重试；工作区变化、授权到期或服务重开保留队列并拒绝',
      '历史来源、批准文件、保护器、已装配包和作者仓库均不修改',
      '批准后以新独立保护器、原态事务和全新组合包进行实际浏览器/SQLite验收；本轮不接入或重启3100、不访问真实数据/Keychain、不提交发布'],
  };
  if (generate) {
    const files = [['patch', patch], ['json', JSON.stringify(manifest, null, 2) + '\n']].map(([ext, content]) => [join(根目录, '上游适配/待审查/SQLite会话恢复七文件.' + ext), content]);
    if (files.some(([file]) => existsSync(file))) throw Error('拒绝覆盖历史会话恢复审查');
    for (const [file, content] of files) writeFileSync(file, content, { flag: 'wx', mode: 0o600 });
  }
  return manifest;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.slice(2).some(arg => arg !== '--生成审查差异')) throw Error('只允许会话恢复预审，不允许接入、运行或重启');
  console.log(JSON.stringify(预审SQLite会话恢复(process.argv.includes('--生成审查差异')), null, 2));
}
