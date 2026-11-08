import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { 根目录 } from './公共.mjs';
import { 解析日常命令, 停止确认 } from './日常命令行会话.mjs';
import { 核验日常运行包 } from './日常运行包.mjs';
import { openWorkspace } from '../扩展功能/本机存储/SQLite工作区.mjs';

// 真正派生命令行子进程，只运行隔离模式，不执行助手、不创建正式数据根。
const args = ['--隔离验收', ...process.argv.slice(2)];
const { fields } = 解析日常命令(args);
const prepared = 核验日常运行包(fields.get('--运行包'), fields.get('--清单指纹'));
const output = mkdtempSync(join(根目录, '.运行/output/日常命令行验收-'));
const logPath = join(output, '命令行脱敏日志.jsonl');
writeFileSync(logPath, '', { flag: 'wx', mode: 0o600 });
const events = [], results = [], blocked = [];
const redact = text => text.replace(/[0-9a-f]{64}/gi, '[已隐藏64位材料]');
let boundary = 'spawn', childError = false, ended = null, origin, dataRoot, client, forcedCleanup = false;
const child = spawn(process.execPath, [join(根目录, '开发工具/日常工作台命令.mjs'), ...args], { cwd: 根目录, stdio: ['pipe', 'pipe', 'pipe'] });
child.on('error', () => { childError = true; });
child.stdin.on('error', () => { /* 后续等待以退出状态/超时报告，不输出原始输入。 */ });
child.on('close', (code, signal) => { ended = { code, signal }; });
for (const [stream, name] of [[child.stdout, 'stdout'], [child.stderr, 'stderr']]) {
  let buffer = '';
  const record = line => {
    appendFileSync(logPath, JSON.stringify({ stream: name, text: redact(line) }) + '\n');
    if (name !== 'stdout') return;
    try { const value = JSON.parse(line); if (typeof value?.phase === 'string') events.push(value); } catch { /* 普通保护日志不是状态事件。 */ }
  };
  stream.setEncoding('utf8');
  stream.on('data', text => {
    buffer += text;
    let index;
    while ((index = buffer.indexOf('\n')) !== -1) { record(buffer.slice(0, index)); buffer = buffer.slice(index + 1); }
  });
  stream.on('end', () => { if (buffer) record(buffer); });
}
function check(name, condition = true) { assert.ok(condition, name); results.push({ name, passed: true }); }
async function until(predicate, timeout = 15_000) {
  const start = Date.now();
  while (!predicate()) {
    if (childError || Date.now() - start > timeout) throw Error('boundary_timeout');
    await new Promise(resolve => setTimeout(resolve, 30));
  }
}
function raw(url, path = '/', headers = {}) {
  const address = new URL(url);
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port: address.port, path, headers: { Host: address.host, ...headers }, timeout: 5000 }, res => {
      const chunks = [];
      res.on('data', bytes => chunks.push(bytes));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(Error('http_timeout'))); req.on('error', reject); req.end();
  });
}
const load = relative => import(pathToFileURL(join(prepared.integration.副本, relative)).href);
let passed = false;
try {
  await until(() => events.some(e => e.phase === 'ready' || e.phase === 'failed') || ended !== null);
  assert.ok(!ended && !events.some(e => e.phase === 'failed'));
  origin = events.find(e => e.phase === 'ready').origin;
  dataRoot = events.find(e => e.phase === 'isolated-data')?.dataRoot;
  assert.match(origin, /^http:\/\/localhost:\d+$/);
  assert.ok(!['3000', '3100', '8888', '5174'].includes(new URL(origin).port));
  const temporary = realpathSync(tmpdir());
  assert.ok(typeof dataRoot === 'string' && dataRoot.startsWith(temporary + '/guan-daily-cli-') && dataRoot.endsWith('/数据'));
  check('真正CLI启动随机localhost，使用新临时数据根，不执行系统助手');

  boundary = 'navigation';
  check('无顶层导航材料直接访问被拒绝', (await raw(origin)).status === 403);
  const page = await raw(origin, '/', { 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document' });
  const code = page.body.match(/<meta name="guan-local-bootstrap" content="([0-9a-f]{64})">/)?.[1];
  check('顶层导航提供内部握手；原React入口，无Cookie或跳转', page.status === 200 && !!code && !page.headers['set-cookie'] && !page.headers.location && page.body.includes('type="module"'));
  check('拒绝IP别名Host及跨站来源',
    (await raw(origin, '/config.js', { Host: '127.0.0.1:' + new URL(origin).port })).status === 403 &&
    (await raw(origin, '/config.js', { Origin: 'http://localhost:3100' })).status === 403 &&
    (await raw(origin, '/config.js', { 'Sec-Fetch-Site': 'cross-site' })).status === 403);

  boundary = 'authorization';
  const { authorizeLocalStorage } = await load('web/src/guan/sqlite/本机授权客户端.mjs');
  const { createRenewingDataClient } = await load('web/src/guan/sqlite/续期数据客户端.mjs');
  const transport = (url, options) => fetch(url, { ...options, headers: { ...options.headers, Origin: origin, 'Sec-Fetch-Site': 'same-origin' } });
  const authorization = await authorizeLocalStorage({ origin, code, fetchImpl: transport });
  client = createRenewingDataClient({ ...authorization, origin, fetchImpl: transport });
  const value = { title: 'CLI隔离提交', probe: randomUUID() }, operationId = randomUUID();
  boundary = 'save-ack';
  const ack = await client.writeDocument({ collection: 'extension', id: 'daily-cli-probe', value, expectedRevision: 0, operationId, mediaIds: [] });
  check('真实HTTP提交取得匹配的persisted ACK与revision1', ack.persisted === true && ack.revision === 1 && ack.operationId === operationId);
  assert.deepEqual((await client.readDocument('extension', 'daily-cli-probe')).value, value);
  check('已授权HTTP读取内容及哈希验证通过');

  boundary = 'session-control';
  child.kill('SIGINT');
  await until(() => events.some(e => e.phase === 'maintenance-required'));
  check('Ctrl+C只请求维护确认，服务继续提供资源', !ended && (await raw(origin, '/config.js', { Origin: origin })).status === 200);
  const before = events.filter(e => e.phase === 'maintenance-required').length;
  child.stdin.write('停止\n');
  await until(() => events.filter(e => e.phase === 'maintenance-required').length > before);
  check('非精确停止命令不会关服务', !ended && (await raw(origin, '/config.js', { Origin: origin })).status === 200);
  await client.close(); client = null;
  child.stdin.write(停止确认 + '\n');
  await until(() => ended !== null);
  check('明确保存关闭确认后正常退出0且报告stopped', ended.code === 0 && ended.signal === null && events.some(e => e.phase === 'stopped'));
  await assert.rejects(raw(origin), error => error.code === 'ECONNREFUSED');
  check('正常退出后本轮隔离HTTP监听已关闭', !existsSync(join(dataRoot, '.实例锁.json')));

  boundary = 'cold-storage';
  const workspace = openWorkspace({ dataRoot });
  try {
    const document = workspace.readDocument('extension', 'daily-cli-probe');
    assert.equal(document.revision, 1); assert.deepEqual(document.value, value);
    check('CLI进程退出后冷打开SQLite仍有相同记录及修订');
  } finally { workspace.close(); }
  const db = new DatabaseSync(join(dataRoot, '工作台.sqlite'), { readOnly: true });
  try {
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { db.close(); }
  check('冷库完整性、外键与正常释放实例锁通过', !existsSync(join(dataRoot, '.实例锁.json')));
  passed = true;
} catch {
  blocked.push({ boundary, message: '首个失败边界已停止；请检查本轮脱敏日志，未继续后续业务验证。' }); process.exitCode = 1;
} finally {
  try { await client?.close(); } catch { blocked.push({ boundary: 'cleanup', message: '隔离客户端关闭未确认；保留测试数据及锁。' }); }
  if (!ended && !childError) {
    child.stdin.write(停止确认 + '\n');
    try { await until(() => ended !== null, 10_000); }
    catch {
      // 只处理本脚本派生的测试PID；从不搜寻或停止既有3000/3100进程，不清残留锁。
      forcedCleanup = true; child.kill('SIGKILL');
      try { await until(() => ended !== null, 5000); } catch { /* 记录未确认清理。 */ }
    }
  }
  if (forcedCleanup) { passed = false; process.exitCode = 1; }
  const report = { passed, results, blocked, boundary, output, childExit: ended, forcedCleanup, origin, syntheticDataRoot: dataRoot,
    preparedManifest: fields.get('--运行包'), manifestSHA256: prepared.manifestSHA256,
    actualCLIProcess: true, originalReactUIExercised: false, nativeHelperExecuted: false, realKeychainAccessed: false,
    real3100TakenOver: false, realDataMigrated: false, testDataRetained: true };
  writeFileSync(join(output, '验收结果.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify(report, null, 2));
}
