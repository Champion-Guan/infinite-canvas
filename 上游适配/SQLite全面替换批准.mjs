import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { 值编码提速后态通过 } from './SQLite值编码提速批准.mjs';

// 2026-10-17 用户批准已展示的25文件差异；历史JSON/patch原字节保留。
// 不授权生产切换、旧数据迁入、真实凭据访问、服务重启或发布。
export const SQLite差异SHA256 = 'bd8181def99766ff5324dfec0266e00923ff71b48358896dc05b8ee36bbba4fa';
export const SQLite清单SHA256 = 'e66ee57760c3687b0cf459009d946f374a76f380c9358385b47614b21ca7fc40';
const sha = value => createHash('sha256').update(value).digest('hex');

export function 核验SQLite批准(json, patch) {
  if (sha(json) !== SQLite清单SHA256 || sha(patch) !== SQLite差异SHA256) throw Error('SQLite批准指纹不符');
  const manifest = JSON.parse(json);
  if (manifest.上游提交 !== '3a6b64b602ad062b29fac66902ed18a7ef5fd9dc' || manifest.差异SHA256 !== SQLite差异SHA256 || manifest.文件.length !== 25 || new Set(manifest.文件.map(item => item.文件)).size !== 25) throw Error('SQLite批准范围不符');
  return manifest;
}

export function 读取SQLite批准() {
  return 核验SQLite批准(readFileSync(new URL('./待审查/SQLite全面替换.json', import.meta.url)), readFileSync(new URL('./待审查/SQLite全面替换.patch', import.meta.url)));
}

export function SQLite安全指纹(root, relative) {
  const base = resolve(root), path = resolve(base, relative);
  if (!path.startsWith(base + sep)) throw Error('SQLite路径逃逸');
  if (lstatSync(base).isSymbolicLink()) throw Error('SQLite不允许符号链接');
  let missing = false;
  for (let cursor = path; cursor !== base; cursor = dirname(cursor)) {
    try { if (lstatSync(cursor).isSymbolicLink()) throw Error('SQLite不允许符号链接'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; missing = true; }
  }
  if (missing) return null;
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.nlink !== 1) throw Error('SQLite文件类型或硬链接不安全');
  return sha(readFileSync(path));
}

export function 检查SQLite批次(root) {
  const manifest = 读取SQLite批准();
  let before = 0, after = 0;
  for (const item of manifest.文件) {
    const current = SQLite安全指纹(root, item.文件);
    if (current === item.原始SHA256) before++;
    else if (current === item.候选SHA256) after++;
    else throw Error('SQLite存在未知改动：' + item.文件);
  }
  if (before && after) throw Error('SQLite批次不完整，拒绝加载');
  return after === manifest.文件.length;
}

export function 核验SQLite自有依赖(root) {
  for (const item of 读取SQLite批准().自有依赖) {
    if (!SQLite自有依赖通过(root, item)) throw Error('SQLite自有依赖偏离批准快照：' + item.文件);
  }
}

// 历史清单仍保留原始哈希；只有已登记的单文件后继可以替代它，其他文件不放宽。
export function SQLite自有依赖通过(root, item) {
  const current = SQLite安全指纹(root, item.文件);
  return current === item.SHA256 || 值编码提速后态通过(current, item.文件);
}
