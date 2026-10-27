import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { 根目录, 基线 } from './公共.mjs';
import { 检查运行副本, 哈希 } from './检查运行副本.mjs';
import { 精确替换, 生成审查差异 } from './检查首批功能适配.mjs';
import { 构建分片候选 } from './预审SQLite分片存储.mjs';
import { 读取分片存储批准, 核验分片存储自有依赖, 分片存储差异SHA256 } from '../上游适配/SQLite分片存储批准.mjs';
import { 媒体启动器路径 } from '../上游适配/SQLite临时媒体策略批准.mjs';

export function 凭据网关候选(source) {
  return 精确替换(source, [
    ["import { StorageError, requireValue } from '../本机存储/协议.mjs';", "import { StorageError, requireValue } from '../本机存储/协议.mjs';\nimport { CREDENTIAL_FORMAT, validCredentialRef, validCredentialValue } from '../本机凭据/凭据协议.mjs';"],
    ['async function body(request) {', 'async function body(request, limit = 4096) {'],
    ['Number(length) <= 4096', 'Number(length) <= limit'],
    ['size <= 4096', 'size <= limit'],
    ['{ origin, dataURL, controller, now = Date.now,', '{ origin, dataURL, controller, credentialPort, now = Date.now,'],
    ["typeof controller.open === 'function' && typeof now === 'function' &&", "typeof controller.open === 'function' && (!credentialPort || typeof credentialPort.store === 'function' && typeof credentialPort.read === 'function') && typeof now === 'function' &&"],
    ["[prefix + 'authorize', prefix + 'session'].includes(request.url)", "[prefix + 'authorize', prefix + 'session', prefix + 'credentials'].includes(request.url)"],
    ['const value = await body(request);', "const value = await body(request, request.url === prefix + 'credentials' ? 16_384 : 4096);"],
    ["          requireValue(['initialize', 'renew', 'close'].includes(value?.operation)", `          if (request.url === prefix + 'credentials') {
            requireValue(credentialPort, 'credential_unavailable', '本机凭据保管尚未就绪。', 503);
            requireValue(['store', 'read'].includes(value?.operation) && exactKeys(value, value.operation === 'store' ? ['operation', 'value'] : ['operation', 'ref']) &&
              (value.operation === 'store' ? validCredentialValue(value.value) : validCredentialRef(value.ref)), 'invalid_credential', '凭据操作格式无效。');
            // 同一页面能力、Origin和活跃数据租约，不能凭旧页面能力绕过休眠过期。
            page.port.initialize();
            let result;
            try {
              if (value.operation === 'store') {
                const ref = await credentialPort.store(value.value);
                requireValue(validCredentialRef(ref), 'credential_ack_invalid', '凭据写入没有有效引用。', 503);
                result = { format: CREDENTIAL_FORMAT, ref };
              } else {
                const saved = await credentialPort.read(value.ref);
                requireValue(validCredentialValue(saved), 'credential_ack_invalid', '凭据读取没有有效内容。', 503);
                result = { format: CREDENTIAL_FORMAT, ref: value.ref, value: saved };
              }
            } catch { throw new StorageError('credential_unavailable', '本机凭据操作未确认；没有明文降级或替换原配置。', 503); }
            live();
            requireValue(pages.get(digest(capability)) === page, 'authorization_denied', '页面授权已结束。', 401);
            page.port.initialize();
            json(200, result); return true;
          }
          requireValue(['initialize', 'renew', 'close'].includes(value?.operation)`],
  ]);
}
export function 凭据授权客户端候选(source) {
  return 精确替换(source, [
    ["import { StorageError, requireValue } from './协议.mjs';", "import { StorageError, requireValue } from './协议.mjs';\nimport { createCredentialClient } from './凭据客户端.mjs';"],
    ['  async function command(value) {', "  async function credentialCommand(value) {\n    requireValue(!closed && now() < exchange.expiresAt, 'authorization_expired', '页面授权已结束，不会静默重新授权。', 401);\n    return post('credentials', value, capability);\n  }\n  async function command(value) {"],
    ['    url: exchange.dataURL,', '    url: exchange.dataURL,\n    secretPort: createCredentialClient({ command: credentialCommand }),'],
    ['response.ok && result?.protocol === protocol && !result.error', "response.ok && (path === 'credentials' ? result?.format === 'guan-credentials.v1' : result?.protocol === protocol) && !result.error"],
  ]);
}
export function 凭据自动入口候选(source) {
  return 精确替换(source, [['createApplicationStorage({ client, readBlobUrl:', 'createApplicationStorage({ client, secretPort: authorization.secretPort, readBlobUrl:']]);
}
export function 凭据启动器候选(source) {
  return 精确替换(source, [
    ["import { createBackupCoordinator } from './自动备份.mjs';", "import { createBackupCoordinator } from './自动备份.mjs';\nimport { openSQLiteCredentialVault } from '../本机凭据/SQLite凭据保管.mjs';"],
    ['{ webRoot, dataRoot, initialize = false, storage }', '{ webRoot, dataRoot, initialize = false, storage, credentialKeyProvider }'],
    ["typeof storage?.openWorkspace === 'function' && typeof storage?.startDataService === 'function'", "typeof storage?.openWorkspace === 'function' && typeof storage?.startDataService === 'function' && typeof credentialKeyProvider?.read === 'function' && typeof credentialKeyProvider?.create === 'function'"],
    ['service, workspace, backup, closing = null;', 'service, workspace, backup, credentialPort, closing = null;'],
    ['() => service?.close(), () => workspace?.close()', '() => service?.close(), () => credentialPort?.close(), () => workspace?.close()'],
    ['    service = await storage.startDataService', '    credentialPort = await openSQLiteCredentialVault({ workspace, keyProvider: credentialKeyProvider, initialize });\n    service = await storage.startDataService'],
    ['{ origin, dataURL: service.url, controller }', '{ origin, dataURL: service.url, controller, credentialPort }'],
  ]);
}
export function 构建凭据接入候选() {
  检查运行副本(); 核验分片存储自有依赖(根目录);
  const { delta: sharded, combined: prerequisite } = 构建分片候选(), delta = new Map(), manifest = 读取分片存储批准();
  // 同一份重建结果逐字核验，不重复重建整条历史；不跳过任何批准指纹。
  if (sharded.size !== 4 || 哈希(生成审查差异(sharded)) !== 分片存储差异SHA256 || manifest.文件.some(item => {
    const entry = sharded.get(item.文件);
    return !entry || (entry.原文 === null ? null : 哈希(entry.原文)) !== item.原始SHA256 || 哈希(entry.产物) !== item.候选SHA256;
  })) throw Error('凭据接入的分片前置不完整或偏离批准指纹');
  const sources = [
    [媒体启动器路径, 凭据启动器候选],
    ['扩展功能/本机服务/本机授权网关.mjs', 凭据网关候选],
    ['web/src/guan/sqlite/本机授权客户端.mjs', 凭据授权客户端候选],
    ['web/src/guan/sqlite/工作台自动入口.mjs', 凭据自动入口候选],
  ];
  for (const [path, transform] of sources) {
    const before = prerequisite.get(path)?.产物 ?? readFileSync(join(根目录, path), 'utf8');
    delta.set(path, { 原文: before, 产物: transform(before) });
  }
  for (const name of ['凭据协议.mjs', '凭据客户端.mjs']) {
    let content = readFileSync(join(根目录, '扩展功能/本机凭据', name), 'utf8');
    if (name === '凭据客户端.mjs') content = 精确替换(content, [["from '../本机存储/协议.mjs'", "from './协议.mjs'"]]);
    delta.set('web/src/guan/sqlite/' + name, { 原文: null, 产物: content });
  }
  for (const name of ['凭据协议.mjs', 'SQLite凭据保管.mjs', '钥匙串主密钥.mjs', '系统钥匙串.swift']) {
    delta.set('扩展功能/本机凭据/' + name, { 原文: null, 产物: readFileSync(join(根目录, '扩展功能/本机凭据', name), 'utf8') });
  }
  return { delta, prerequisite, combined: new Map([...prerequisite, ...delta]) };
}

