import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { 根目录, 基线 } from './公共.mjs';
import { 哈希 } from './检查运行副本.mjs';
import { SQLite批准产物 } from './接入SQLite隔离副本.mjs';
import { 精确替换, 生成审查差异, ts } from './检查首批功能适配.mjs';
import { 凭据接入前置指纹, 凭据接入差异SHA256 } from '../上游适配/SQLite凭据接入批准.mjs';

export const 配置合并存储表达式 = `({
                getItem: sqliteStateStorage.getItem,
                setItem: scheduleStateSave,
                async removeItem(key) {
                    await flushSQLiteStorage();
                    await sqliteStateStorage.removeItem(key);
                },
            })`;
export function 构建配置合并候选() {
  const path = 'web/src/stores/use-config-store.ts', source = SQLite批准产物().get(path)?.产物;
  if (!source || 哈希(source) !== 凭据接入前置指纹().get(path)) throw Error('配置合并前置偏离完整凭据批准链');
  const candidate = 精确替换(source, [
    ['import { sqliteStateStorage } from "@/guan/上游浏览器存储桥";', 'import { sqliteStateStorage, scheduleStateSave, flushSQLiteStorage } from "@/guan/上游浏览器存储桥";'],
    ['storage: createJSONStorage(() => sqliteStateStorage),', 'storage: createJSONStorage(() => ' + 配置合并存储表达式 + '),'],
  ]);
  const result = ts.transpileModule(candidate, { reportDiagnostics: true, fileName: 'use-config-store.ts', compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
  if (result.diagnostics?.length) throw Error('配置合并候选TS转译语法检查未通过');
  return new Map([[path, { 原文: source, 产物: candidate }]]);
}
export function 预审配置合并保存({ 生成差异 = false } = {}) {
  const delta = 构建配置合并候选(), patch = 生成审查差异(delta);
  const manifest = { 日期: '2026-10-18', 状态: '待用户批准；仅语法及模块预审，不接入隔离或3100', 上游提交: 基线.提交,
    前置凭据差异SHA256: 凭据接入差异SHA256, 差异SHA256: 哈希(patch), TS语法转译检查: true, 完整类型与原画布验证: false,
    文件: [...delta].map(([文件, item]) => ({ 文件, 原始SHA256: 哈希(item.原文), 候选SHA256: 哈希(item.产物) })),
    说明: ['配置保存改用已批准的400ms合并调度，不改作者onSave业务、授权和凭据限流。',
      '所有最终字段仍作为完整不可变快照提交；等待期间显示saving，flush立即提交，失败仍走原操作重试。',
      '删除必须先flush已排队配置，防止延迟写把已删配置写回；不丢弃失败队列。',
      '只生成1文件具体差异，保留原25/10文件历史，不接入、不重启、不访问真实凭据。'] };
  if (生成差异) for (const [name, content] of [['SQLite配置合并保存.patch', patch], ['SQLite配置合并保存.json', JSON.stringify(manifest, null, 2) + '\n']]) {
    const path = join(根目录, '上游适配/待审查', name);
    if (existsSync(path) && readFileSync(path, 'utf8') !== content) throw Error('不覆盖配置合并审查快照');
    if (!existsSync(path)) writeFileSync(path, content, { flag: 'wx', mode: 0o600 });
  }
  return manifest;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.slice(2).some(value => value !== '--生成审查差异')) throw Error('只预审配置合并，不提供应用、重启或跳过限流选项');
  console.log(JSON.stringify(预审配置合并保存({ 生成差异: process.argv.includes('--生成审查差异') }), null, 2));
}
