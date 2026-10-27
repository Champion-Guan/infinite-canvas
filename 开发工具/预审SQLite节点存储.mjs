import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { 根目录, 基线 } from './公共.mjs';
import { 哈希 } from './检查运行副本.mjs';
import { 精确替换, 生成审查差异, 预审类型 } from './检查首批功能适配.mjs';
import { SQLite批准产物 } from './接入SQLite隔离副本.mjs';
import { SQLite差异SHA256 } from '../上游适配/SQLite全面替换批准.mjs';

export const 节点存储路径 = 'web/src/lib/canvas/canvas-event-bus.ts';
export function 节点存储惰性候选(text) {
  return 精确替换(text, [[`export function createPluginStorage(pluginId: string): PluginStorage {
    let store = stores.get(pluginId);
    if (!store) {
        store = localforage.createInstance({ name: "infinite-canvas-plugins", storeName: pluginId });
        stores.set(pluginId, store);
    }
    return {
        get: (key) => store!.getItem(key),
        set: async (key, value) => {
            await store!.setItem(key, value);
        },
        remove: async (key) => {
            await store!.removeItem(key);
        },
    };
}`, `export function createPluginStorage(pluginId: string): PluginStorage {
    // 内置节点也组装此上下文；只创建能力描述，不能因此打开插件数据库。
    // 真正调用读写时仍经过SQLite白名单，未授权插件不会恢复或退回浏览器。
    const getStore = () => {
        let store = stores.get(pluginId);
        if (!store) {
            store = localforage.createInstance({ name: "infinite-canvas-plugins", storeName: pluginId });
            stores.set(pluginId, store);
        }
        return store;
    };
    return {
        get: async (key) => getStore().getItem(key),
        set: async (key, value) => {
            await getStore().setItem(key, value);
        },
        remove: async (key) => {
            await getStore().removeItem(key);
        },
    };
}`]]);
}

export function 预审SQLite节点存储({ 生成差异 = false } = {}) {
  const approved = SQLite批准产物();
  const before = approved.get(节点存储路径).产物;
  const after = 节点存储惰性候选(before);
  const delta = new Map([[节点存储路径, { 原文: before, 产物: after }]]);
  const combined = new Map(approved);
  combined.set(节点存储路径, { ...approved.get(节点存储路径), 产物: after });
  预审类型(combined);
  const patch = 生成审查差异(delta);
  const manifest = {
    状态: '待此1文件具体差异批准，未应用任何运行副本', 日期: '2026-10-17', 上游提交: 基线.提交,
    前置差异SHA256: SQLite差异SHA256, 差异SHA256: 哈希(patch), 完整类型预审通过: true,
    原因: '实际完整React构建新增文本节点时，内置节点上下文过早创建未授权插件仓库，导致React Router错误页。',
    保持约束: ['插件仍关闭，实际插件存储读写仍拒绝', '不访问浏览器持久化', '不改画布UI或节点结构', '不授权重启、迁入旧数据、真实凭据或发布'],
    文件: [{ 文件: 节点存储路径, 原始SHA256: 哈希(before), 候选SHA256: 哈希(after) }],
  };
  if (生成差异) for (const [name, content] of [['SQLite节点存储惰性接入.patch', patch], ['SQLite节点存储惰性接入.json', JSON.stringify(manifest, null, 2) + '\n']]) {
    const path = join(根目录, '上游适配/待审查', name);
    if (existsSync(path) && readFileSync(path, 'utf8') !== content) throw Error('不覆盖历史节点存储审查');
    if (!existsSync(path)) writeFileSync(path, content);
  }
  return manifest;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.slice(2).some(arg => arg !== '--生成审查差异')) throw Error('只预审具体差异，不提供应用命令');
  console.log(JSON.stringify(预审SQLite节点存储({ 生成差异: process.argv.includes('--生成审查差异') }), null, 2));
}
