import { mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { 根目录 } from './公共.mjs';
import { 检查运行副本, 运行目录, 哈希 } from './检查运行副本.mjs';
import { 生成首页候选 } from './预审首页替换.mjs';
import { 预审类型, 生成审查差异 } from './检查首批功能适配.mjs';
import { 事务写入 } from './接入用户功能.mjs';
import { 读取首页批准, 首页差异SHA256 } from '../上游适配/首页接入批准.mjs';

export function 接入首页() {
  const 状态 = 检查运行副本();
  if (状态.首页替换已应用) { console.log('同一首页批次已接入，无需重复写入。'); return; }
  if (!状态.用户功能关闭已应用) throw Error('功能关闭前置未完成。');
  const 清单 = 读取首页批准();
  const { 全量, 增量, 资源 } = 生成首页候选();
  if (哈希(生成审查差异(增量)) !== 首页差异SHA256) throw Error('首页源码偏离已批准差异。');
  // 图片及新模块先就位，唯一已挂载入口最后原子替换；不用重启3100服务。
  const 文件 = new Map([...资源, ...[...增量].filter(([name]) => !name.endsWith('/画布入口.tsx')), ...[...增量].filter(([name]) => name.endsWith('/画布入口.tsx'))]);
  if (文件.size !== 33) throw Error('首页产物数不符。');
  for (const item of [...清单.文件, ...清单.资源]) {
    if (哈希(文件.get(item.文件)?.产物 ?? '') !== item.候选SHA256) throw Error('首页产物指纹不符。');
  }
  预审类型(全量);
  检查运行副本();
  const 事务目录 = mkdtempSync(join(根目录, '.运行/首页接入-'));
  const 日志 = 事务写入(运行目录, 文件, 事务目录, {
    差异指纹: 首页差异SHA256,
    写后检查: () => { if (!检查运行副本().首页替换已应用) throw Error('首页接入后保护失败。'); },
  });
  console.log(JSON.stringify({ 状态: 日志.状态, 事务目录, 文件数: 文件.size }));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.length !== 3 || process.argv[2] !== '--应用已批准差异') throw Error('需要显式应用已批准首页。');
  接入首页();
}
