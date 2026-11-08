import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

// 单文件性能后继。历史 SQLite 批次与其 JSON/patch 保持原字节；这里只允许明确登记的媒体复用后态。
export const 值编码提速清单SHA256 = '49dbb7dc07885289ece678779bff4e451a3ef063eeffcb313ab2bc1e31a98199';
export const 值编码提速差异SHA256 = '39e00125818e873f0de8e365dd71321483a7b26b066f592eb28187470ca66b0e';
export const 值编码提速前态SHA256 = 'ef0ab5cde710b405755cb4cf63688f91c9a965e321d63a9d655411a3756a863f';
export const 值编码提速后态SHA256 = 'a4cff62a8de6d63336e820d4108b8700cba15d1948dff7f0385bf490f271cfff';
const 后态 = new Map([
  ['扩展功能/本机存储/应用值编码.mjs', 值编码提速后态SHA256],
  ['扩展功能/本机存储/应用存储适配.mjs', 'fcf14064ea94c0ffd220a0d343939ad3f7c4fc7fb5b4b1a4d5ccf228839d0eb8'],
  ['扩展功能/本机存储/浏览器适配.mjs', '910689424ddf502508862fbba840065f5abf695737f8f7c7dd845f3f4239fca7'],
  ['扩展功能/本机服务/数据服务.mjs', 'e89b8813b11519b5f9484329aa343e32872adf8ab37f938a0352a25b39b3370b'],
  ['扩展功能/本机存储/SQLite工作区.mjs', '1811c409b7441388ce2791634feb6df746aa11592182059252820bda4c1431e4'],
]);
const sha = value => createHash('sha256').update(value).digest('hex');

export function 读取值编码提速批准() {
  const json = readFileSync(new URL('./待审查/SQLite值编码提速.json', import.meta.url));
  const patch = readFileSync(new URL('./待审查/SQLite值编码提速.patch', import.meta.url));
  if (sha(json) !== 值编码提速清单SHA256 || sha(patch) !== 值编码提速差异SHA256) throw Error('SQLite值编码提速后继指纹不符');
  const manifest = JSON.parse(json), item = manifest.文件?.[0];
  if (manifest.上游提交 !== '3a6b64b602ad062b29fac66902ed18a7ef5fd9dc' ||
      manifest.前置SHA256 !== 值编码提速前态SHA256 || manifest.差异SHA256 !== 值编码提速差异SHA256 ||
      manifest.文件.length !== 后态.size || manifest.文件.some(item => item.原始SHA256 === item.候选SHA256 || !后态.has(item.文件) || item.候选SHA256 !== 后态.get(item.文件))) throw Error('SQLite值编码提速后继范围不符');
  return manifest;
}

export function 值编码提速后态通过(hash, file = '扩展功能/本机存储/应用值编码.mjs') {
  读取值编码提速批准();
  return hash === 后态.get(file);
}
