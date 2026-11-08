import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { 读取SQLite批准, SQLite差异SHA256, SQLite安全指纹 } from './SQLite全面替换批准.mjs';

// 2026-10-17 用户批准此1文件精确后继；原25文件批准及审批前快照不改。
// 只允许隔离验收，不授权接管3100、迁入真实数据、重启或发布。
export const 节点存储差异SHA256 = 'd6aa48d18899fe8ab7044d343c44026cd3e827dea884017314d0f409a0cdae08';
export const 节点存储清单SHA256 = '5a9978f2c0600082b0559497377392486a9702d59a2f938da184be996d7bf7ec';
const sha = value => createHash('sha256').update(value).digest('hex');

export function 核验节点存储批准(json, patch) {
  if (sha(json) !== 节点存储清单SHA256 || sha(patch) !== 节点存储差异SHA256) throw Error('节点存储批准指纹不符');
  const manifest = JSON.parse(json), parent = 读取SQLite批准();
  const item = manifest.文件[0], previous = parent.文件.find(value => value.文件 === item?.文件);
  if (manifest.文件.length !== 1 || item.文件 !== 'web/src/lib/canvas/canvas-event-bus.ts' ||
      manifest.上游提交 !== parent.上游提交 || manifest.前置差异SHA256 !== SQLite差异SHA256 ||
      manifest.差异SHA256 !== 节点存储差异SHA256 || item.原始SHA256 !== previous?.候选SHA256) throw Error('节点存储批准范围或前置不符');
  return manifest;
}

export function 读取节点存储批准() {
  return 核验节点存储批准(readFileSync(new URL('./待审查/SQLite节点存储惰性接入.json', import.meta.url)), readFileSync(new URL('./待审查/SQLite节点存储惰性接入.patch', import.meta.url)));
}

// 仅接受已接入25文件的完整旧后态或本次完整后继；拒绝浏览器版前态、半批和未知修改。
// 不改变历史检查SQLite批次的语义，更不让它接受任意后继。
export function 检查节点存储后继(root) {
  const delta = 读取节点存储批准().文件[0];
  let applied = false;
  for (const item of 读取SQLite批准().文件) {
    const current = SQLite安全指纹(root, item.文件);
    if (item.文件 === delta.文件 && current === delta.候选SHA256) applied = true;
    else if (current !== item.候选SHA256) throw Error('节点存储前置不完整或存在未知改动：' + item.文件);
  }
  return applied;
}
