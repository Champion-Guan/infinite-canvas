import { mkdtempSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { 根目录 } from './公共.mjs';
import { 检查运行副本, 运行目录, 哈希 } from './检查运行副本.mjs';
import { 读取合并恢复批准, 合并恢复差异SHA256 } from '../上游适配/音视频提示词与节点信息恢复批准.mjs';
import { 生成合并恢复候选 } from './预审音视频提示词与节点信息恢复.mjs';
import { 生成审查差异, 预审类型 } from './检查首批功能适配.mjs';
import { 事务写入 } from './接入用户功能.mjs';

export function 合并恢复批准产物() {
  const manifest = 读取合并恢复批准();
  const files = 生成合并恢复候选();
  if (files.size !== 10 || 哈希(生成审查差异(files)) !== 合并恢复差异SHA256) throw Error('恢复权威产物偏离批准差异');
  for (const item of manifest.文件) {
    const value = files.get(item.文件);
    if (!value || 哈希(value.原文) !== item.原始SHA256 || 哈希(value.产物) !== item.候选SHA256) throw Error('恢复权威来源指纹不符');
  }
  return files;
}

export function 接入合并恢复({ 应用 = false } = {}) {
  const state = 检查运行副本();
  const files = 合并恢复批准产物();
  预审类型(files);
  if (state.音视频提示词与节点信息恢复已应用) return console.log('已接入同一10文件恢复差异，不重复写入。');
  if (!应用) return console.log('10文件完整类型预审通过，未写入副本。');
  if (!检查运行副本().精简离线与三态主题已应用) throw Error('缺少完整21文件前置');
  for (const [path, item] of files) if (readFileSync(join(运行目录, path), 'utf8') !== item.原文) throw Error('写入前态发生变化：' + path);
  const snapshot = mkdtempSync(join(根目录, '.运行/合并恢复接入-'));
  事务写入(运行目录, files, snapshot, { 差异指纹: 合并恢复差异SHA256, 写后检查: () => {
    if (!检查运行副本().音视频提示词与节点信息恢复已应用) throw Error('恢复写后校验失败');
  } });
  console.log(JSON.stringify({ applied: true, files: files.size, snapshot }));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.slice(2).some(arg => arg !== '--应用已批准差异')) throw Error('仅允许预审或精确接入本批批准差异');
  接入合并恢复({ 应用: process.argv.includes('--应用已批准差异') });
}
