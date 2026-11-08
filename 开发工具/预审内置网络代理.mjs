import { existsSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { 根目录, 基线, 检查 } from './公共.mjs';
import { 哈希 } from './检查运行副本.mjs';
import { 精确替换, 生成审查差异 } from './检查首批功能适配.mjs';
import { 预审卡片布局类型 } from './预审卡片自动避让.mjs';
import { 读取凭据网关任务隔离记录 } from './接入凭据网关任务隔离副本.mjs';

export const 网络代理前置 = join(根目录, '.运行/凭据网关任务-qD9PwY/凭据网关任务接入记录.json');
export const 网络代理旧来源 = Object.freeze({
  'src/server/proxy-service.mjs': '5d40a1efbf1b6d4592fd4e8ffb96fc4560cfc51174cd2ea06a8994486deffaf8',
  'src/server/proxy-process.mjs': 'c4db430b1e455649f257689001a0fc0b2ecbe1fa686e037abdded360d06125e6',
  'src/server/proxy-supervisor.mjs': 'b1609942df17bf6a3ac3a7b8d3f9577944db5a893edd9c6a9a65d980cd9d5184',
  'src/server/index.mjs': '8938c9968dbf3149dfb632cf75bf0743b44272a32378e02b50f42e8004d40710',
  LICENSE: '4a3ea42531a7fc18b11471baa1676b11ef6c8badee4e02711392d9fdc8f59d58',
});
export const 网络代理后端文件 = Object.freeze(['package.json', 'package-lock.json', '原项目MIT许可.txt', '旧版配置转换.mjs', '旧版进程管理.mjs', '旧版进程守护.mjs',
  '配置边界.mjs', '代理配置存储.mjs', '订阅读取.mjs', '内置代理运行.mjs', '代理服务.mjs', '代理HTTP入口.mjs', '代理服务装配.mjs']);
export const 网络代理前端文件 = Object.freeze(['代理客户端.mjs', '原版网络代理面板.tsx', '原版网络代理.css']);
export function 读取网络代理自有文件(path) {
  const stat = lstatSync(join(根目录, path));
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw Error('网络代理来源不是独立普通文件');
  return readFileSync(join(根目录, path), 'utf8');
}
export function 核验网络代理旧来源() {
  const oldRoot = '/Users/guanchengbin/CodexProjects/guan-ai-workbench-projects/guan-ai-workbench';
  for (const [path, hash] of Object.entries(网络代理旧来源)) if (哈希(readFileSync(join(oldRoot, path))) !== hash) throw Error('旧版代理来源指纹改变：' + path);
  const service = readFileSync(join(oldRoot, 'src/server/proxy-service.mjs'), 'utf8');
  const expected = '// 来源：旧项目 src/server/proxy-service.mjs；保留原配置转换算法。安全限制在调用边界执行。\n' + service.slice(service.indexOf('function decodeBase64Url'), service.indexOf('async function readTextSource'));
  if (读取网络代理自有文件('扩展功能/网络代理/旧版配置转换.mjs') !== expected.trimEnd() + '\n') throw Error('旧版代理转换算法偏离来源');
  for (const [source, target] of [['proxy-supervisor.mjs', '旧版进程守护.mjs'], ['proxy-process.mjs', '旧版进程管理.mjs']]) {
    const expected = readFileSync(join(oldRoot, 'src/server', source), 'utf8').replace('./proxy-supervisor.mjs', './旧版进程守护.mjs');
    if (读取网络代理自有文件('扩展功能/网络代理/' + target) !== expected.trimEnd() + '\n') throw Error('旧版代理守护偏离来源');
  }
  const server = readFileSync(join(oldRoot, 'src/server/index.mjs'), 'utf8');
  const bridge = server.slice(server.indexOf('const localCanvasSettingsBridgeScript'));
  const rules = bridge.slice(bridge.indexOf('.local-canvas-settings-tabpanel'), bridge.indexOf('document.head.appendChild(style)')).split('\n')
    .map(line => line.trim()).filter(line => /^(?:\.local-canvas-(?:settings-|proxy-(?:section|state))|html\[data-theme="dark"\].*\.local-canvas-settings-)/.test(line));
  const css = rules.map(line => line.replaceAll('\\"', '"').replaceAll('.local-canvas-', '.guan-network-proxy .local-canvas-')).join('\n') + '\n';
  if (读取网络代理自有文件('扩展功能/网络代理/原版网络代理.css') !== css) throw Error('网络代理CSS偏离旧版精确选段和局部作用域变换');
  return true;
}
export function 构建内置网络代理候选() {
  核验网络代理旧来源();
  const integration = 读取凭据网关任务隔离记录(网络代理前置), delta = new Map();
  const add = (path, value) => { if (existsSync(join(integration.组合包, path))) throw Error('代理新增路径已经存在'); delta.set(path, { 原文: null, 产物: value }); };
  const change = (path, pairs) => { const 原文 = readFileSync(join(integration.组合包, path), 'utf8'); delta.set(path, { 原文, 产物: 精确替换(原文, pairs) }); };
  for (const file of 网络代理后端文件) add('画布副本/扩展功能/网络代理/' + file, 读取网络代理自有文件('扩展功能/网络代理/' + file));
  for (const file of 网络代理前端文件) add('画布副本/web/src/guan/network-proxy/' + file, 读取网络代理自有文件('扩展功能/网络代理/' + file));
  change('服务包/扩展功能/本机服务/数据服务.mjs', [
    ["/^(?:provider:|guan-generation-ledger-v1$)/", "/^(?:provider:|guan-generation-ledger-v1$|guan-network-proxy-state-v1$)/"],
  ]);
  change('画布副本/扩展功能/本机服务/受限工作台启动器.mjs', [
    ["import { createServer } from 'node:http';", "import { createServer } from 'node:http';\nimport { tmpdir } from 'node:os';\nimport { assembleNetworkProxyService } from '../网络代理/代理服务装配.mjs';"],
    ["endpoint = { hostname: '127.0.0.1', port: 0 } }", "endpoint = { hostname: '127.0.0.1', port: 0 }, networkProxyOptions = {} }"],
    ['credentialPort, generation, closing = null;', 'credentialPort, generation, networkProxy, closing = null;'],
    ['    if (await generation.handle(req, res)) return;', '    if (await networkProxy.handle(req, res)) return;\n    if (await generation.handle(req, res)) return;'],
    ['    generation?.assertCanClose();\n    ready = false;', '    generation?.assertCanClose();\n    networkProxy?.assertCanClose();\n    ready = false;'],
    ['for (const action of [() => generation?.close(),', 'for (const action of [() => networkProxy?.close(), () => generation?.close(),'],
    ['    ready = true;', "    networkProxy = await assembleNetworkProxyService({ workspace, vault: credentialPort, origin, runTrustedWrite: operation => service.runTrustedWrite(operation), authorize: request => gateway.assertGenerationPage(request),\n      runtimeOptions: { runtimeParent: join(realpathSync(tmpdir()), 'ai-workbench-proxy-' + workspace.workspaceId), ...networkProxyOptions } });\n    ready = true;"],
    ['generation: generation.getStatus() };', 'generation: generation.getStatus(), networkProxy: networkProxy.getStatus() };'],
    ['        generation?.assertCanClose(); //', '        networkProxy?.assertCanClose();\n        generation?.assertCanClose(); //'],
  ]);
  change('画布副本/web/src/guan/sqlite/本机授权客户端.mjs', [
    ["import { createGenerationClient } from '../generation/生成任务客户端.mjs';", "import { createGenerationClient } from '../generation/生成任务客户端.mjs';\nimport { createNetworkProxyClient } from '../network-proxy/代理客户端.mjs';"],
    ["...(path === 'generation' ? { 'X-Guan-Generation-Protocol': 'guan-generation.v1' } : {})", "...(path === 'network-proxy' ? { 'X-Guan-Proxy-Protocol': 'guan-network-proxy.v1' } : {}), ...(path === 'generation' ? { 'X-Guan-Generation-Protocol': 'guan-generation.v1' } : {})"],
    ['signal: AbortSignal.timeout(5000)', "signal: AbortSignal.timeout(path === 'network-proxy' ? 180_000 : 5000)"],
    ["path === 'generation' ? result?.protocol === 'guan-generation.v1'", "path === 'network-proxy' ? result?.protocol === 'guan-network-proxy.v1' : path === 'generation' ? result?.protocol === 'guan-generation.v1'"],
    ['    url: exchange.dataURL,', "    url: exchange.dataURL,\n    networkProxyPort: createNetworkProxyClient({ command(value) {\n      requireValue(!closed && now() < exchange.expiresAt, 'authorization_expired', '页面授权已结束。', 401);\n      return post('network-proxy', value, capability);\n    } }),"],
  ]);
  change('画布副本/web/src/guan/sqlite/工作台自动入口.mjs', [
    ["      Object.defineProperty(view, '__guanGenerationHost',", "      if (Object.getOwnPropertyDescriptor(view, '__guanNetworkProxyHost')) throw Error('本页面已安装网络代理端口。');\n      Object.defineProperty(view, '__guanNetworkProxyHost', { value: authorization.networkProxyPort, configurable: false, writable: false });\n      Object.defineProperty(view, '__guanGenerationHost',"],
  ]);
  change('画布副本/web/src/components/layout/config-local-proxy.tsx', [
    ['import { App, Button, Form, Input, Switch }', 'import { OriginalNetworkProxyPanel } from "@/guan/network-proxy/原版网络代理面板";\nimport { App, Button, Form, Input, Switch }'],
    ['        <Form layout="vertical" requiredMark={false}>', '        <>\n        <OriginalNetworkProxyPanel />\n        <Form layout="vertical" requiredMark={false}>'],
    ['        </Form>\n', '        </Form>\n        </>\n'],
  ]);
  return { integration, delta };
}
export function 预审内置网络代理(generate = false) {
  检查(); const preview = 构建内置网络代理候选();
  // 只把前端源文件交给虚拟TS检查，后端.mjs由Node测试与ESLint验证，不假装在浏览器类型检查中验证Node。
  预审卡片布局类型({ integration: preview.integration, delta: new Map([...preview.delta].filter(([p]) => p.startsWith('画布副本/web/') && /\.(?:tsx?|mjs)$/.test(p)).map(([p, v]) => [p.slice('画布副本/'.length), v])) });
  const patch = 生成审查差异(preview.delta);
  const manifest = { 日期: '2026-10-20', 状态: '待具体隔离接入批准；未装配候选、未接管3100、未执行真实Mihomo', 上游提交: 基线.提交,
    前置记录: 网络代理前置, 前置差异SHA256: preview.integration.差异SHA256, 差异SHA256: 哈希(patch), 文件数: preview.delta.size,
    类型预审通过: true, 真实代理核心已分发: false, 已接通图片网关: false, 已访问真实订阅或凭据: false, 已接管3100: false,
    来源: Object.entries(网络代理旧来源).map(([文件, SHA256]) => ({ 文件, SHA256 })),
    自有来源: [...网络代理后端文件, ...网络代理前端文件].map(file => ({ 文件: '扩展功能/网络代理/' + file, SHA256: 哈希(读取网络代理自有文件('扩展功能/网络代理/' + file)) })),
    工具来源: ['开发工具/预审内置网络代理.mjs', '开发工具/内置网络代理.test.mjs', '开发工具/内置代理模拟核心.mjs', '开发工具/执行内置代理基础预审.mjs'].map(文件 => ({ 文件, SHA256: 哈希(读取网络代理自有文件(文件)) })),
    文件: [...preview.delta].map(([文件, v]) => ({ 文件, 原始SHA256: v.原文 === null ? null : 哈希(v.原文), 候选SHA256: 哈希(v.产物) })) };
  if (generate) {
    for (const suffix of ['patch', 'json']) if (existsSync(join(根目录, '上游适配/待审查/内置网络代理基础.' + suffix))) throw Error('拒绝覆盖代理审查原件');
    for (const [suffix, value] of [['patch', patch], ['json', JSON.stringify(manifest, null, 2) + '\n']]) writeFileSync(join(根目录, '上游适配/待审查/内置网络代理基础.' + suffix), value, { flag: 'wx', mode: 0o600 });
  }
  return manifest;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.slice(2).some(value => value !== '--生成审查差异')) throw Error('本工具仅预审，不接入运行副本');
  console.log(JSON.stringify(预审内置网络代理(process.argv.includes('--生成审查差异')), null, 2));
}
