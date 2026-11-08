import { mkdtempSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { 根目录 } from './公共.mjs';
import { 检查运行副本, 运行目录, 哈希 } from './检查运行副本.mjs';
import { 读取精简主题批准, 精简主题差异SHA256 } from '../上游适配/精简离线与三态主题批准.mjs';
import { 生成精简主题候选 } from './预审精简离线与三态主题.mjs';
import { 生成审查差异, 预审类型 } from './检查首批功能适配.mjs';
import { 事务写入 } from './接入用户功能.mjs';

export function 精简主题批准产物() {
  const manifest = 读取精简主题批准();
  const files = 生成精简主题候选();
  if (files.size !== 21 || 哈希(生成审查差异(files)) !== 精简主题差异SHA256) throw Error('精简主题权威产物偏离批准差异');
  for (const item of manifest.文件) {
    const value = files.get(item.文件);
    if (!value || (value.原文 === null ? null : 哈希(value.原文)) !== item.原始SHA256 || 哈希(value.产物) !== item.候选SHA256) throw Error('精简主题权威来源指纹不符');
  }
  return files;
}

export function 接入精简主题({ 应用 = false } = {}) {
  const state = 检查运行副本();
  const files = 精简主题批准产物();
  预审类型(files);
  if (state.精简离线与三态主题已应用) return console.log('已接入同一21文件精简主题差异，不重复写入。');
  if (!应用) return console.log('21文件完整类型预审通过，未写入副本。');
  检查运行副本();
  // 仅前端产物热更新；不停止/重启3100服务，不读写浏览器或旧版数据。
  // 先放置新增依赖，避免开发服务先看到指向不存在模块的import。
  const ordered = new Map([...files].sort(([, a], [, b]) => Number(a.原文 !== null) - Number(b.原文 !== null)));
  for (const [path, item] of ordered) if (item.原文 !== null && readFileSync(join(运行目录, path), 'utf8') !== item.原文) throw Error('写入前态发生变化：' + path);
  const snapshot = mkdtempSync(join(根目录, '.运行/精简主题接入-'));
  事务写入(运行目录, ordered, snapshot, { 差异指纹: 精简主题差异SHA256, 写后检查: () => {
    if (!检查运行副本().精简离线与三态主题已应用) throw Error('精简主题写后校验失败');
  } });
  console.log(JSON.stringify({ applied: true, files: files.size, snapshot }));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.slice(2).some(arg => arg !== '--应用已批准差异')) throw Error('仅允许预审或精确接入本批批准差异');
  接入精简主题({ 应用: process.argv.includes('--应用已批准差异') });
}
