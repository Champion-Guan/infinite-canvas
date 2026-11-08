import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { 根目录 } from './公共.mjs';
import { 哈希 } from './检查运行副本.mjs';
import { 精确替换, 生成审查差异 } from './检查首批功能适配.mjs';
import { 读取迁移扩大整批隔离记录 } from './接入迁移扩大整批隔离副本.mjs';
import { 检查扩大整批类型 } from './预审迁移扩大整批.mjs';

export const 收尾前置记录 = join(根目录, '.运行/迁移扩大整批-tMCsMR/迁移扩大整批接入记录.json');
const oldRoot = '/Users/guanchengbin/CodexProjects/guan-ai-workbench-projects/guan-ai-workbench';
export function 构建迁移扩大整批收尾候选() {
  const integration = 读取迁移扩大整批隔离记录(收尾前置记录), delta = new Map(), sources = [];
  function old(path) { const value = readFileSync(join(oldRoot, path), 'utf8'); sources.push({ 文件: path, SHA256: 哈希(value) }); return value; }
  function edit(path, pairs) {
    const target = '画布副本/web/' + path, original = readFileSync(join(integration.组合包, target), 'utf8');
    delta.set(target, { 原文: original, 产物: 精确替换(original, pairs) });
  }
  const modal = old('src/canvas/components/layout/app-config-modal.tsx');
  const oldStyle = 'styles={{ body: { height: "72vh", maxHeight: "72vh", overflowY: "auto", paddingRight: 12 } }}';
  if (modal.split(oldStyle).length !== 2 || !modal.includes('label: "代理设置",')) throw Error('旧设置来源锚点变化');
  edit('src/components/layout/app-config-modal.tsx', [
    ['styles={{ body: { maxHeight: "72vh", overflowY: "auto", paddingRight: 12 } }}', oldStyle],
    ['label: t("config.tabs.localProxy"),', 'label: "代理设置",'],
  ]);
  for (const locale of ['zh-CN', 'en-US']) {
    const source = old('src/canvas/i18n/locales/' + locale + '.ts');
    const prior = readFileSync(join(integration.副本, 'web/src/i18n/locales/' + locale + '.ts'), 'utf8');
    const lines = text => text.split('\n').filter(line => line.trimStart().startsWith('fileSecurity:'));
    if (lines(source).length !== 1 || lines(prior).length !== 1) throw Error('导出说明锚点变化');
    edit('src/i18n/locales/' + locale + '.ts', [[lines(prior)[0], lines(source)[0]]]);
  }
  edit('src/services/image-storage.ts', [
    ['import { nanoid } from "nanoid";', 'import { nanoid } from "nanoid";\nimport { decodeInlineImage } from "@/guan/media/内嵌图片解码.mjs";'],
    ['    if (typeof input !== "string") return storeImage(input, options);', '    if (typeof input !== "string") return storeImage(input, options);\n    if (/^data:image\\/(?:png|jpe?g|webp);base64,/i.test(input)) {\n        throwIfAborted(options?.signal);\n        return storeImage(decodeInlineImage(input), options);\n    }'],
  ]);
  const helper = '扩展功能/画布迁移扩展/内嵌图片解码.mjs', target = '画布副本/web/src/guan/media/内嵌图片解码.mjs';
  if (existsSync(join(integration.组合包, target))) throw Error('新增解码模块路径已存在');
  delta.set(target, { 原文: null, 产物: readFileSync(join(根目录, helper), 'utf8') });
  return { integration, delta, oldSources: sources, helper };
}
export function 预审迁移扩大整批收尾(generate = false) {
  const preview = 构建迁移扩大整批收尾候选();
  const types = 检查扩大整批类型(preview), patch = 生成审查差异(preview.delta);
  const tools = ['开发工具/预审迁移扩大整批收尾.mjs', '开发工具/迁移扩大整批收尾.test.mjs', preview.helper];
  const manifest = { 状态: '待单独批准，仅虚拟预审', 前置记录: 收尾前置记录, 前置差异SHA256: preview.integration.差异SHA256,
    文件数: preview.delta.size, 差异SHA256: 哈希(patch), 已接入: false, 已切换3100: false,
    文件: [...preview.delta].map(([文件, item]) => ({ 文件, 原始SHA256: item.原文 === null ? null : 哈希(item.原文), 候选SHA256: 哈希(item.产物) })),
    自有来源与工具: tools.map(文件 => ({ 文件, SHA256: 哈希(readFileSync(join(根目录, 文件))) })), 旧来源: preview.oldSources, 类型检查: types };
  if (generate) for (const [suffix, value] of [['patch', patch], ['json', JSON.stringify(manifest, null, 2) + '\n']]) {
    const path = join(根目录, '上游适配/待审查/迁移扩大整批收尾.' + suffix);
    if (existsSync(path)) { if (readFileSync(path, 'utf8') !== value) throw Error('拒绝覆盖冻结收尾产物'); }
    else writeFileSync(path, value, { flag: 'wx' });
  }
  return manifest;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.slice(2).some(value => value !== '--生成审查差异')) throw Error('仅支持虚拟预审及生成审查差异');
  console.log(JSON.stringify(预审迁移扩大整批收尾(process.argv.includes('--生成审查差异')), null, 2));
}
