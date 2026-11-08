import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { 根目录 } from './公共.mjs';
import { 检查运行副本, 运行目录, 哈希 } from './检查运行副本.mjs';
import { 读取全局恢复批准, 全局恢复差异SHA256 } from '../上游适配/全局界面恢复批准.mjs';
import { 生成全局界面候选, 生成品牌资源差异 } from './预审全局界面恢复.mjs';
import { 读取品牌资源 } from './导入品牌原样资源.mjs';
import { 品牌资源 } from '../上游适配/全局顶栏主题品牌恢复.mjs';
import { 生成审查差异, 预审类型 } from './检查首批功能适配.mjs';
import { 事务写入 } from './接入用户功能.mjs';

export function 全局恢复批准产物() {
  const manifest = 读取全局恢复批准();
  const files = 生成全局界面候选();
  if (哈希(生成审查差异(files) + 生成品牌资源差异()) !== 全局恢复差异SHA256) throw Error('全局恢复产物偏离批准差异');
  files.set(品牌资源.产物, { 原文: null, 产物: 读取品牌资源() });
  if (files.size !== manifest.文件.length) throw Error('全局恢复文件数量不符');
  for (const item of manifest.文件) {
    const value = files.get(item.文件);
    if (!value || (value.原文 === null ? null : 哈希(value.原文)) !== item.原始SHA256 || 哈希(value.产物) !== item.候选SHA256) throw Error('全局恢复权威来源指纹不符');
  }
  return files;
}

async function 检查空闲端口() {
  // 同时检查IPv4与IPv6，不能误把localhost绑定另一地址视为空闲。
  for (const host of ['127.0.0.1', '::1']) await new Promise((done, reject) => {
    const server = createServer();
    server.once('error', error => error.code === 'EADDRNOTAVAIL' ? done() : reject(Error('3100仍有服务，停止接入；不得杀未知进程')));
    server.listen(3100, host, () => server.close(done));
  });
}

export async function 接入全局恢复({ 应用 = false } = {}) {
  const state = 检查运行副本();
  const files = 全局恢复批准产物();
  预审类型(new Map([...files].filter(([path]) => /\.tsx?$/.test(path))));
  if (state.全局界面恢复已应用) return console.log('已接入同一9文件恢复差异，不重复写入。');
  if (!应用) return console.log('全局恢复完整类型预审通过，未写入副本。');
  await 检查空闲端口();
  检查运行副本();
  const snapshot = mkdtempSync(join(根目录, '.运行/全局界面恢复-'));
  事务写入(运行目录, files, snapshot, { 差异指纹: 全局恢复差异SHA256, 写后检查: () => {
    if (!检查运行副本().全局界面恢复已应用) throw Error('全局恢复写后校验失败');
  } });
  console.log(JSON.stringify({ applied: true, snapshot }));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.slice(2).some(arg => arg !== '--应用已批准差异')) throw Error('仅允许预审或精确接入本批批准差异');
  await 接入全局恢复({ 应用: process.argv.includes('--应用已批准差异') });
}
