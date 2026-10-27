import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { 根目录, 基线 } from './公共.mjs';
import { 哈希, 检查运行副本 } from './检查运行副本.mjs';
import { 精确替换, 生成审查差异 } from './检查首批功能适配.mjs';
import { 读取产品删除隔离记录 } from './接入产品悬浮删除隔离副本.mjs';
import { 预审产品悬浮删除类型 } from './预审产品悬浮删除.mjs';

export const 恢复挂载前置记录 = join(根目录, '.运行/产品悬浮删除-OlIVTI/产品悬浮删除接入记录.json');
export const 恢复挂载自有来源 = '扩展功能/产品/产品恢复挂载门禁.ts';

// 所有业务改动仅在内存候选中生成；不改运行副本、历史业务源码或保护器。
export function 构建产品恢复挂载候选() {
  const integration = 读取产品删除隔离记录(恢复挂载前置记录), delta = new Map();
  const read = path => readFileSync(join(integration.副本, path), 'utf8');
  const edit = (path, changes) => {
    const 原文 = read(path);
    delta.set(path, { 原文, 产物: 精确替换(原文, changes) });
  };
  const modulePath = 'web/src/guan/产品恢复挂载门禁.ts';
  if (existsSync(join(integration.副本, modulePath))) throw Error('候选新增挂载门禁路径已存在');
  delta.set(modulePath, { 原文: null, 产物: readFileSync(join(根目录, 恢复挂载自有来源), 'utf8') });
  edit('web/src/guan/产品操作.ts', [
    ['import { orderedProducts } from "./产品规则";', 'import { orderedProducts } from "./产品规则";\nimport { productRestoreMountGate } from "./产品恢复挂载门禁";'],
    ['      });\n    },\n    [navigate],', '      });\n      // 只有业务根与导航偏好均已确认，且导航已发起，才允许恢复画布挂载。\n      productRestoreMountGate.release(id);\n    },\n    [navigate],'],
    ['      await flushSQLiteStorage();\n      if (activeId === id) {', '      await flushSQLiteStorage();\n      // 已再次归档的ID不再需要页内挂载门禁；未确认保存不走到这里。\n      productRestoreMountGate.release(id);\n      if (activeId === id) {'],
    ['      const before = useCanvasStore.getState(), planned = planProductRestore(before, id);\n      if (planned !== before) useCanvasStore.setState(planned);', '      const before = useCanvasStore.getState(), planned = planProductRestore(before, id);\n      if (planned !== before) {\n        // 必须先封住挂载，再发布恢复状态；失败时保留门禁，显式重试/切换确认后放行。\n        productRestoreMountGate.block(id);\n        useCanvasStore.setState(planned);\n      }'],
  ]);
  edit('web/src/guan/产品工作区.tsx', [
    ['import { memo, useEffect, useState } from "react";', 'import { memo, useEffect, useState, useSyncExternalStore } from "react";'],
    ['import { ProductSurface } from "./产品界面边界";', 'import { ProductSurface } from "./产品界面边界";\nimport { productRestoreMountGate } from "./产品恢复挂载门禁";'],
    ['  const home = useMatch("/");', '  const home = useMatch("/");\n  const blockedRestores = useSyncExternalStore(productRestoreMountGate.subscribe, productRestoreMountGate.getSnapshot, productRestoreMountGate.getSnapshot);\n  const activeRestorePending = blockedRestores.includes(activeId);'],
    ['      {visibleIds.map((id) => (', '      {visibleIds.filter((id) => !blockedRestores.includes(id)).map((id) => ('],
    ['      {home || (activeId && !ids.includes(activeId)) ? (', '      {activeRestorePending ? (\n        <main className="grid h-full place-items-center bg-background text-foreground" role="status">产品恢复尚未确认，请勿刷新或关闭；若保存失败，请在回收站重试。</main>\n      ) : home || (activeId && !ids.includes(activeId)) ? ('],
  ]);
  return { integration, delta };
}

export function 预审产品恢复挂载类型(preview) { return 预审产品悬浮删除类型(preview); }

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.length !== 3 || process.argv[2] !== '--生成三文件审查') throw Error('仅允许生成候选审查；不接入或启动');
  检查运行副本();
  const preview = 构建产品恢复挂载候选();
  预审产品恢复挂载类型(preview);
  const patch = 生成审查差异(preview.delta);
  const manifest = { 日期: '2026-10-19', 状态: '待具体差异批准，未接入或启动', 上游提交: 基线.提交,
    前置记录: 恢复挂载前置记录, 前置差异SHA256: preview.integration.差异SHA256,
    自有来源: { [恢复挂载自有来源]: 哈希(readFileSync(join(根目录, 恢复挂载自有来源))) },
    差异SHA256: 哈希(patch), 文件数: preview.delta.size,
    文件: [...preview.delta].map(([文件, item]) => ({ 文件, 原始SHA256: item.原文 === null ? null : 哈希(item.原文), 候选SHA256: 哈希(item.产物) })),
    完整虚拟候选类型检查通过: true, 已接入: false, 已重启3100: false, 真实浏览器验收: false,
    范围: ['恢复ID在业务状态发布前封住挂载；根ACK、导航偏好ACK及导航发起后才放行', '根/偏好/导航失败不放行，保留同一恢复快照和显式重试；其他产品实例不卸载', '仅当前网址指向未确认恢复产品时显示状态提示，防止空白；不改既有胶囊与弹窗视觉', '不修改SQLite桥、授权、限流、媒体白名单、历史批准/保护器或作者文件'],
  };
  for (const [suffix, value] of [['patch', patch], ['json', JSON.stringify(manifest, null, 2) + '\n']])
    writeFileSync(join(根目录, '上游适配/待审查/产品恢复挂载竞态三文件.' + suffix), value, { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify(manifest, null, 2));
}
