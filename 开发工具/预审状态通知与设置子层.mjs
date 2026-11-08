import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { 根目录 } from './公共.mjs';
import { 哈希, 检查运行副本 } from './检查运行副本.mjs';
import { 精确替换, 生成审查差异 } from './检查首批功能适配.mjs';
import { 检查扩大整批类型 } from './预审迁移扩大整批.mjs';
import { 读取任务确认与设置边界隔离记录 } from './接入任务确认与设置边界隔离副本.mjs';

export const 子层前置记录 = join(根目录, '.运行/任务确认与设置边界-curBBR/确认边界接入记录.json');
export function 构建状态通知与设置子层候选() {
  const integration = 读取任务确认与设置边界隔离记录(子层前置记录), delta = new Map();
  function edit(path, pairs) {
    const target = '画布副本/web/src/' + path, original = readFileSync(join(integration.组合包, target), 'utf8');
    delta.set(target, { 原文: original, 产物: 精确替换(original, pairs) });
  }
  const added = '画布副本/web/src/guan/状态通知区.tsx';
  if (existsSync(join(integration.组合包, added))) throw Error('通知区新增路径已存在');
  delta.set(added, { 原文: null, 产物: readFileSync(join(根目录, '扩展功能/存储界面/状态通知区.tsx'), 'utf8') });
  edit('guan/SQLite应用入口.tsx', [
    ['import { SQLiteSaveStatus }', 'import { LocalStatusRegion } from "@/guan/状态通知区";\nimport { SQLiteSaveStatus }'],
    ['            <RouterProvider router={router} />\n            <SQLiteSaveStatus />', '            <LocalStatusRegion>\n                <RouterProvider router={router} />\n                <SQLiteSaveStatus />\n            </LocalStatusRegion>'],
  ]);
  edit('guan/保存状态条.tsx', [
    ['import { useEffect, useState }', 'import { LocalStatusNotice } from "@/guan/状态通知区";\nimport { useEffect, useState }'],
    ['return <aside aria-label="本机保存状态"', 'return <LocalStatusNotice order={2}><aside aria-label="本机保存状态"'],
    ['position: "fixed", right: 20, bottom: 20, zIndex: 80, maxWidth: 360, ', ''],
    ['    </aside>;', '    </aside></LocalStatusNotice>;'],
  ]);
  edit('guan/generation/图片任务确认状态.tsx', [
    ['import { useEffect, useMemo, useRef, useState }', 'import { LocalStatusNotice } from "@/guan/状态通知区";\nimport { useEffect, useMemo, useRef, useState }'],
    ['return <aside aria-label="图片任务确认" className="absolute bottom-24 right-5 z-[80] max-w-sm ', 'return <LocalStatusNotice order={1}><aside aria-label="图片任务确认" className="w-full '],
    ['  </aside>;', '  </aside></LocalStatusNotice>;'],
  ]);
  edit('components/layout/channel-editor-drawer.tsx', [
    ['import { businessFeatures }', 'import { useSettingsViewport } from "@/guan/设置视区";\nimport { businessFeatures }'],
    ['    const { t } = useTranslation();', '    const { t } = useTranslation();\n    const viewport = useSettingsViewport();'],
    ['            width={640}', '            width={640}\n            getContainer={viewport ?? undefined}\n            rootStyle={viewport ? { position: "absolute", inset: 0 } : undefined}'],
  ]);
  edit('components/layout/model-select-modal.tsx', [
    ['import { App, Button, Checkbox, Input, Modal, Tabs }', 'import { useSettingsViewport } from "@/guan/设置视区";\nimport { App, Button, Checkbox, Input, Modal, Tabs }'],
    ['    const { t } = useTranslation();', '    const { t } = useTranslation();\n    const viewport = useSettingsViewport();'],
    ['            styles={{ body: { maxHeight: "62vh", overflowY: "auto" } }}', '            getContainer={viewport ?? undefined}\n            styles={{\n                ...(viewport ? { root: { position: "absolute", inset: 0 }, wrapper: { position: "absolute" }, mask: { position: "absolute" } } : {}),\n                body: { maxHeight: viewport ? "62cqh" : "62vh", overflowY: "auto" },\n            }}'],
  ]);
  return { integration, delta };
}
export function 预审状态通知与设置子层(generate = false) {
  检查运行副本();
  const preview = 构建状态通知与设置子层候选(), types = 检查扩大整批类型(preview), patch = 生成审查差异(preview.delta);
  const sources = ['扩展功能/存储界面/状态通知区.tsx', '开发工具/预审状态通知与设置子层.mjs'];
  const manifest = { 状态: '仅内存候选，尚未批准或装配', 前置记录: 子层前置记录, 前置差异SHA256: preview.integration.差异SHA256,
    文件数: preview.delta.size, 差异SHA256: 哈希(patch), 已接入: false, 已切换3100: false,
    文件: [...preview.delta].map(([文件, item]) => ({ 文件, 原始SHA256: item.原文 === null ? null : 哈希(item.原文), 候选SHA256: 哈希(item.产物) })),
    自有来源与工具: sources.map(文件 => ({ 文件, SHA256: 哈希(readFileSync(join(根目录, 文件))) })), 类型检查: types };
  if (generate) for (const [suffix, value] of [['patch', patch], ['json', JSON.stringify(manifest, null, 2) + '\n']]) {
    const path = join(根目录, '上游适配/待审查/状态通知与设置子层.' + suffix);
    if (existsSync(path)) { if (readFileSync(path, 'utf8') !== value) throw Error('拒绝覆盖已冻结后继'); }
    else writeFileSync(path, value, { flag: 'wx' });
  }
  检查运行副本(); return manifest;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.slice(2).some(value => value !== '--生成审查差异')) throw Error('仅允许内存预审');
  console.log(JSON.stringify(预审状态通知与设置子层(process.argv.includes('--生成审查差异')), null, 2));
}
