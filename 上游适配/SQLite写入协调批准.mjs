import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { SQLite安全指纹, 读取SQLite批准, 核验SQLite自有依赖 } from './SQLite全面替换批准.mjs';
import { 核验启动存储自有依赖 } from './SQLite启动存储批准.mjs';

// 用户批准后的独立登记；不覆盖待审查快照，不放宽旧依赖保护器。
export const 写入协调差异SHA256 = 'e3b1e5bee1c6885400bad45d982da47db5c39da0ad45eb1d0e38e387a2b95efe';
export const 写入协调清单SHA256 = '569d4c279cd717d9f573a9921e356c18ed5f4d4d5d4225c91876fd679c3223f3';
export const 服务包协议路径 = '扩展功能/本机存储/协议.mjs';
export const 服务包协议SHA256 = '7233efe46bfb06d5e509c6da2f16c871d8b397387edf2d90ddf91a48fbe4a095';
export const 服务包工作区路径 = '扩展功能/本机存储/SQLite工作区.mjs';
export const 服务包工作区SHA256 = '8ec1b80dafb66627812b7e5d8b631662d7d7aab70a18de916d43851449c08e69';
const sha = value => createHash('sha256').update(value).digest('hex');
const paths = ['扩展功能/本机服务/数据服务.mjs', '扩展功能/本机服务/写入协调.mjs'];

export function 核验写入协调批准(json, patch) {
  if (sha(json) !== 写入协调清单SHA256 || sha(patch) !== 写入协调差异SHA256) throw Error('写入协调批准指纹不符');
  const manifest = JSON.parse(json), parent = 读取SQLite批准().自有依赖.find(item => item.文件 === paths[0]);
  if (manifest.差异SHA256 !== 写入协调差异SHA256 || manifest.文件.length !== 2 ||
      manifest.文件.some((item, index) => item.文件 !== paths[index]) || manifest.文件[0].原始SHA256 !== parent?.SHA256 ||
      manifest.文件[1].原始SHA256 !== null) throw Error('写入协调批准范围或前置不符');
  return manifest;
}
export function 读取写入协调批准() {
  return 核验写入协调批准(readFileSync(new URL('./待审查/SQLite写入协调.json', import.meta.url)), readFileSync(new URL('./待审查/SQLite写入协调.patch', import.meta.url)));
}
export function 核验写入协调自有依赖(root) {
  核验SQLite自有依赖(root); 核验启动存储自有依赖(root);
  if (SQLite安全指纹(root, 服务包协议路径) !== 服务包协议SHA256 ||
      SQLite安全指纹(root, paths[1]) !== 读取写入协调批准().文件[1].候选SHA256) throw Error('写入协调自有依赖偏离批准内容');
}

// 工作区、服务、队列共用同一协议实例，避免StorageError跨模块身份导致404/409退化为500。
// 原工作区和协议只按旧批准指纹复制，不修改其字节；严格核验整个闭合依赖包。
export function 检查写入协调服务包(root) {
  const manifest = 读取写入协调批准(), allowed = new Set([...paths, 服务包协议路径, 服务包工作区路径]);
  for (const item of manifest.文件) SQLite安全指纹(root, item.文件);
  if (SQLite安全指纹(root, 服务包协议路径) !== 服务包协议SHA256) throw Error('服务包协议未知改动');
  if (SQLite安全指纹(root, 服务包工作区路径) !== 服务包工作区SHA256) throw Error('服务包工作区未知改动');
  const directories = new Set(['扩展功能', '扩展功能/本机存储', '扩展功能/本机服务']);
  function inventory(path = '') {
    for (const entry of readdirSync(join(root, path), { withFileTypes: true })) {
      const relative = path ? path + '/' + entry.name : entry.name;
      const stat = lstatSync(join(root, relative));
      if (stat.isSymbolicLink()) throw Error('服务包不允许符号链接');
      if (stat.isDirectory() && directories.has(relative)) inventory(relative);
      else if (!stat.isFile() || stat.nlink !== 1 || !allowed.has(relative)) throw Error('服务包包含未知文件、目录或硬链接：' + relative);
    }
  }
  inventory();
  let before = 0, after = 0;
  for (const item of manifest.文件) {
    const hash = SQLite安全指纹(root, item.文件);
    if (hash === item.原始SHA256) before++;
    else if (hash === item.候选SHA256) after++;
    else throw Error('写入协调存在未知改动：' + item.文件);
  }
  if (before && after) throw Error('写入协调批次不完整');
  return after === 2;
}
