import { mkdtempSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { 根目录 } from './公共.mjs';
import { 检查运行副本, 运行目录, 哈希 } from './检查运行副本.mjs';
import { 生成请求转发候选 } from './预审请求转发恢复.mjs';
import { 预审类型, 生成审查差异 } from './检查首批功能适配.mjs';
import { 读取请求转发批准, 请求转发差异SHA256 } from '../上游适配/请求转发恢复批准.mjs';
import { 事务写入 } from './接入用户功能.mjs';

export function 请求转发批准产物() {
  const manifest = 读取请求转发批准();
  const files = 生成请求转发候选();
  if (files.size !== 1 || 哈希(生成审查差异(files)) !== 请求转发差异SHA256) throw Error('请求转发权威产物偏离批准差异');
  for (const item of manifest.文件) {
    const value = files.get(item.文件);
    if (!value || 哈希(value.原文) !== item.原始SHA256 || 哈希(value.产物) !== item.候选SHA256) throw Error('请求转发产物指纹不符');
  }
  return files;
}
export function 接入请求转发({ 应用 = false } = {}) {
  const state = 检查运行副本();
  if (!state.顶栏单来源已应用) throw Error('请求转发缺少完整前置');
  const files = 请求转发批准产物();
  预审类型(files);
  if (state.请求转发已恢复) return console.log('同一请求转发补丁已接入，不重复写入。');
  if (!应用) return console.log('请求转发批准指纹及完整类型预审通过，未写入副本。');
  检查运行副本();
  for (const [path, item] of files) if (readFileSync(join(运行目录, path), 'utf8') !== item.原文) throw Error('请求转发写入前态变化：' + path);
  const snapshot = mkdtempSync(join(根目录, '.运行/请求转发接入-'));
  事务写入(运行目录, files, snapshot, { 差异指纹: 请求转发差异SHA256, 写后检查: () => {
    if (!检查运行副本().请求转发已恢复) throw Error('请求转发写后检查失败');
  } });
  console.log(JSON.stringify({ applied: true, files: files.size, snapshot }));
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.slice(2).some(arg => arg !== '--应用已批准差异')) throw Error('只允许精确接入已批准的请求转发差异');
  接入请求转发({ 应用: process.argv.includes('--应用已批准差异') });
}
