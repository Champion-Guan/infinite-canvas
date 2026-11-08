import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { SQLite安全指纹, 核验SQLite自有依赖 } from './SQLite全面替换批准.mjs';
import { 读取节点存储批准, 检查节点存储后继, 节点存储差异SHA256 } from './SQLite节点存储批准.mjs';

// 2026-10-17用户批准已展示的3文件精确差异。只允许新隔离副本验收。
// 历史审批JSON/patch及前置保护器不改，不授权接管3100、真实数据或发布。
export const 启动存储差异SHA256 = '0b15056948f5ada3171f66c36d778259c4b1728b6493d751a568be95644ff54e';
export const 启动存储清单SHA256 = '74d235f58f5725aa674de0b27f05f2ad87ec773818c9441e9b0d51bd8bdfa53d';
const sha = value => createHash('sha256').update(value).digest('hex');
const paths = ['web/index.html', 'web/src/router.tsx', 'web/src/guan/路由临时状态.ts'];

export function 核验启动存储批准(json, patch) {
  if (sha(json) !== 启动存储清单SHA256 || sha(patch) !== 启动存储差异SHA256) throw Error('启动存储批准指纹不符');
  const manifest = JSON.parse(json), parent = 读取节点存储批准();
  if (manifest.差异SHA256 !== 启动存储差异SHA256 || manifest.上游提交 !== parent.上游提交 ||
      manifest.前置节点存储差异SHA256 !== 节点存储差异SHA256 || manifest.文件.length !== 3 ||
      manifest.文件.some((item, index) => item.文件 !== paths[index]) || manifest.文件[2].原始SHA256 !== null) throw Error('启动存储批准范围或前置不符');
  return manifest;
}
export function 读取启动存储批准() {
  return 核验启动存储批准(readFileSync(new URL('./待审查/SQLite启动存储隔离.json', import.meta.url)), readFileSync(new URL('./待审查/SQLite启动存储隔离.patch', import.meta.url)));
}
export function 核验启动存储自有依赖(root) {
  核验SQLite自有依赖(root);
  const item = 读取启动存储批准().文件[2];
  if (SQLite安全指纹(root, '扩展功能/本机存储/路由临时状态.ts') !== item.候选SHA256) throw Error('路由临时状态自有源码偏离批准内容');
}
// 必须先有完整25文件+节点修正后继，新增3文件只接受全前态或全后态。
export function 检查启动存储后继(root) {
  if (!检查节点存储后继(root)) throw Error('启动存储必须有已批准的节点存储完整后继');
  let before = 0, after = 0;
  for (const item of 读取启动存储批准().文件) {
    const hash = SQLite安全指纹(root, item.文件);
    if (hash === item.原始SHA256) before++;
    else if (hash === item.候选SHA256) after++;
    else throw Error('启动存储存在未知修改：' + item.文件);
  }
  if (before && after) throw Error('启动存储批次不完整');
  return after === 3;
}
