import { existsSync, lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { 根目录 } from './公共.mjs';
import { 哈希, 检查运行副本 } from './检查运行副本.mjs';
import { 精确替换, 生成审查差异 } from './检查首批功能适配.mjs';
import { 检查扩大整批类型 } from './模型价格类型检查.mjs';
import { 读取状态通知与设置子层隔离记录 } from './接入状态通知与设置子层隔离副本.mjs';

export const 价格清理前置记录 = join(根目录, '.运行/状态通知与设置子层-ts2CQG/子层接入记录.json');
export const 价格旧目录 = '/Users/guanchengbin/CodexProjects/guan-ai-workbench-projects/guan-ai-workbench';
export const 价格旧来源 = Object.freeze({
  'src/canvas/components/layout/model-select-modal.tsx': '0de1a9de72e0d55b15ddf7ac0607984403ffc47e032b5cfcb606e925fd9dd664',
  'src/canvas/components/layout/channel-editor-drawer.tsx': '85c3c129d8476a46b8909569e879f9153b5736d22fff916e1d6c6d3cc5263658',
  'src/canvas/stores/use-config-store.ts': '79f9121c5cd6ec7dc54f1ceec2f55c94123221a047dc2785cda147ebfffc4c41',
});
function oldSources() {
  return new Map(Object.entries(价格旧来源).map(([path, hash]) => {
    const file = join(价格旧目录, path), stat = lstatSync(file), value = readFileSync(file, 'utf8');
    if (!stat.isFile() || stat.nlink !== 1 || realpathSync(file) !== file || 哈希(value) !== hash) throw Error('价格旧来源改变：' + path);
    return [path.split('/').at(-1), value];
  }));
}
function segment(value, start, end) {
  if (value.split(start).length !== 2 || value.split(end).length !== 2) throw Error('旧来源片段不唯一');
  return value.slice(value.indexOf(start), value.indexOf(end));
}
export function 构建模型价格与成功图片清理候选() {
  const integration = 读取状态通知与设置子层隔离记录(价格清理前置记录), delta = new Map(), old = oldSources();
  const target = path => '画布副本/web/src/' + path;
  const read = path => readFileSync(join(integration.组合包, target(path)), 'utf8');
  const set = (path, value) => delta.set(target(path), { 原文: read(path), 产物: value });
  const edit = (path, pairs) => set(path, 精确替换(read(path), pairs));
  const store = old.get('use-config-store.ts');
  edit('stores/use-config-store.ts', [
    ['    script?: string;\n};', '    script?: string;\n    price?: number;\n};'],
    [segment(read('stores/use-config-store.ts'), 'export function normalizeChannelModels(', 'export function createModelChannel('), segment(store, 'export function normalizeChannelModels(', 'export function createModelChannel(')],
  ]);
  // 逐字节继承旧组件，再保留已批准的安全渠道出口和设置视区。
  const modal = 精确替换(old.get('model-select-modal.tsx'), [
    ['import { App,', 'import { useSettingsViewport } from "@/guan/设置视区";\nimport { App,'],
    ['import { secureChannel } from "@/services/secure-credentials";\n', ''],
    ['    const { t } = useTranslation();', '    const { t } = useTranslation();\n    const viewport = useSettingsViewport();'],
    ['    }, [open, selectedNames]);', '    }, [open, selectedNames, channel]);'],
    ['fetchChannelModels(await secureChannel(channel))', 'fetchChannelModels(channel)'],
    ['...(typeof price === "number" ? { price } : {})', 'price'],
    ['            styles={{ body: { maxHeight: "62vh", overflowY: "auto" } }}', segment(read('components/layout/model-select-modal.tsx'), '            getContainer={viewport ?? undefined}', '            footer={') .trimEnd()],
  ]);
  set('components/layout/model-select-modal.tsx', modal);
  const priceInput = old.get('channel-editor-drawer.tsx').split('\n').find(line => line.includes('<InputNumber'));
  if (!priceInput) throw Error('旧版渠道价格输入不存在');
  edit('components/layout/channel-editor-drawer.tsx', [
    ['Button, Drawer, Input, Segmented', 'Button, Drawer, Input, InputNumber, Segmented'],
    ['    const applySelection = (names: string[]) => {', '    const applySelection = (models: ChannelModel[]) => {'],
    ['setModels(names.map((name) => map.get(name) || { name, capability: guessCapability(name) }));', 'setModels(models.map((model) => ({ ...map.get(model.name), ...model, capability: model.capability || guessCapability(model.name) })));'],
    ['                                <Segmented size="small"', priceInput + '\n                                <Segmented size="small"'],
  ]);
  set('guan/generation/图片任务确认恢复.mjs', readFileSync(join(根目录, '扩展功能/画布生成/图片任务确认恢复与清理.mjs'), 'utf8'));
  edit('guan/generation/图片任务确认状态.tsx', [
    ['createImageConfirmationRecovery, imageConfirmationTargets', 'createImageConfirmationRecovery, imageConfirmationTargets, imageConfirmationErrorKey'],
    ['// 与图片重试按钮分开', 'export type ConfirmedImageTarget = { id: string; productId: string; nodeId: string; responseHash: string };\n\n// 与图片重试按钮分开'],
    ['{ productId, nodes, ready }: { productId: string; nodes: CanvasNodeData[]; ready: boolean }', '{ productId, nodes, ready, afterConfirmed }: { productId: string; nodes: CanvasNodeData[]; ready: boolean; afterConfirmed: (target: ConfirmedImageTarget) => Promise<void> }'],
    ['  const [status, setStatus]', '  const errorsKey = useMemo(() => imageConfirmationErrorKey(nodes), [nodes]);\n  const [status, setStatus]'],
    ['serialize: serializeProductResult, isCurrent: () => active', 'serialize: serializeProductResult, afterConfirmed, isCurrent: () => active'],
    ['  }, [productId, ready, targetsKey]);', '  }, [productId, ready, targetsKey, errorsKey, afterConfirmed]);'],
  ]);
  edit('pages/canvas/project.tsx', [
    ['import { ImageTaskConfirmation }', 'import { clearConfirmedImageErrors } from "@/guan/generation/图片任务确认恢复.mjs";\nimport { ImageTaskConfirmation, type ConfirmedImageTarget }'],
    ['    const recordImageGatewayTask = useCallback(', `    const pendingImageErrorSaves = useRef(new Set<string>());
    const clearConfirmedImageError = useCallback(async (target: ConfirmedImageTarget) => {
        if (target.productId !== projectId || restoredProjectIdRef.current !== projectId) return;
        const previous = nodesRef.current;
        const next = clearConfirmedImageErrors(previous, target) as CanvasNodeData[];
        if (next !== previous) {
            pendingImageErrorSaves.current.add(target.id);
            setNodes(next);
        }
        // 清理保存失败时保留重试标记；下次仅保存，不重新交付或生成图片。
        if (pendingImageErrorSaves.current.has(target.id)) {
            await saveProductCanvas(projectId);
            pendingImageErrorSaves.current.delete(target.id);
        }
    }, [projectId, setNodes]);

    const recordImageGatewayTask = useCallback(`],
    ['<ImageTaskConfirmation productId={projectId} nodes={nodes} ready={projectLoaded} />', '<ImageTaskConfirmation productId={projectId} nodes={nodes} ready={projectLoaded} afterConfirmed={clearConfirmedImageError} />'],
  ]);
  return { integration, delta };
}
export function 预审模型价格与成功图片清理(generate = false) {
  检查运行副本();
  const preview = 构建模型价格与成功图片清理候选(), types = 检查扩大整批类型(preview), patch = 生成审查差异(preview.delta);
  const sources = ['扩展功能/画布生成/图片任务确认恢复与清理.mjs', '开发工具/预审模型价格与成功图片清理.mjs', '开发工具/模型价格类型检查.mjs', '开发工具/模型价格类型依赖只读镜像.mjs'];
  const manifest = { 状态: '仅内存候选，尚未批准或装配', 前置记录: 价格清理前置记录, 前置差异SHA256: preview.integration.差异SHA256,
    文件数: preview.delta.size, 差异SHA256: 哈希(patch), 已接入: false, 已切换3100: false,
    文件: [...preview.delta].map(([文件, item]) => ({ 文件, 原始SHA256: 哈希(item.原文), 候选SHA256: 哈希(item.产物) })),
    旧来源: 价格旧来源, 自有来源与工具: sources.map(文件 => ({ 文件, SHA256: 哈希(readFileSync(join(根目录, 文件))) })), 类型检查: types };
  if (generate) for (const [suffix, value] of [['patch', patch], ['json', JSON.stringify(manifest, null, 2) + '\n']]) {
    const path = join(根目录, '上游适配/待审查/模型价格与成功图片清理.' + suffix);
    if (existsSync(path)) { if (readFileSync(path, 'utf8') !== value) throw Error('拒绝覆盖冻结候选'); }
    else writeFileSync(path, value, { flag: 'wx' });
  }
  检查运行副本(); return manifest;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.slice(2).some(value => value !== '--生成审查差异')) throw Error('仅允许内存预审');
  console.log(JSON.stringify(预审模型价格与成功图片清理(process.argv.includes('--生成审查差异')), null, 2));
}
