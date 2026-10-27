import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { 根目录, 基线 } from './公共.mjs';
import { 哈希 } from './检查运行副本.mjs';
import { 精确替换, 生成审查差异 } from './检查首批功能适配.mjs';
import { 读取配置合并复验记录, 核验配置合并完整源码 } from './接入SQLite配置合并隔离副本.mjs';
import { 配置合并差异SHA256 } from '../上游适配/SQLite配置合并批准.mjs';

export const 日常启动器路径 = '扩展功能/本机服务/受限工作台启动器.mjs';
export function 日常入口候选(source) {
  return 精确替换(source, [
    ['// 只允许动态临时端口；不接管3100、旧数据或默认生产目录，不安装常驻服务。', '// 默认仍为动态隔离入口；固定localhost:3100只能由另行批准的日常装配调用，不安装常驻服务。'],
    ['{ webRoot, dataRoot, initialize = false, storage, credentialKeyProvider }', "{ webRoot, dataRoot, initialize = false, storage, credentialKeyProvider, endpoint = { hostname: '127.0.0.1', port: 0 } }"],
    ['  const { files, scriptHashes } = readStaticBundle(webRoot);', `  requireValue(endpoint && typeof endpoint === 'object' && !Array.isArray(endpoint) &&
    Object.keys(endpoint).sort().join(',') === 'hostname,port' &&
    ['127.0.0.1', 'localhost'].includes(endpoint.hostname) &&
    (endpoint.port === 0 || endpoint.port === 3100 && endpoint.hostname === 'localhost'),
    'invalid_launcher_endpoint', '只允许隔离临时入口或明确的localhost:3100日常入口。');
  // 复制值，避免等待期间调用方修改endpoint导致Host/Origin错配；监听始终仅127.0.0.1。
  const { hostname, port } = endpoint;
  const { files, scriptHashes } = readStaticBundle(webRoot);`],
    ['const expected = `127.0.0.1:${server.address().port}`;', 'const expected = `${hostname}:${server.address().port}`;'],
    ["server.listen(0, '127.0.0.1', done)", "server.listen(port, '127.0.0.1', done)"],
    ["const origin = 'http://127.0.0.1:' + server.address().port;", "const origin = 'http://' + hostname + ':' + server.address().port;"],
  ]);
}

// 只读已批准磁盘前置，在内存生成候选。不写运行副本、不启动3100或访问Keychain。
export function 构建日常启动候选(reviewRecord) {
  const integration = 读取配置合并复验记录(reviewRecord);
  const delta = new Map([[日常启动器路径, { 原文: readFileSync(join(integration.副本, 日常启动器路径), 'utf8') }]]);
  delta.get(日常启动器路径).产物 = 日常入口候选(delta.get(日常启动器路径).原文);
  for (const name of ['日常数据根.mjs', '日常工作台.mjs']) {
    const path = '扩展功能/本机服务/' + name;
    if (existsSync(join(integration.副本, path))) throw Error('候选新增文件已经存在，停止。');
    delta.set(path, { 原文: null, 产物: readFileSync(join(根目录, path), 'utf8') });
  }
  return { integration, delta };
}

export async function 加载日常启动候选(preview, path) {
  const modules = new Map();
  function urlFor(target) {
    if (modules.has(target)) return modules.get(target);
    const item = preview.delta.get(target);
    if (!item) return pathToFileURL(join(preview.integration.副本, target)).href;
    const source = item.产物.replace(/from '(\.[^']+)'/g, (_, relative) => {
      const full = fileURLToPath(new URL(relative, pathToFileURL(join(preview.integration.副本, target))));
      return "from '" + urlFor(full.slice(preview.integration.副本.length + 1)) + "'";
    });
    const url = 'data:text/javascript;base64,' + Buffer.from(source).toString('base64'); modules.set(target, url); return url;
  }
  return import(urlFor(path));
}

function saveNew(path, bytes) {
  if (existsSync(path)) { if (readFileSync(path, 'utf8') !== bytes) throw Error('已有审查证据不同，拒绝覆盖；应新建修订批次。'); return; }
  writeFileSync(path, bytes, { flag: 'wx', mode: 0o600 });
}
export function 预审SQLite日常启动(reviewRecord, generate = false) {
  const preview = 构建日常启动候选(reviewRecord), patch = 生成审查差异(preview.delta);
  for (const item of preview.delta.values()) execFileSync(process.execPath, ['--input-type=module', '--check'], { input: item.产物, stdio: 'pipe' });
  const manifest = { 日期: '2026-10-18', 状态: '3文件日常启动候选；未批准、未装配或接管3100', 上游提交: 基线.提交,
    前置配置合并差异SHA256: 配置合并差异SHA256, 差异SHA256: 哈希(patch), 候选JS语法检查通过: true,
    文件: [...preview.delta].map(([文件, item]) => ({ 文件, 原始SHA256: item.原文 === null ? null : 哈希(item.原文), 候选SHA256: 哈希(item.产物) })),
    约束: ['默认隔离入口保持；日常固定localhost:3100，占用即失败，不顺延、不停止既有进程',
      '新增AI-Workbench-重建版/工作区独立数据根；首次初始化明确选择，已有非空库不重建',
      '保留Host/Origin/会话/CSRF和免填码握手；不增加匿名数据或凭据API',
      '日常装配仅使用项目专用Keychain主密钥端口；本轮无真实Keychain读写',
      '启动/关闭均要求可信调用方本轮保存关闭确认；不声称能自动证明所有页面已保存',
      '批准后先新隔离副本事务接入和真实原画布验收；本次不授权生产切换或迁旧数据',
      '这是入口装配API，不是已交付的命令行启动器；构建/批准保护/系统助手仍由后续可信工具装配'] };
  if (generate) {
    const root = join(根目录, '上游适配/待审查');
    saveNew(join(root, 'SQLite日常启动.patch'), patch); saveNew(join(root, 'SQLite日常启动.json'), JSON.stringify(manifest, null, 2) + '\n');
  }
  核验配置合并完整源码(preview.integration.副本, true);
  return manifest;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || !args[0].startsWith('--配置合并记录=') || args[1] !== '--生成审查差异') throw Error('仅允许指定批准前置，生成新候选审查，不提供接入/启动功能。');
  console.log(JSON.stringify(预审SQLite日常启动(args[0].slice('--配置合并记录='.length), true), null, 2));
}
