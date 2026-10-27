import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { 根目录, 基线 } from './公共.mjs';
import { 检查运行副本, 哈希 } from './检查运行副本.mjs';
import { 授权入口批准产物 } from './接入SQLite工作台授权隔离副本.mjs';
import { 免填码批准产物 } from './接入SQLite免填码隔离副本.mjs';
import { 核验免填码自有依赖, 免填码差异SHA256 } from '../上游适配/SQLite免填码启动批准.mjs';
import { 精确替换, 预审类型, 生成审查差异 } from './检查首批功能适配.mjs';

export function 自动入口保存恢复候选(source) {
  return 精确替换(source, [["import { createApplicationStorage } from './应用存储适配.mjs';", "import { createRecoverableApplicationStorage as createApplicationStorage } from './可恢复应用存储.mjs';"]]);
}
export function 构建保存恢复候选() {
  检查运行副本(); 核验免填码自有依赖(根目录);
  const { combined: authorization } = 授权入口批准产物(), prerequisite = new Map([...authorization, ...免填码批准产物()]);
  const delta = new Map(), bridge = 'web/src/guan/上游浏览器存储桥.ts', entry = 'web/src/guan/SQLite应用入口.tsx';
  delta.set(bridge, { 原文: prerequisite.get(bridge).产物, 产物: readFileSync(join(根目录, '扩展功能/本机存储/保存恢复存储桥.ts'), 'utf8') });
  const before = prerequisite.get(entry).产物;
  delta.set(entry, { 原文: before, 产物: 精确替换(before, [['import React from "react";', 'import React from "react";\nimport { SQLiteSaveStatus } from "@/guan/保存状态条";'], ['            <RouterProvider router={router} />', '            <RouterProvider router={router} />\n            <SQLiteSaveStatus />']]) });
  const automatic = 'web/src/guan/sqlite/工作台自动入口.mjs';
  delta.set(automatic, { 原文: prerequisite.get(automatic).产物, 产物: 自动入口保存恢复候选(prerequisite.get(automatic).产物) });
  for (const [target, source] of [['web/src/guan/sqlite/可恢复应用存储.mjs', '本机存储/可恢复应用存储.mjs'], ['web/src/guan/保存状态条.tsx', '存储界面/保存状态条.tsx']]) {
    delta.set(target, { 原文: null, 产物: readFileSync(join(根目录, '扩展功能', source), 'utf8') });
  }
  return { delta, prerequisite, combined: new Map([...prerequisite, ...delta]) };
}
export function 预审SQLite保存恢复({ 完整类型 = false, 生成差异 = false } = {}) {
  const { delta, combined } = 构建保存恢复候选();
  if (完整类型) 预审类型(new Map([...combined].filter(([path]) => /\.(ts|tsx)$/.test(path))));
  const patch = 生成审查差异(delta);
  const manifest = { 日期: '2026-10-18', 状态: '待用户审查5文件精确后继；未接入原画布及3100', 上游提交: 基线.提交,
    前置免填码差异SHA256: 免填码差异SHA256, 差异SHA256: 哈希(patch), 完整TS类型预审通过: 完整类型,
    文件: [...delta].map(([文件, item]) => ({ 文件, 原始SHA256: item.原文 === null ? null : 哈希(item.原文), 候选SHA256: 哈希(item.产物) })),
    约束: ['保留全部历史源码、批准器及JSON/patch，不改作者仓库，不覆盖已批准启动器', '原操作先用完整原operationId重试，ACK确认后再提交后续不可变编辑', '失败记录、底层pending和重试期间新编辑须全部ACK才清除错误', '仅新增声明式保存状态组件，不改画布/路由/节点布局，不使用DOM猴子补丁', '页内队列不是断电/刷新恢复，失败时提醒保留本页，不回退浏览器存储', '冲突、凭据和容量错误继续阻止，不强制覆盖、不明文降级', '本轮只预审和自有合成应用浏览器测试，不接入原画布/3100、不迁旧数据、不读取真实凭据、不提交发布'] };
  if (生成差异) for (const [name, value] of [['SQLite保存恢复.patch', patch], ['SQLite保存恢复.json', JSON.stringify(manifest, null, 2) + '\n']]) {
    const path = join(根目录, '上游适配/待审查', name);
    if (existsSync(path) && readFileSync(path, 'utf8') !== value) throw Error('不覆盖保存恢复审查快照');
    if (!existsSync(path)) writeFileSync(path, value);
  }
  return manifest;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.slice(2).some(arg => !['--完整类型预审', '--生成审查差异'].includes(arg))) throw Error('只预审保存恢复，不提供应用选项');
  console.log(JSON.stringify(预审SQLite保存恢复({ 完整类型: process.argv.includes('--完整类型预审'), 生成差异: process.argv.includes('--生成审查差异') }), null, 2));
}
