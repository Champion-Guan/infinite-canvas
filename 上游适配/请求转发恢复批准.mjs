import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve, sep } from 'node:path';

// 用户于2026-10-16明确批准请求转发恢复补丁；批准前快照保持原字节。
export const 请求转发差异SHA256 = 'd0841d727568ca1d42a016420f882bba3d54ef1c53922dab42b24e5e9a2d0ef0';
export const 请求转发清单SHA256 = 'dec774e744c68cdc636d8c24ae2964fb6496df49ad8301a47f882530a7ee5ca8';
const 前置清单SHA256 = '6a2a67dd8ceceb4e96ec3c5ec8ac8a82fc056180549dcde817d5cf0ad4cd5795';
const hash = value => createHash('sha256').update(value).digest('hex');
export function 核验请求转发批准(json, patch) {
  if (hash(json) !== 请求转发清单SHA256 || hash(patch) !== 请求转发差异SHA256) throw Error('请求转发批准指纹不符');
  const manifest = JSON.parse(json);
  if (manifest.上游提交 !== '3a6b64b602ad062b29fac66902ed18a7ef5fd9dc' || manifest.前置差异SHA256 !== 'c20d9c494d9b08818138126cc72e9fcde55f683be95949738a385eae4ce070d8' || manifest.差异SHA256 !== 请求转发差异SHA256 || manifest.文件.length !== 1 || manifest.文件[0].文件 !== 'web/src/guan/功能开关.ts') throw Error('请求转发批准范围不符');
  return manifest;
}
export function 读取请求转发批准() {
  return 核验请求转发批准(readFileSync(new URL('./待审查/请求转发恢复.json', import.meta.url)), readFileSync(new URL('./待审查/请求转发恢复.patch', import.meta.url)));
}
export function 请求转发安全指纹(root, relative) {
  const base = resolve(root), path = resolve(base, relative);
  if (!path.startsWith(base + sep)) throw Error('请求转发路径逃逸');
  if (lstatSync(base).isSymbolicLink()) throw Error('请求转发不允许符号链接');
  for (let cursor = path; cursor !== base; cursor = dirname(cursor)) {
    try { if (lstatSync(cursor).isSymbolicLink()) throw Error('请求转发不允许符号链接'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return existsSync(path) ? hash(readFileSync(path)) : null;
}
// 独立叶节点，不导入历史批准器，避免历史保护链循环依赖。
export function 检查请求转发批次(root) {
  const manifest = 读取请求转发批准();
  const item = manifest.文件[0];
  const current = 请求转发安全指纹(root, item.文件);
  if (current !== item.候选SHA256) return false; // 其他历史态继续由既有保护链逐份校验。
  const json = readFileSync(new URL('./待审查/保留顶栏主题与单测试来源.json', import.meta.url));
  if (hash(json) !== 前置清单SHA256) throw Error('请求转发前置清单指纹不符');
  const previous = JSON.parse(json);
  if (previous.文件.length !== 10 || previous.文件.find(file => file.文件 === item.文件)?.候选SHA256 !== item.原始SHA256) throw Error('请求转发前置范围不符');
  for (const file of previous.文件) {
    const expected = file.文件 === item.文件 ? item.候选SHA256 : file.候选SHA256;
    if (请求转发安全指纹(root, file.文件) !== expected) throw Error('请求转发前置批次不完整或存在未知改动');
  }
  return true;
}
export function 请求转发前态指纹(root, relative) {
  const item = 读取请求转发批准().文件[0];
  const restored = 检查请求转发批次(root);
  return restored && relative === item.文件 ? item.原始SHA256 : 请求转发安全指纹(root, relative);
}
