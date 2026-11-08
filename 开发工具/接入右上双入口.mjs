import { mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { 根目录 } from './公共.mjs';
import { 检查运行副本, 运行目录, 哈希 } from './检查运行副本.mjs';
import { 读取双入口批准, 双入口差异SHA256 } from '../上游适配/右上双入口批准.mjs';
import { 生成双入口候选 } from './预审右上双入口.mjs';
import { 生成审查差异, 预审类型 } from './检查首批功能适配.mjs';
import { 事务写入 } from './接入用户功能.mjs';

export function 双入口批准产物() {
  const manifest = 读取双入口批准();
  const files = 生成双入口候选();
  if (files.size !== 2 || 哈希(生成审查差异(files)) !== 双入口差异SHA256) throw Error('双入口产物偏离批准差异');
  for (const item of manifest.文件) {
    const value = files.get(item.文件);
    if (!value || (value.原文 === null ? null : 哈希(value.原文)) !== item.原始SHA256 || 哈希(value.产物) !== item.候选SHA256) throw Error('双入口权威来源指纹不符');
  }
  return files;
}

export function 接入双入口({ 应用 = false } = {}) {
  const state = 检查运行副本();
  const files = 双入口批准产物();
  console.log('正在完整类型预审；尚未写入运行副本。');
  预审类型(files);
  if (state.右上双入口关闭已应用) return console.log('双入口已接入同一批准差异，不重复写入。');
  if (!应用) return console.log('双入口完整类型预审通过，未写入副本。');
  检查运行副本();
  const ordered = new Map([...files].sort(([a], [b]) => Number(a.endsWith('/user-status-actions.tsx')) - Number(b.endsWith('/user-status-actions.tsx'))));
  const snapshot = mkdtempSync(join(根目录, '.运行/双入口接入-'));
  事务写入(运行目录, ordered, snapshot, { 差异指纹: 双入口差异SHA256, 写后检查: () => {
    if (!检查运行副本().右上双入口关闭已应用) throw Error('双入口写后校验失败');
  } });
  console.log(JSON.stringify({ applied: true, snapshot }));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.slice(2).some(arg => arg !== '--应用已批准差异')) throw Error('仅允许预审或精确接入本批批准差异');
  接入双入口({ 应用: process.argv.includes('--应用已批准差异') });
}
