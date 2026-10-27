import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve, sep } from 'node:path';
import { 匹配首页后继 } from '../上游适配/首页批次后继.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');

// 只读：不存在/完整原状态或清单内全部精确产物；未知、半批和符号链接一律拒绝。
export function 检查首页批次(根, 清单) {
  const 文件 = [...清单.文件, ...清单.资源];
  const 允许 = new Set(文件.map(item => item.文件));
  let 原版数 = 0;
  let 新版数 = 0;
  for (const item of 文件) {
    const target = resolve(根, item.文件);
    if (!target.startsWith(resolve(根) + sep)) throw Error('首页路径逃逸。');
    for (let cursor = target; cursor !== resolve(根); cursor = dirname(cursor)) {
      try { if (lstatSync(cursor).isSymbolicLink()) throw Error('首页路径不允许符号链接。'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    const 当前 = existsSync(target) ? hash(readFileSync(target)) : null;
    if (当前 === item.候选SHA256 || 匹配首页后继(item, 当前)) 新版数++;
    else if (当前 === item.原始SHA256) 原版数++;
    else if (item.原始SHA256 !== null && 当前 === null) 原版数++; // 完整未接入功能批次由主保护器另验。
    else throw Error(`首页文件存在未知改动：${item.文件}`);
  }
  for (const 资源目录 of ['首页轮播', '首页原样资源']) {
  const 资源根 = join(根, 'web/public/guan', 资源目录);
  if (existsSync(资源根)) {
    for (const entry of readdirSync(资源根, { withFileTypes: true })) {
      if (!entry.isFile() || !允许.has('web/public/guan/' + 资源目录 + '/' + entry.name)) throw Error('首页资源目录有未声明文件。');
    }
  }
  }
  if (原版数 + 新版数 !== 文件.length || (原版数 && 新版数)) throw Error('首页批次不完整，拒绝启动；请使用事务快照恢复。');
  return 新版数 === 文件.length;
}
