import { existsSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { 根目录, 基线 } from './公共.mjs';
import { 哈希 } from './检查运行副本.mjs';
import { 精确替换, 生成审查差异 } from './检查首批功能适配.mjs';
import { 读取Excel删除字体平滑隔离记录 } from './接入Excel删除字体平滑隔离副本.mjs';
import { 预审卡片布局类型 } from './预审卡片自动避让.mjs';

export const 网关任务前置 = join(根目录, '.运行/Excel删除字体平滑-cK9Dtz/Excel删除字体平滑接入记录.json');
export const 网关旧来源指纹 = Object.freeze({
  'src/server/secure-provider-proxy.mjs': 'b59b4818a73eadcabf71d07d489eea44f430fe32914781eca44111442502cdc5',
  'src/server/credential-registry.mjs': '73b308b1d5bdb03323e721a2e2ec30f98125d8e9789c05d7fa2e8e91db79e56f',
  'src/canvas/services/secure-credentials.ts': '68470dc410322254328aef33a15a930c2d7887c38c6033d1d2eb230575b0b228',
  'src/canvas/services/api/image.ts': '671f45c36a23e312047cb15d85db6b802454e759a342fc99ab763da8500f70eb',
  'src/canvas/pages/canvas/project.tsx': '1fa007d1bdac287c1bee26ac1e186d5a69e544d89b7c57907843bfc8678e0bfb',
});
export const 网关自有来源 = Object.freeze([
  '扩展功能/生成网关/生成协议.mjs', '扩展功能/生成网关/受限请求规划.mjs', '扩展功能/生成网关/受限上游传输.mjs',
  '扩展功能/生成网关/渠道凭据网关.mjs', '扩展功能/生成网关/生成HTTP入口.mjs', '扩展功能/生成网关/生成服务装配.mjs',
  '扩展功能/生成任务/SQLite生成任务.mjs', '扩展功能/生成任务/生成任务客户端.mjs', '扩展功能/生成任务/画布保存核验.mjs',
  '扩展功能/本机存储/分片值编码.mjs',
]);
function readOwned(path) {
  const file = join(根目录, path), stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw Error('网关来源不是独立普通文件');
  return readFileSync(file, 'utf8');
}
// 只输出内存候选和待审查快照。不装配/修改任何运行副本，不启动3100。
export function 构建凭据网关任务候选() {
  for (const [path, expected] of Object.entries(网关旧来源指纹)) {
    const file = join('/Users/guanchengbin/CodexProjects/guan-ai-workbench-projects/guan-ai-workbench', path), stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || 哈希(readFileSync(file)) !== expected) throw Error('旧生成来源已改变，停止，不擅自更新锁定指纹');
  }
  const integration = 读取Excel删除字体平滑隔离记录(网关任务前置), delta = new Map();
  const add = (path, source) => { const file = join(integration.组合包, path); if (existsSync(file)) throw Error('新增网关路径已存在：' + path); delta.set(path, { 原文: null, 产物: source }); };
  const change = (path, pairs) => { const 原文 = readFileSync(join(integration.组合包, path), 'utf8'); delta.set(path, { 原文, 产物: 精确替换(原文, pairs) }); };
  for (const path of 网关自有来源) add('画布副本/' + path, readOwned(path));
  add('画布副本/web/src/guan/generation/生成协议.mjs', readOwned('扩展功能/生成网关/生成协议.mjs').replace("'../本机存储/协议.mjs'", "'../sqlite/协议.mjs'"));
  add('画布副本/web/src/guan/generation/生成任务客户端.mjs', readOwned('扩展功能/生成任务/生成任务客户端.mjs')
    .replace("'../本机存储/协议.mjs'", "'../sqlite/协议.mjs'").replace("'../生成网关/生成协议.mjs'", "'./生成协议.mjs'"));
  change('服务包/扩展功能/本机服务/数据服务.mjs', [
    ["        requireValue(request.method === 'PUT' && second, 'method_denied', '文档只支持读取和指定版本保存。', 405);",
      "        requireValue(request.method === 'PUT' && second, 'method_denied', '文档只支持读取和指定版本保存。', 405);\n        requireValue(!(first === 'extension' && /^(?:provider:|guan-generation-ledger-v1$)/.test(second)), 'reserved_generation_document', '生成绑定与任务账本只能由可信本机服务写入。', 403);"],
    ['    getWriteStatus: writeGate.getStatus,', "    getWriteStatus: writeGate.getStatus,\n    runTrustedWrite(operation) { return writeGate.runWrite(() => { requireValue(!stopping, 'service_stopping', '本机服务正在停止。', 503); return operation(); }); },"],
  ]);
  change('画布副本/扩展功能/本机服务/本机授权网关.mjs', [
    ['    getStatus() { const time = clock();', [
      '    assertGenerationPage(request) {',
      '      live();',
      "      requireValue(request.headers.host === host && request.headers.origin === origin && (!request.headers['sec-fetch-site'] || request.headers['sec-fetch-site'] === 'same-origin'), 'authorization_origin_denied', '生成请求必须来自当前工作台。', 403);",
      "      const capability = request.headers.authorization?.match(/^Bearer ([0-9a-f]{64})$/)?.[1];",
      '      const page = capability && pages.get(digest(capability));',
      "      requireValue(page, 'authorization_denied', '本页面授权已结束。', 401);",
      '      page.port.initialize();',
      '    },',
      '    getStatus() { const time = clock();',
    ].join('\n')],
  ]);
  change('画布副本/扩展功能/本机服务/受限工作台启动器.mjs', [
    ["import { createServer } from 'node:http';", "import { createServer } from 'node:http';\nimport { assembleGenerationService } from '../生成网关/生成服务装配.mjs';"],
    ['credentialPort, closing = null;', 'credentialPort, generation, closing = null;'],
    ['    if (await gateway.handle(req, res)) return;', '    if (await generation.handle(req, res)) return;\n    if (await gateway.handle(req, res)) return;'],
    ['  async function cleanup() {\n    ready = false;', '  async function cleanup() {\n    generation?.assertCanClose();\n    ready = false;'],
    ['        if (!closing) closing = cleanup();', '        generation?.assertCanClose(); // 忙时不缓存拒绝的closing，任务结束后仍可正常关闭。\n        if (!closing) closing = cleanup();'],
    ['for (const action of [() => backup?.stop()', 'for (const action of [() => generation?.close(), () => backup?.stop()'],
    ["    gateway = createLocalAuthorizationGateway({ origin, dataURL: service.url, controller, credentialPort });\n    ready = true;",
      "    gateway = createLocalAuthorizationGateway({ origin, dataURL: service.url, controller, credentialPort });\n    requireValue(typeof service.runTrustedWrite === 'function', 'generation_write_coordination_required', '生成任务需要同一写入协调。');\n    generation = await assembleGenerationService({ workspace, vault: credentialPort, origin, runTrustedWrite: operation => service.runTrustedWrite(operation), authorize: request => gateway.assertGenerationPage(request) });\n    ready = true;"],
    ['backup: backup.getStatus() };', 'backup: backup.getStatus(), generation: generation.getStatus() };'],
  ]);
  change('画布副本/web/src/guan/sqlite/本机授权客户端.mjs', [
    ["import { createCredentialClient } from './凭据客户端.mjs';", "import { createCredentialClient } from './凭据客户端.mjs';\nimport { createGenerationClient } from '../generation/生成任务客户端.mjs';"],
    ["path === 'credentials' ? result?.format === 'guan-credentials.v1' : result?.protocol === protocol", "path === 'credentials' ? result?.format === 'guan-credentials.v1' : path === 'generation' ? result?.protocol === 'guan-generation.v1' : result?.protocol === protocol"],
    ["...(capability ? { Authorization: 'Bearer ' + capability } : {})", "...(path === 'generation' ? { 'X-Guan-Generation-Protocol': 'guan-generation.v1' } : {}), ...(capability ? { Authorization: 'Bearer ' + capability } : {})"],
    ['    url: exchange.dataURL,', [
      '    url: exchange.dataURL,',
      '    generationPort: createGenerationClient({ command(value) {',
      "      requireValue(!closed && now() < exchange.expiresAt, 'authorization_expired', '页面授权已结束。', 401);",
      "      return post('generation', value, capability);",
      '    } }),',
    ].join('\n')],
  ]);
  change('画布副本/web/src/guan/sqlite/工作台自动入口.mjs', [
    ["      Object.defineProperty(view, '__guanSQLiteHost',", "      if (Object.getOwnPropertyDescriptor(view, '__guanGenerationHost')) throw Error('本页面已安装生成端口。');\n      Object.defineProperty(view, '__guanGenerationHost', { value: authorization.generationPort, configurable: false, writable: false });\n      Object.defineProperty(view, '__guanSQLiteHost',"],
  ]);
  return { integration, delta };
}
export function 预审凭据网关任务(generate = false) {
  const preview = 构建凭据网关任务候选();
  const virtual = { integration: { ...preview.integration, 副本: preview.integration.副本 }, delta: new Map([...preview.delta].filter(([path]) => path.startsWith('画布副本/')).map(([path, value]) => [path.slice('画布副本/'.length), value])) };
  预审卡片布局类型(virtual);
  const patch = 生成审查差异(preview.delta);
  const manifest = { 日期: '2026-10-20', 状态: '待具体批准；仅网关与任务端口，原画布生成调用尚未接入', 上游提交: 基线.提交, 前置记录: 网关任务前置,
    前置差异SHA256: preview.integration.差异SHA256, 差异SHA256: 哈希(patch), 文件数: preview.delta.size, 完整虚拟类型检查通过: true,
    已接入: false, 已接管3100: false, 作者核心文件改动数: 0, 原画布生成已切换: false,
    自有来源: 网关自有来源.map(文件 => ({ 文件, SHA256: 哈希(readOwned(文件)) })),
    旧版参考来源: Object.entries(网关旧来源指纹).map(([文件, SHA256]) => ({ 文件, SHA256 })),
    工具来源: ['开发工具/预审凭据网关任务端口.mjs'].map(文件 => ({ 文件, SHA256: 哈希(readOwned(文件)) })),
    文件: [...preview.delta].map(([文件, item]) => ({ 文件, 原始SHA256: item.原文 === null ? null : 哈希(item.原文), 候选SHA256: 哈希(item.产物) })) };
  if (generate) for (const [suffix, value] of [['patch', patch], ['json', JSON.stringify(manifest, null, 2) + '\n']]) {
    const file = join(根目录, '上游适配/待审查/凭据网关与任务端口.' + suffix);
    if (existsSync(file)) throw Error('拒绝覆盖网关审查原件');
    writeFileSync(file, value, { flag: 'wx', mode: 0o600 });
  }
  return manifest;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.slice(2).some(arg => arg !== '--生成审查差异')) throw Error('未知预审参数');
  console.log(JSON.stringify(预审凭据网关任务(process.argv.includes('--生成审查差异')), null, 2));
}
