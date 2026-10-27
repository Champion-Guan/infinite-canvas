import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { 根目录 } from './公共.mjs';
import { 读取SQLite批准, SQLite安全指纹 } from '../上游适配/SQLite全面替换批准.mjs';
import { 精确替换, 生成审查差异 } from './检查首批功能适配.mjs';

export const 服务路径 = '扩展功能/本机服务/数据服务.mjs';
export const 协调路径 = '扩展功能/本机服务/写入协调.mjs';
const sha = value => createHash('sha256').update(value).digest('hex');

export function 写入协调服务候选(text) {
  return 精确替换(text, [
    ["import { createServer } from 'node:http';", "import { createServer } from 'node:http';\nimport { createWriteCoordinator } from './写入协调.mjs';"],
    ['rateLimit = 120, now = Date.now } = {})', 'rateLimit = 120, now = Date.now, writeOptions } = {})'],
    ['let activeRequests = 0, stopping = false;', 'const writeGate = createWriteCoordinator(writeOptions);\n  let activeRequests = 0, stopping = false, closing;'],
    ["      if (rawPath === '/health'", `      // 先鉴权并读完整请求体，再排队；执行前复核撤销/过期及连接关闭。
      async function commitWrite(operation) {
        const cancellation = new AbortController();
        const disconnected = () => { if (!response.writableEnded) cancellation.abort(); };
        request.once('aborted', disconnected); response.once('close', disconnected);
        if (request.aborted || response.destroyed) cancellation.abort();
        try {
          return await writeGate.runWrite(() => {
            requireValue(!stopping, 'service_stopping', '本机服务正在停止。', 503);
            requireValue(sessions.get(token) === session && session.expiresAt > now(), 'session_denied', '等待期间会话已失效，未提交保存。', 401);
            return operation();
          }, { signal: cancellation.signal });
        } finally { request.off('aborted', disconnected); response.off('close', disconnected); }
      }
      if (rawPath === '/health'`],
    ['json(200, workspace.writeDocument({ ...body, collection: first, id: second }));', 'json(200, await commitWrite(() => workspace.writeDocument({ ...body, collection: first, id: second })));'],
    ['json(201, workspace.writeMedia(bytes, request.headers[\'content-type\']));', 'json(201, await commitWrite(() => workspace.writeMedia(bytes, request.headers[\'content-type\'])));'],
    ["    async close() { stopping = true; sessions.clear(); await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); },", `    // 只有可信进程内入口；不新增HTTP备份/授权端点，不将队列排空等同于所有页面已保存。
    getWriteStatus: writeGate.getStatus,
    createBackup() { return writeGate.runBackup(() => { requireValue(!stopping, 'service_stopping', '本机服务正在停止。', 503); return workspace.createBackup(); }); },
    close() {
      if (!closing) {
        stopping = true; sessions.clear();
        closing = Promise.all([writeGate.close(), new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))]).then(() => {});
      }
      return closing;
    },`],
  ]);
}

export function 构建写入协调候选() {
  const fingerprint = 读取SQLite批准().自有依赖.find(item => item.文件 === 服务路径)?.SHA256;
  if (!fingerprint || SQLite安全指纹(根目录, 服务路径) !== fingerprint) throw Error('数据服务前态偏离批准快照，停止预审。');
  const before = readFileSync(join(根目录, 服务路径), 'utf8'), gateFingerprint = SQLite安全指纹(根目录, 协调路径);
  if (sha(before) !== fingerprint || !gateFingerprint) throw Error('候选读取期间源码变化，停止预审。');
  const gateSource = readFileSync(join(根目录, 协调路径), 'utf8');
  if (sha(gateSource) !== gateFingerprint) throw Error('写入协调源码读取期间变化，停止预审。');
  return new Map([[服务路径, { 原文: before, 产物: 写入协调服务候选(before) }],
    [协调路径, { 原文: null, 产物: gateSource }]]);
}

// 仅预审测试加载内存候选；只把静态相对导入解析为真实自有模块，不写现有服务或运行副本。
export async function 加载写入协调预审服务() {
  const source = 构建写入协调候选().get(服务路径).产物.replace(/from '(\.[^']+)'/g, (_, path) => `from '${new URL(path, pathToFileURL(join(根目录, 服务路径))).href}'`);
  return import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
}

export function 预审写入协调({ 生成差异 = false } = {}) {
  const delta = 构建写入协调候选(), patch = 生成审查差异(delta);
  const manifest = { 状态: '待具体2文件差异批准，只做内存候选HTTP预审；未修改已批准服务或运行副本', 日期: '2026-10-17',
    差异SHA256: sha(patch), 文件: [...delta].map(([文件, item]) => ({ 文件, 原始SHA256: item.原文 === null ? null : sha(item.原文), 候选SHA256: sha(item.产物) })),
    保持约束: ['不改原作者文件、UI、数据库schema或既有审批快照', '队列仅涵盖服务已接收操作，不证明浏览器已保存', '不新增HTTP备份或匿名授权入口', '不接管3100、不迁旧数据、不读取真实凭据、不推送发布'] };
  if (生成差异) for (const [name, content] of [['SQLite写入协调.patch', patch], ['SQLite写入协调.json', JSON.stringify(manifest, null, 2) + '\n']]) {
    const path = join(根目录, '上游适配/待审查', name);
    if (existsSync(path) && readFileSync(path, 'utf8') !== content) throw Error('不覆盖已有写入协调审查产物。');
    if (!existsSync(path)) writeFileSync(path, content);
  }
  return manifest;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.slice(2).some(arg => arg !== '--生成审查差异')) throw Error('只提供预审，不提供应用命令。');
  console.log(JSON.stringify(预审写入协调({ 生成差异: process.argv.includes('--生成审查差异') }), null, 2));
}
