import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve, sep } from 'node:path';

// 2026-10-16用户明确批准“右上两个按钮补丁”；仅接受这两份精确产物。
export const 双入口差异SHA256 = '84ce03a198345769f2314e0e7dc220b1030a7f9d93152ff410125036afc425ef';
export const 双入口清单SHA256 = '7bf6e214becae94221eaccf82316c194de884147ee70db5e22bf2aca029ffe2c';
const hash = value => createHash('sha256').update(value).digest('hex');
const 原作者顶栏SHA256 = '07c20d1b2daca083b4f852947be49c07a6d8fcf83b1078bf10c1a01359779496';

export function 核验双入口批准(json, patch) {
  if (hash(json) !== 双入口清单SHA256 || hash(patch) !== 双入口差异SHA256) throw Error('双入口批准指纹不符');
  const manifest = JSON.parse(json);
  if (manifest.差异SHA256 !== 双入口差异SHA256 || manifest.文件.length !== 2 || manifest.文件[0].文件 !== 'web/src/components/layout/user-status-actions.tsx' || manifest.文件[1].文件 !== 'web/src/guan/右上双入口.ts') throw Error('双入口批准范围不符');
  return manifest;
}

export function 读取双入口批准() {
  return 核验双入口批准(readFileSync(new URL('./待审查/右上双入口关闭.json', import.meta.url)), readFileSync(new URL('./待审查/右上双入口关闭.patch', import.meta.url)));
}

export function 检查双入口批次(root, manifest) {
  const base = resolve(root);
  let before = 0, after = 0;
  for (const item of manifest.文件) {
    const path = resolve(root, item.文件);
    if (!path.startsWith(base + sep)) throw Error('双入口路径逃逸');
    for (let cursor = path; cursor !== base; cursor = dirname(cursor)) {
      try { if (lstatSync(cursor).isSymbolicLink()) throw Error('双入口不允许符号链接'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    const current = existsSync(path) ? hash(readFileSync(path)) : null;
    if (current === item.候选SHA256) after++;
    else if (current === item.原始SHA256 || (item.文件 === 'web/src/components/layout/user-status-actions.tsx' && current === 原作者顶栏SHA256)) before++;
    else throw Error('双入口存在未知改动：' + item.文件);
  }
  if (before && after) throw Error('双入口批次不完整，拒绝启动；请从事务快照恢复');
  return after === manifest.文件.length;
}
