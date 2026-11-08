import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { 根目录, 基线, 检查 } from './公共.mjs';
import { 哈希 } from './检查运行副本.mjs';
import { 精确替换, 生成审查差异 } from './检查首批功能适配.mjs';
import { 预审卡片布局类型 } from './预审卡片自动避让.mjs';
import { 构建内置网络代理候选, 读取网络代理自有文件 } from './预审内置网络代理.mjs';
import { 构建原画布图片闭环候选 } from './预审原画布图片闭环.mjs';

const oldRoot = '/Users/guanchengbin/CodexProjects/guan-ai-workbench-projects/guan-ai-workbench';
export const fallbackOldSources = Object.freeze({
  'src/server/index.mjs': '8938c9968dbf3149dfb632cf75bf0743b44272a32378e02b50f42e8004d40710',
  'src/canvas/stores/use-config-store.ts': '79f9121c5cd6ec7dc54f1ceec2f55c94123221a047dc2785cda147ebfffc4c41',
  'src/canvas/components/model-picker.tsx': '16dbc246d886a3126330cffa3780ff7a597625e118b0f0e1644cc462bfd73203',
  'src/canvas/lib/canvas/canvas-generation-helpers.ts': '0fcfa8d1c4297e738db1c5a3b7013d38fdad9bb54077f9294a9288045c3db2e0',
  'src/canvas/components/canvas/canvas-config-node-panel.tsx': '063fc9c0b2038a84b043c50ad8edcc8b7e296cf4fc1eb888afc96603e30e0ae3',
  'src/canvas/components/canvas/canvas-node-prompt-panel.tsx': '94f377ba0b458f339f48d19f88f5b5520f09adb4a59ded211a9ecf4e60ccff82',
});
export const fallbackBackend = ['原版策略.mjs', 'SQLite切换配置.mjs', '受限代理传输.mjs', '渠道切换网关.mjs'];
export const fallbackFrontend = ['原版策略.mjs', '切换客户端.mjs', '浏览器状态.ts', '原版Fallback面板.tsx', '图片路由请求.ts'];
const own = path => 读取网络代理自有文件(path);
const part = (source, start, end) => {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  if (a < 0 || b <= a || source.indexOf(start, a + 1) >= 0) throw Error('Fallback旧版来源片段不唯一');
  return source.slice(a, b);
};
export function fallbackCSS() {
  const server = readFileSync(join(oldRoot, 'src/server/index.mjs'), 'utf8');
  const bridge = server.slice(server.indexOf('const localCanvasSettingsBridgeScript'));
  const lines = bridge.slice(bridge.indexOf('.local-canvas-settings-tabpanel'), bridge.indexOf('document.head.appendChild(style)')).split('\n').map(line => line.trim());
  return lines.filter(line => /^(?:\.local-canvas-(?:settings-(?:tabpanel|card|note)|fallback-)|html\[data-theme="dark"\].*\.local-canvas-(?:fallback-|settings-card))/.test(line))
    .map(line => line.replaceAll('\\"', '"').replaceAll('.local-canvas-', '.guan-fallback .local-canvas-')).join('\n') + '\n';
}
export function buildCombinedCandidate() {
  for (const [path, hash] of Object.entries(fallbackOldSources)) if (哈希(readFileSync(join(oldRoot, path))) !== hash) throw Error('Fallback来源改变：' + path);
  // 冻结的两个候选是输入，不覆盖、不原位接入；共同基于已批准网关17文件。
  for (const [file, hash] of [
    ['内置网络代理基础.patch', 'b023f9e8bdb1b6f2681d3d428fd063abd3d13ea9a6ffbd28cacb7f6e89ed8695'],
    ['内置网络代理基础.json', 'ad87a5c7e9e3601acb50477ad41ce171f78878ff8fb7df77d16f6d0b592bb2bd'],
    ['原画布图片闭环.patch', 'f76be5a2930dea4346817309f3bd1026e31951dbd57ad05309f88f199b52ac12'],
    ['原画布图片闭环.json', 'fe894e9a5bef278e2257374ff98adf089975d345517eaf788bd0ea8481a11b33'],
  ]) if (哈希(readFileSync(join(根目录, '上游适配/待审查', file))) !== hash) throw Error('历史候选改变：' + file);
  const proxy = 构建内置网络代理候选(), image = 构建原画布图片闭环候选(), integration = proxy.integration;
  if (integration.组合包 !== image.integration.组合包) throw Error('候选前置不一致');
  const delta = new Map(proxy.delta);
  for (const [path, value] of image.delta) { if (delta.has(path)) throw Error('未显式合并的候选冲突：' + path); delta.set(path, value); }
  const read = path => delta.get(path)?.产物 ?? readFileSync(join(integration.组合包, path), 'utf8');
  const set = (path, 产物) => {
    const prior = delta.get(path);
    delta.set(path, { 原文: prior ? prior.原文 : existsSync(join(integration.组合包, path)) ? readFileSync(join(integration.组合包, path), 'utf8') : null, 产物 });
  };
  const change = (path, pairs) => set(path, 精确替换(read(path), pairs));
  for (const file of fallbackBackend) set('画布副本/扩展功能/故障切换/' + file, own('扩展功能/故障切换/' + file));
  for (const file of fallbackFrontend) set('画布副本/web/src/guan/fallback/' + file, own('扩展功能/故障切换/' + file));
  set('画布副本/web/src/guan/fallback/原版Fallback.css', fallbackCSS());
  change('服务包/扩展功能/本机服务/数据服务.mjs', [
    ["guan-network-proxy-state-v1$)", "guan-network-proxy-state-v1$|guan-fallback-)"]]);
  change('画布副本/扩展功能/生成网关/渠道凭据网关.mjs', [
    ['coordinator, testOrigins = [] }', 'coordinator, testOrigins = [], requestBytes = requestProviderBytes }'],
    ['await requestProviderBytes({', 'await requestBytes({'],
    ['async execute(id, request, { signal } = {})', 'async execute(id, request, { signal, route } = {})'],
    ['signal, testOrigins });', 'signal, testOrigins, route });'],
  ]);
  change('画布副本/扩展功能/生成任务/SQLite生成任务.mjs', [
    ['{ signal: controller.signal });', '{ signal: controller.signal, taskId: input.id });'],
  ]);
  // 不改冻结的代理基础源码，仅在本组合候选扩展直连租约。
  change('画布副本/扩展功能/网络代理/代理服务.mjs', [
    ["acquireRoute() {\n      requireValue(!closed && !pending && handle?.running(),", "acquireRoute(transport = 'proxy') {\n      requireValue(!closed && !pending && (transport === 'proxy' && state.value.enabled && handle?.running() || transport === 'direct' && !state.value.enabled),"],
    ['Object.freeze({ ...handle.route(), release()', "Object.freeze({ ...(transport === 'proxy' ? handle.route() : {}), release()"],
  ]);
  change('画布副本/扩展功能/网络代理/代理服务装配.mjs', [
    ['acquireRoute: () => proxy.acquireRoute()', 'acquireRoute: transport => proxy.acquireRoute(transport)'],
  ]);
  change('画布副本/扩展功能/生成网关/生成服务装配.mjs', [
    ['import { requireValue }', "import { createRoutedImageGateway } from '../故障切换/渠道切换网关.mjs';\nimport { requestThroughManagedProxy } from '../故障切换/受限代理传输.mjs';\nimport { requireValue }"],
    ['authorize, origin }', 'authorize, origin, networkProxy }'],
    ['  const gateway = createProviderCredentialGateway({ workspace, vault: coordinatedVault, coordinator });',
      `  const base = createProviderCredentialGateway({ workspace, vault: coordinatedVault, coordinator });
  const proxied = createProviderCredentialGateway({ workspace, vault: coordinatedVault, coordinator, requestBytes: async options => {
    const lease = options.route || networkProxy.acquireRoute();
    try { return await requestThroughManagedProxy({ ...options, route: lease }); } finally { if (!options.route) lease.release(); }
  } });
  const gateway = createRoutedImageGateway({ workspace, base, proxied, networkProxy, runTrustedWrite });`],
  ]);
  change('画布副本/扩展功能/生成网关/生成HTTP入口.mjs', [
    ["      else if (exactKeys(value, ['operation', 'binding'])", "      else if (exactKeys(value, ['operation']) && value.operation === 'fallback-load') result = gateway.fallbackLoad();\n      else if (exactKeys(value, ['operation', 'value', 'revision']) && value.operation === 'fallback-save') result = await gateway.fallbackSave(value.value, value.revision);\n      else if (exactKeys(value, ['operation', 'plan']) && value.operation === 'route-plan') result = await gateway.createPlan(value.plan);\n      else if (exactKeys(value, ['operation', 'binding'])"],
    ['result = { ...saved, bytes: saved.bytes.toString(\'base64\') };', "result = { ...saved, routing: gateway.resultRoute?.(saved.id, saved.result.id) ?? null, bytes: saved.bytes.toString('base64') };"],
  ]);
  const launcher = '画布副本/扩展功能/本机服务/受限工作台启动器.mjs';
  const generationLine = read(launcher).split('\n').find(line => line.includes('generation = await assembleGenerationService'));
  const networkBlock = part(read(launcher), '    networkProxy = await assembleNetworkProxyService', '    ready = true;');
  change(launcher, [[generationLine + '\n' + networkBlock, networkBlock + generationLine.replace('workspace, vault:', 'workspace, networkProxy, vault:') + '\n']]);
  change('画布副本/web/src/guan/generation/生成任务客户端.mjs', [
    ['    bind: profile =>', "    fallbackCommand: value => call(value),\n    createPlan: plan => call({ operation: 'route-plan', plan }),\n    bind: profile =>"],
  ]);
  change('画布副本/web/src/guan/sqlite/工作台自动入口.mjs', [
    ["import { authorizeLocalStorage }", "import { createFallbackClient } from '../fallback/切换客户端.mjs';\nimport { authorizeLocalStorage }"],
    ["      Object.defineProperty(view, '__guanGenerationHost',", "      if (Object.getOwnPropertyDescriptor(view, '__guanFallbackHost')) throw Error('本页面已安装Fallback端口。');\n      const fallback = createFallbackClient({ command: value => authorization.generationPort.fallbackCommand(value), notify: event => view.dispatchEvent(new view.CustomEvent(event)) });\n      await fallback.read();\n      Object.defineProperty(view, '__guanFallbackHost', { value: fallback, configurable: false, writable: false });\n      Object.defineProperty(view, '__guanGenerationHost',"],
  ]);
  const store = '画布副本/web/src/stores/use-config-store.ts';
  change(store, [
    ['import { useMemo }', 'import { FALLBACK_MODEL_OPTION, fallbackModelsByCapability, resolveFallbackModel } from "@/guan/fallback/浏览器状态";\nexport { FALLBACK_MODEL_OPTION, fallbackModelsByCapability, hasEnabledFallback, resolveFallbackModel } from "@/guan/fallback/浏览器状态";\nimport { useMemo }'],
    ['    channelMode: "remote" | "local";', '    fallbackRequested?: boolean;\n    fallbackCapability?: ModelCapability;\n    channelMode: "remote" | "local";'],
    ['export type ConfigTabKey = "channels"', 'export type ConfigTabKey = "fallback" | "channels"'],
    ['    for (const model of [currentModel, defaultModel]) {', '    if (currentModel === FALLBACK_MODEL_OPTION || !currentModel && defaultModel === FALLBACK_MODEL_OPTION) return resolveFallbackModel(config, capability) || FALLBACK_MODEL_OPTION;\n    for (const model of [currentModel, defaultModel]) {'],
    ['function isAiConfigReady(config: AiConfig, model: string) {', 'function isAiConfigReady(config: AiConfig, model: string): boolean {\n    if (model === FALLBACK_MODEL_OPTION) return fallbackModelsByCapability(config, "image").some(candidate => isAiConfigReady(config, candidate));'],
    ['export function modelOptionLabel(config: AiConfig, value: string) {', 'export function modelOptionLabel(config: AiConfig, value: string) {\n    if (value === FALLBACK_MODEL_OPTION) return "按 Fallback 自动选择";'],
    ['    const model = (value || "").trim();', '    const model = (value || "").trim();\n    if (model === FALLBACK_MODEL_OPTION) return model;'],
  ]);
  // 使用旧model-picker精确变化：增加原选项/Repeat2图标；保留当前组件的其他样式和翻译。
  change('画布副本/web/src/components/model-picker.tsx', [
    ['import { Cpu }', 'import { useFallbackRevision } from "@/guan/fallback/浏览器状态";\nimport { Cpu, Repeat2 }'],
    ['import { modelOptionLabel,', 'import { FALLBACK_MODEL_OPTION, hasEnabledFallback, modelOptionLabel,'],
    ['    const options = useMemo(', '    const fallbackRevision = useFallbackRevision();\n    const options = useMemo('],
    ['new Set([...(config.channelMode', 'new Set([...(capability === "image" && hasEnabledFallback(capability, config) ? [FALLBACK_MODEL_OPTION] : []), ...(config.channelMode'],
    ['[capability, config, value]);', '[capability, config, value, fallbackRevision]);'],
    ['function ModelLabel({ config, model }: { config: AiConfig; model: string }) {', 'function ModelLabel({ config, model }: { config: AiConfig; model: string }) {\n    if (model === FALLBACK_MODEL_OPTION) return <span className="flex min-w-0 items-center gap-2"><Repeat2 className="size-4 shrink-0 opacity-70" /><span className="truncate">按 Fallback 自动选择</span></span>;'],
    ['function ModelIcon({ model }: { model: string }) {', 'function ModelIcon({ model }: { model: string }) {\n    if (model === FALLBACK_MODEL_OPTION) return <Repeat2 className="size-4 shrink-0 opacity-70" />;'],
  ]);
  const helper = '画布副本/web/src/lib/canvas/canvas-generation-helpers.ts';
  change(helper, [
    ['defaultConfig, resolveModelForCapability', 'defaultConfig, FALLBACK_MODEL_OPTION, resolveModelForCapability'],
    ['        model: resolveModelForCapability(config, node?.metadata?.model, mode),', '        model: resolveModelForCapability(config, node?.metadata?.model, mode),\n        fallbackRequested: mode === "image" && (node?.metadata?.model === FALLBACK_MODEL_OPTION || !node?.metadata?.model && config.imageModel === FALLBACK_MODEL_OPTION),\n        fallbackCapability: mode,'],
  ]);
  for (const file of ['canvas-config-node-panel.tsx', 'canvas-node-prompt-panel.tsx']) change('画布副本/web/src/components/canvas/' + file, [
    ['defaultConfig, resolveModelForCapability', 'defaultConfig, FALLBACK_MODEL_OPTION, resolveModelForCapability'],
    ['        model: resolveModelForCapability(globalConfig, node.metadata?.model, mode),', '        model: resolveModelForCapability(globalConfig, node.metadata?.model, mode),\n        fallbackRequested: mode === "image" && (node.metadata?.model === FALLBACK_MODEL_OPTION || !node.metadata?.model && globalConfig.imageModel === FALLBACK_MODEL_OPTION),\n        fallbackCapability: mode,'],
  ]);
  change('画布副本/web/src/components/layout/app-config-modal.tsx', [
    ['import { App,', 'import { OriginalFallbackPanel } from "@/guan/fallback/原版Fallback面板";\nimport { App,'],
    ['                        key: "local-proxy",', '                        key: "fallback",\n                        label: "Fallback 配置",\n                        forceRender: true,\n                        children: <OriginalFallbackPanel />,\n                    },\n                    {\n                        key: "local-proxy",'],
  ]);
  change('画布副本/web/src/guan/generation/原画布图片调用.ts', [
    ['import { prepareOriginalImageRequest, parseOriginalImageResponse, type GeneratedImage }', 'import { prepareRoutedImageRequest, parseRoutedImageResponse, type PreparedImageRoute, type ImageRoute } from "../fallback/图片路由请求";\nimport { type GeneratedImage }'],
    ['  describe(binding: string):', '  createPlan(plan: PreparedImageRoute["plan"]): Promise<{ binding: string }>;\n  describe(binding: string):'],
    ['  await runCanvasImageTask({', '  let prepared: PreparedImageRoute;\n  await runCanvasImageTask({'],
    ['    prepare: () => prepareOriginalImageRequest(config, prompt, references),', '    prepare: async () => { prepared = await prepareRoutedImageRequest(config, prompt, references, candidate => bindImageChannel(host, candidate)); return prepared.request; },'],
    ['    bind: () => bindImageChannel(host, config),', '    bind: async () => (await host.createPlan(prepared.plan)).binding,'],
    ['async (job: { bytes: string }, receipt:', 'async (job: { bytes: string; routing?: ImageRoute }, receipt:'],
    ['parseOriginalImageResponse(config, job.bytes)', 'parseRoutedImageResponse(config, job.bytes, job.routing)'],
  ]);
  return { integration, delta };
}
export function reviewCombinedCandidate(generate = false) {
  检查(); const preview = buildCombinedCandidate();
  预审卡片布局类型({ integration: preview.integration, delta: new Map([...preview.delta].filter(([p]) => p.startsWith('画布副本/web/') && /\.(?:tsx?|mjs)$/.test(p)).map(([p, v]) => [p.slice('画布副本/'.length), v])) });
  const patch = 生成审查差异(preview.delta);
  const manifest = { 日期: '2026-10-20', 状态: '待具体隔离接入批准；未接管3100', 上游提交: 基线.提交, 文件数: preview.delta.size, 差异SHA256: 哈希(patch),
    前置记录: preview.integration.记录路径 ?? '凭据网关任务-qD9PwY', 前置差异SHA256: preview.integration.差异SHA256,
    完整虚拟类型检查: true, 已接入隔离副本: false, 已接管3100: false, 已访问真实凭据或订阅: false,
    旧来源: fallbackOldSources,
    自有来源: [...new Set([...fallbackBackend, ...fallbackFrontend])].map(file => ({ 文件: '扩展功能/故障切换/' + file, SHA256: 哈希(own('扩展功能/故障切换/' + file)) })),
    工具来源: ['开发工具/预审代理与Fallback闭环.mjs', '开发工具/代理与Fallback闭环.test.mjs', '开发工具/执行代理与Fallback预审.mjs'].map(文件 => ({ 文件, SHA256: 哈希(own(文件)) })),
    文件: [...preview.delta].map(([文件, value]) => ({ 文件, 原始SHA256: value.原文 === null ? null : 哈希(value.原文), 候选SHA256: 哈希(value.产物) })) };
  if (generate) {
    for (const suffix of ['patch', 'json']) if (existsSync(join(根目录, '上游适配/待审查/代理与Fallback图片闭环.' + suffix))) throw Error('拒绝覆盖组合审查原件');
    for (const [suffix, content] of [['patch', patch], ['json', JSON.stringify(manifest, null, 2) + '\n']]) writeFileSync(join(根目录, '上游适配/待审查/代理与Fallback图片闭环.' + suffix), content, { flag: 'wx', mode: 0o600 });
  }
  return manifest;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.slice(2).some(value => value !== '--生成审查差异')) throw Error('本工具不接入副本、不启动服务');
  console.log(JSON.stringify(reviewCombinedCandidate(process.argv.includes('--生成审查差异')), null, 2));
}