let previewDelta;
const previewModules = new Map();
// 同一预审进程使用一份已核验的不可变源码快照，不反复重建整条历史。
// 只加载内存候选HTTP模块进行隔离预审，不安装到原画布、运行副本或3100。
export async function 加载凭据预审模块(path) {
  const delta = previewDelta ??= 构建凭据接入候选().delta, modules = previewModules;
  function urlFor(target) {
    if (modules.has(target)) return modules.get(target);
    const item = delta.get(target);
    if (!item) return pathToFileURL(join(根目录, target.startsWith('web/src/guan/sqlite/') ? target.replace('web/src/guan/sqlite/', '扩展功能/本机存储/') : target)).href;
    const source = item.产物.replace(/from '(\.[^']+)'/g, (_, relative) => {
      const resolved = new URL(relative, pathToFileURL(join(根目录, target))).pathname;
      const next = decodeURIComponent(resolved).slice(根目录.length);
      return "from '" + urlFor(next) + "'";
    });
    const url = 'data:text/javascript;base64,' + Buffer.from(source).toString('base64'); modules.set(target, url); return url;
  }
  return import(urlFor(path));
}
export function 预审SQLite凭据接入({ 生成差异 = false } = {}) {
  const { delta } = 构建凭据接入候选(), patch = 生成审查差异(delta);
  for (const [path, item] of delta) if (path.endsWith('.mjs')) execFileSync(process.execPath, ['--input-type=module', '--check'], { input: item.产物, stdio: ['pipe', 'pipe', 'pipe'] });
  const manifest = { 日期: '2026-10-18', 状态: '10文件精确候选；仅内存模块/临时数据预审，未批准接入原画布或3100', 上游提交: 基线.提交,
    前置分片差异SHA256: 分片存储差异SHA256, 差异SHA256: 哈希(patch), 候选JS语法检查通过: true,
    文件: [...delta].map(([文件, item]) => ({ 文件, 原始SHA256: item.原文 === null ? null : 哈希(item.原文), 候选SHA256: 哈希(item.产物) })),
    约束: ['保留历史源码、审批快照和保护器；只改变4份自有入口/网关模块并新增6份凭据产物',
      'SQLite主库内AES-256-GCM密文及不透明引用；Keychain仅本工作区独立service/account主密钥，无明文持久化',
      '同一页面能力、Host/Origin、受控数据租约和POST协议；不新增匿名凭据接口或浏览器缓存',
      '免填码不等于取消授权；锁定/丢失/错密钥拒绝，已有非空库不能自动初始化或重建主密钥',
      '本轮不调用真实Keychain；原生助手只编译与非法输入前置检查，不代表系统钥匙串实际读写通过',
      '不接管/重启3100、不迁真实数据、不提交/发布；批准后才可装配到全新隔离原画布',
      '前端仍为兼容上游持有页内密钥；外部API代理和任意正文DLP不在本批，不声称密钥不进浏览器内存',
      '备份含密文不含主密钥；跨机器恢复需单独安全凭据迁入或重填，不能只凭ZIP恢复密钥'],
  };
  if (生成差异) for (const [name, content] of [['SQLite凭据接入.patch', patch], ['SQLite凭据接入.json', JSON.stringify(manifest, null, 2) + '\n']]) {
    const target = join(根目录, '上游适配/待审查', name);
    if (existsSync(target) && readFileSync(target, 'utf8') !== content) throw Error('不覆盖凭据审查快照');
    if (!existsSync(target)) writeFileSync(target, content, { flag: 'wx', mode: 0o600 });
  }
  return manifest;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.slice(2).some(value => value !== '--生成审查差异')) throw Error('仅预审，不提供应用、Keychain调用或接管选项');
  console.log(JSON.stringify(预审SQLite凭据接入({ 生成差异: process.argv.includes('--生成审查差异') }), null, 2));
}
