import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { 根目录 } from './公共.mjs';
import { 哈希, 检查运行副本 } from './检查运行副本.mjs';
import { 精确替换, 生成审查差异 } from './检查首批功能适配.mjs';
import { 读取迁移扩大整批收尾隔离记录 } from './接入迁移扩大整批收尾隔离副本.mjs';
import { 检查扩大整批类型 } from './预审迁移扩大整批.mjs';

export const 确认边界前置记录 = join(根目录, '.运行/迁移扩大整批收尾-dhB3YW/收尾接入记录.json');
export const 确认边界自有文件 = [
  '扩展功能/画布生成/图片任务确认恢复.mjs', '扩展功能/画布生成/图片任务确认状态.tsx',
  '扩展功能/存储界面/设置视区.tsx', '开发工具/预审任务确认与设置边界.mjs',
  '开发工具/任务确认与设置边界.test.mjs', '开发工具/检查任务确认与设置边界代码.mjs',
  '开发工具/虚拟构建任务确认与设置边界.mjs',
];
export function 构建任务确认与设置边界候选() {
  const integration = 读取迁移扩大整批收尾隔离记录(确认边界前置记录), delta = new Map();
  function edit(path, pairs) {
    const target = '画布副本/web/src/' + path, original = readFileSync(join(integration.组合包, target), 'utf8');
    delta.set(target, { 原文: original, 产物: 精确替换(original, pairs) });
  }
  function add(own, path, pairs = []) {
    const target = '画布副本/web/src/' + path;
    if (existsSync(join(integration.组合包, target))) throw Error('拒绝覆盖新增候选路径');
    delta.set(target, { 原文: null, 产物: 精确替换(readFileSync(join(根目录, own), 'utf8'), pairs) });
  }
  edit('guan/generation/生成任务客户端.mjs', [[
    '    async deliver(task, { applyAndSave } = {}) {',
    `    // 独立确认已保存结果：没有result/submit/bind，也不重写图片或新建任务。
    async confirmSaved(task, { responseHash } = {}) {
      requireValue(/^[0-9a-f]{64}$/.test(responseHash), 'generation_receipt_invalid', '原任务收据摘要无效。', 409);
      const job = match(await call({ operation: 'get', id: task.id }), task);
      requireValue(job.state === 'succeeded' && job.result?.id === responseHash, 'generation_receipt_mismatch', '任务结果与原卡片收据不符，未确认完成。', 409);
      if (job.applied) return job;
      const checkpoint = await call({ operation: 'checkpoint', id: task.id });
      const applied = match(await call({ operation: 'applied', id: task.id, checkpoint }), task);
      requireValue(applied.state === 'succeeded' && applied.applied && applied.result?.id === responseHash,
        'generation_ack_invalid', '任务完成确认尚未收到有效响应，请保留原任务。', 503);
      return applied;
    },
    async deliver(task, { applyAndSave } = {}) {`,
  ]]);
  edit('guan/generation/图片任务衔接.mjs', [
    ['return await host.deliver(task, { applyAndSave: saved => serializeProductResult(target.productId, async () => {', 'return await serializeProductResult(target.productId, () => host.deliver(task, { applyAndSave: async saved => {'],
    ['      return host.checkpoint(task.id);\n    }) });', '      return host.checkpoint(task.id);\n    } }));'],
  ]);
  add('扩展功能/画布生成/图片任务确认恢复.mjs', 'guan/generation/图片任务确认恢复.mjs', [["'../本机存储/协议.mjs'", "'../sqlite/协议.mjs'"]]);
  add('扩展功能/画布生成/图片任务确认状态.tsx', 'guan/generation/图片任务确认状态.tsx');
  edit('pages/canvas/project.tsx', [
    ['import { requestCanvasImage, type CanvasImageTask }', 'import { ImageTaskConfirmation } from "@/guan/generation/图片任务确认状态";\nimport { requestCanvasImage, type CanvasImageTask }'],
    ['        </main></ExcelCanvasScope>', '            <ImageTaskConfirmation productId={projectId} nodes={nodes} ready={projectLoaded} />\n        </main></ExcelCanvasScope>'],
  ]);
  add('扩展功能/存储界面/设置视区.tsx', 'guan/设置视区.tsx');
  edit('layouts/user-layout.tsx', [
    ['import type { ReactNode } from "react";', 'import type { ReactNode } from "react";\nimport { SettingsViewport } from "@/guan/设置视区";\nimport { AppConfigModal } from "@/components/layout/app-config-modal";'],
    ['<div className="min-h-0 flex-1 overflow-hidden">{children}</div>', '<SettingsViewport>{children}<AppConfigModal /></SettingsViewport>'],
  ]);
  edit('guan/旧版首页顶栏.tsx', [
    ['import { AppConfigModal } from "@/components/layout/app-config-modal";\n', ''],
    ['  </header><AppConfigModal /></>;', '  </header></>;'],
  ]);
  edit('components/layout/app-config-modal.tsx', [
    ['import { OriginalFallbackPanel }', 'import { useSettingsViewport } from "@/guan/设置视区";\nimport { OriginalFallbackPanel }'],
    ['export function AppConfigModal() {\n', 'export function AppConfigModal() {\n    const viewport = useSettingsViewport();\n'],
    ['            styles={{ body: { height: "72vh", maxHeight: "72vh", overflowY: "auto", paddingRight: 12 } }}', `            getContainer={viewport ?? undefined}
            styles={{
                ...(viewport ? { root: { position: "absolute", inset: 0 }, wrapper: { position: "absolute" }, mask: { position: "absolute" } } : {}),
                body: { height: viewport ? "72cqh" : "72vh", maxHeight: viewport ? "72cqh" : "72vh", overflowY: "auto", paddingRight: 12 },
            }}`],
  ]);
  return { integration, delta };
}
export function 预审任务确认与设置边界(generate = false) {
  检查运行副本();
  const preview = 构建任务确认与设置边界候选(), types = 检查扩大整批类型(preview), patch = 生成审查差异(preview.delta);
  const oldRoot = '/Users/guanchengbin/CodexProjects/guan-ai-workbench-projects/guan-ai-workbench';
  const manifest = { 状态: '待单独批准，仅虚拟预审', 前置记录: 确认边界前置记录, 前置差异SHA256: preview.integration.差异SHA256,
    文件数: preview.delta.size, 差异SHA256: 哈希(patch), 已接入: false, 已切换3100: false,
    文件: [...preview.delta].map(([文件, item]) => ({ 文件, 原始SHA256: item.原文 === null ? null : 哈希(item.原文), 候选SHA256: 哈希(item.产物) })),
    自有来源与工具: 确认边界自有文件.map(文件 => ({ 文件, SHA256: 哈希(readFileSync(join(根目录, 文件))) })),
    旧来源: ['src/server/index.mjs', 'src/canvas/components/layout/app-config-modal.tsx'].map(文件 => ({ 文件, SHA256: 哈希(readFileSync(join(oldRoot, 文件))) })), 类型检查: types };
  if (generate) for (const [suffix, value] of [['patch', patch], ['json', JSON.stringify(manifest, null, 2) + '\n']]) {
    const path = join(根目录, '上游适配/待审查/任务确认与设置边界.' + suffix);
    if (existsSync(path)) { if (readFileSync(path, 'utf8') !== value) throw Error('拒绝覆盖冻结审查产物'); }
    else writeFileSync(path, value, { flag: 'wx' });
  }
  检查运行副本(); return manifest;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.slice(2).some(value => value !== '--生成审查差异')) throw Error('仅支持虚拟预审及生成审查差异');
  console.log(JSON.stringify(预审任务确认与设置边界(process.argv.includes('--生成审查差异')), null, 2));
}
