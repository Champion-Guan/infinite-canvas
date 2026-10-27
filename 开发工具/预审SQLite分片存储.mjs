import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { 根目录, 基线 } from './公共.mjs';
import { 检查运行副本, 哈希 } from './检查运行副本.mjs';
import { 构建保存恢复候选 } from './预审SQLite保存恢复.mjs';
import { 保存恢复批准产物 } from './接入SQLite保存恢复隔离副本.mjs';
import { 核验保存恢复自有依赖, 保存恢复差异SHA256 } from '../上游适配/SQLite保存恢复批准.mjs';
import { 精确替换, 生成审查差异 } from './检查首批功能适配.mjs';

export function 自动入口分片候选(source) {
  return 精确替换(source, [["import { createRecoverableApplicationStorage as createApplicationStorage } from './可恢复应用存储.mjs';", "import { createRecoverableShardedApplicationStorage as createApplicationStorage } from './可恢复分片应用存储.mjs';"]]);
}
export function 构建分片候选() {
  检查运行副本(); 核验保存恢复自有依赖(根目录); 保存恢复批准产物();
  const { combined: prerequisite } = 构建保存恢复候选(), path = 'web/src/guan/sqlite/工作台自动入口.mjs', original = prerequisite.get(path).产物;
  const delta = new Map([[path, { 原文: original, 产物: 自动入口分片候选(original) }]]);
  for (const name of ['分片值编码.mjs', '分片应用存储.mjs', '可恢复分片应用存储.mjs']) delta.set('web/src/guan/sqlite/' + name, { 原文: null, 产物: readFileSync(join(根目录, '扩展功能/本机存储', name), 'utf8') });
  return { delta, prerequisite, combined: new Map([...prerequisite, ...delta]) };
}
export function 预审分片存储({ 生成差异 = false } = {}) {
  const { delta } = 构建分片候选(), patch = 生成审查差异(delta);
  const manifest = { 日期: '2026-10-18', 状态: '4文件精确后继待用户批准；仅自有模块与合成界面预审，未接入原画布及3100', 上游提交: 基线.提交,
    前置保存恢复差异SHA256: 保存恢复差异SHA256, 差异SHA256: 哈希(patch),
    文件: [...delta].map(([文件, item]) => ({ 文件, 原始SHA256: item.原文 === null ? null : 哈希(item.原文), 候选SHA256: 哈希(item.产物) })),
    约束: ['只改自动入口一行import，新增3份自有模块，旧代码/批准器/JSON及patch不覆盖', '不可变内容寻址块先确认，再原根ID和revision提交完整一代；块及根丢ACK均原operationId重试', '旧v1只读不改写；在合成库明确编辑后可发布v2，旧适配器遇v2须拒绝而不是空库', '修正恢复队列完成微任务边界搁置，排空等待后续重启的队列', '单块1MiB、逻辑命名空间32MiB/4096块上限，原服务2MiB限制不改', '同一客户端共享96次/10.05秒滑动请求预算，服务120次/10秒限制不改；额外非适配器请求仍可能被服务拒绝', '没有GC，不删除旧代/失败块/媒体；不会回退浏览器库或明文存储凭据', '完整JSON解析编码成本、usage逻辑统计和更大真实项目性能仍待优化', '未获得本批批准不装入原画布，不重启3100、不迁真实数据、不访问Keychain、不提交发布'] };
  if (生成差异) for (const [name, value] of [['SQLite分片存储.patch', patch], ['SQLite分片存储.json', JSON.stringify(manifest, null, 2) + '\n']]) {
    const path = join(根目录, '上游适配/待审查', name);
    if (existsSync(path) && readFileSync(path, 'utf8') !== value) throw Error('不覆盖分片审查快照');
    if (!existsSync(path)) writeFileSync(path, value, { flag: 'wx' });
  }
  return manifest;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.slice(2).some(arg => arg !== '--生成审查差异')) throw Error('仅预审分片，不提供应用或生产选项');
  console.log(JSON.stringify(预审分片存储({ 生成差异: process.argv.includes('--生成审查差异') }), null, 2));
}
