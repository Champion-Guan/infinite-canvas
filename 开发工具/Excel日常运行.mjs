import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { 根目录 } from './公共.mjs';
import { 安全目录, 安全文件, 静态产物清单, 核验日常运行包 } from './日常运行包.mjs';
import { 工作区表摘要 } from './分类容量日常运行.mjs';
import { 核验稳定助手 } from './日常助手部署.mjs';
import { 管理日常会话 } from './日常命令行会话.mjs';
import { 读取Excel视觉继承隔离记录, 核验Excel视觉继承完整包, 加载Excel视觉继承磁盘服务 } from './接入Excel视觉继承隔离副本.mjs';
import { Excel视觉继承差异SHA256 } from '../上游适配/Excel视觉继承批准.mjs';

const record = join(根目录, '.运行/Excel视觉继承-7nFs1T/Excel视觉继承接入记录.json');
const baselinePath = join(根目录, '.运行/SQLite日常准备-UWriM2/准备清单.json');
const baselineSHA = 'a44877449e31671952933ddd7a1b5e1f3acaa12aa7479a6395d4aa94d104b1ed';
const dataRoot = '/Users/guanchengbin/Library/Application Support/AI-Workbench-重建版/工作区';
const workspaceId = '931e75c3-5f4d-4152-ab4b-6b63478fb1c0';
const sha = value => createHash('sha256').update(value).digest('hex');

function sources() {
  const integration = 读取Excel视觉继承隔离记录(record), baseline = 核验日常运行包(baselinePath, baselineSHA);
  assert.equal(安全文件(join(integration.副本, '扩展功能/本机凭据/系统钥匙串.swift')).sha256, baseline.manifest.helper.sourceSHA256);
  return { integration, baseline };
}
// 只读取已批准的完整组合包，在新目录构建；不重装配源码，不打开正式数据或执行助手。
export async function 准备Excel日常包() {
  const { integration, baseline } = sources();
  const root = mkdtempSync(join(根目录, '.运行/SQLiteExcel日常准备-'));
  const cache = mkdtempSync(join(realpathSync(tmpdir()), 'guan-excel-daily-cache-'));
  const web = join(integration.副本, 'web'), require = createRequire(join(web, 'package.json')), ts = require('typescript');
  const config = ts.readConfigFile(join(web, 'tsconfig.json'), ts.sys.readFile);
  if (config.error) throw Error('TypeScript配置不可读');
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, web);
  const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(ts.createProgram(parsed.fileNames, { ...parsed.options, noEmit: true, incremental: false }))];
  if (diagnostics.length) throw Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCurrentDirectory: () => web, getCanonicalFileName: p => p, getNewLine: () => '\n' }));
  console.log('完整Excel组合包类型检查通过，开始构建。');
  const { build } = await import(pathToFileURL(require.resolve('vite')).href);
  await build({ root: web, configFile: join(web, 'vite.config.ts'), cacheDir: join(cache, 'vite'), logLevel: 'warn',
    build: { outDir: join(root, 'web'), emptyOutDir: false }, css: { postcss: { plugins: [require('@tailwindcss/postcss')({ base: join(web, 'src') })] } } });
  核验Excel视觉继承完整包(integration.组合包, true);
  const manifest = { protocol: 'guan-excel-daily.v1', integrationRecord: record, deltaSHA256: Excel视觉继承差异SHA256,
    baselinePath, baselineSHA, helperSourceSHA256: baseline.manifest.helper.sourceSHA256, web: 静态产物清单(join(root, 'web')) };
  const bytes = JSON.stringify(manifest, null, 2) + '\n', path = join(root, '准备清单.json');
  writeFileSync(path, bytes, { flag: 'wx', mode: 0o600 });
  核验Excel日常包(path, sha(bytes));
  return { path, sha256: sha(bytes), realDataOpened: false, helperExecuted: false };
}
export function 核验Excel日常包(path, expected) {
  const file = resolve(path), root = dirname(file);
  if (!root.startsWith(resolve(根目录, '.运行') + sep) || !/^SQLiteExcel日常准备-[A-Za-z0-9]+$/.test(root.split(sep).at(-1)) ||
    file !== join(root, '准备清单.json') || !/^[0-9a-f]{64}$/.test(expected ?? '')) throw Error('Excel日常包路径不符');
  安全目录(root, true); 安全文件(file);
  const bytes = readFileSync(file), manifest = JSON.parse(bytes);
  if (sha(bytes) !== expected || manifest.protocol !== 'guan-excel-daily.v1' || manifest.integrationRecord !== record ||
    manifest.deltaSHA256 !== Excel视觉继承差异SHA256 || manifest.baselinePath !== baselinePath || manifest.baselineSHA !== baselineSHA ||
    Object.keys(manifest).sort().join(',') !== 'baselinePath,baselineSHA,deltaSHA256,helperSourceSHA256,integrationRecord,protocol,web' ||
    readdirSync(root).sort().join(',') !== 'web,准备清单.json' || JSON.stringify(静态产物清单(join(root, 'web'))) !== JSON.stringify(manifest.web)) throw Error('Excel日常包内容或指纹不符');
  const { integration, baseline } = sources();
  if (manifest.helperSourceSHA256 !== baseline.manifest.helper.sourceSHA256) throw Error('Excel日常助手不符');
  return { integration, baseline, root, manifest, webRoot: join(root, 'web'), manifestPath: file, manifestSHA256: expected };
}
function requireStopped() {
  if (spawnSync('lsof', ['-t', '-nP', '-iTCP:3100', '-sTCP:LISTEN']).status !== 1 || existsSync(join(dataRoot, '.实例锁.json')) ||
    spawnSync('lsof', ['+D', dataRoot]).status !== 1) throw Error('必须先正常停止3100并释放工作区；不会清锁或强停');
  安全目录(dataRoot, true);
}
export async function Excel维护备份(prepared, { savedAndClosed = false } = {}) {
  assert.equal(savedAndClosed, true, '需要本轮保存关闭确认');
  requireStopped();
  const before = 工作区表摘要(dataRoot);
  assert.equal(before.workspaceId, workspaceId, '正式工作区身份变化');
  const storage = await 加载Excel视觉继承磁盘服务(prepared.integration);
  const output = mkdtempSync(join(根目录, '.运行/output/Excel3100切换-'));
  const workspace = storage.openWorkspace({ dataRoot, initialize: false }); let backup;
  try { backup = await workspace.createBackup(); } finally { workspace.close(); }
  requireStopped();
  assert.deepEqual(工作区表摘要(dataRoot), before, '维护备份改变了业务表');
  const recovered = join(output, '备份恢复核验');
  storage.restoreBackup({ backupRoot: backup.path, targetRoot: recovered });
  assert.deepEqual(工作区表摘要(recovered), before, '备份恢复业务表不一致');
  const receipt = { protocol: 'guan-excel-maintenance.v1', passed: true, date: new Date().toISOString(), dataRoot, workspaceId,
    manifest: prepared.manifestPath, manifestSHA256: prepared.manifestSHA256, before, backupPath: backup.path, recovered,
    productionRowsUnchanged: true, credentialsDecryptedByCheck: false, newMasterKeyCreated: false };
  const file = join(output, '切换前备份.json'), bytes = JSON.stringify(receipt, null, 2) + '\n';
  writeFileSync(file, bytes, { flag: 'wx', mode: 0o600 });
  return { passed: true, file, sha256: sha(bytes), backupPath: backup.path };
}
export function 核验Excel维护收据(file, digest, prepared) {
  const path = resolve(file), root = dirname(path);
  if (dirname(root) !== join(resolve(根目录), '.运行/output') || !/^Excel3100切换-[A-Za-z0-9]+$/.test(root.split(sep).at(-1)) ||
    path !== join(root, '切换前备份.json')) throw Error('Excel维护收据路径不符');
  安全目录(root, true); const item = 安全文件(path), receipt = JSON.parse(readFileSync(path));
  if (!/^[0-9a-f]{64}$/.test(digest ?? '') || item.sha256 !== digest || receipt.protocol !== 'guan-excel-maintenance.v1' || receipt.passed !== true ||
    receipt.dataRoot !== dataRoot || receipt.workspaceId !== workspaceId || receipt.manifest !== prepared.manifestPath || receipt.manifestSHA256 !== prepared.manifestSHA256 ||
    receipt.recovered !== join(root, '备份恢复核验') || receipt.productionRowsUnchanged !== true || receipt.credentialsDecryptedByCheck !== false || receipt.newMasterKeyCreated !== false) throw Error('Excel维护收据内容不符');
  requireStopped();
  assert.equal(receipt.before?.workspaceId, workspaceId);
  assert.deepEqual(工作区表摘要(dataRoot), receipt.before, '备份后正式数据发生变化，须重新维护备份');
  assert.deepEqual(工作区表摘要(receipt.recovered), receipt.before, '恢复核验副本发生变化');
  return { root, receipt };
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const [mode, file, digest, receiptFile, receiptSHA, confirmation] = process.argv.slice(2);
  if (mode === '--准备' && process.argv.length === 3) console.log(JSON.stringify(await 准备Excel日常包()));
  else if (mode === '--检查' && process.argv.length === 5) { 核验Excel日常包(file, digest); console.log(JSON.stringify({ passed: true, realDataOpened: false })); }
  else if (mode === '--维护备份' && process.argv.length === 6 && receiptFile === '--已保存并关闭') {
    console.log(JSON.stringify(await Excel维护备份(核验Excel日常包(file, digest), { savedAndClosed: true })));
  } else if (mode === '--启动' && process.argv.length === 8) {
    assert.ok(process.stdin.isTTY && confirmation === '--已保存并关闭', '需要当前保存关闭确认及独立交互终端');
    const prepared = 核验Excel日常包(file, digest), maintenance = 核验Excel维护收据(receiptFile, receiptSHA, prepared);
    const log = join(maintenance.root, '日常服务生命周期.jsonl');
    if (existsSync(log)) 安全文件(log);
    const emit = value => {
      appendFileSync(log, JSON.stringify({ date: new Date().toISOString(), pid: process.pid, ...value }) + '\n', { mode: 0o600 });
      process.stdout.write(JSON.stringify(value) + '\n');
    };
    process.stdout.on('error', error => appendFileSync(log, JSON.stringify({ phase: 'output-error', code: error.code }) + '\n'));
    process.on('exit', code => appendFileSync(log, JSON.stringify({ date: new Date().toISOString(), pid: process.pid, phase: 'process-exit', code }) + '\n'));
    emit({ phase: 'host-start', ppid: process.ppid, tty: true, manifestSHA256: digest });
    const helper = 核验稳定助手(prepared.baseline), storage = await 加载Excel视觉继承磁盘服务(prepared.integration);
    const { startDailyWorkbench } = await import(pathToFileURL(join(prepared.integration.副本, '扩展功能/本机服务/日常工作台.mjs')).href);
    const app = await startDailyWorkbench({ webRoot: prepared.webRoot, storage, helperPath: helper.helperPath,
      helperSHA256: prepared.baseline.manifest.helper.sha256, savedAndClosed: true, initialize: false });
    emit({ phase: 'ready', origin: app.origin, workspaceId: app.workspaceId, status: app.getStatus(), initialize: false });
    let sampling = false;
    const timer = setInterval(async () => {
      if (sampling) return; sampling = true;
      try { const response = await fetch(app.origin + '/logo.svg', { method: 'HEAD', signal: AbortSignal.timeout(3000) }); await response.body?.cancel(); emit({ phase: 'heartbeat', http: response.status }); }
      catch { emit({ phase: 'heartbeat-failed' }); }
      finally { sampling = false; }
    }, 15000);
    console.log('Excel完整组合3100前台服务：请保留本终端。输入“状态”查看；保存关闭后输入“已保存并关闭，停止”。');
    try { await 管理日常会话(app, { input: process.stdin, emit }); } finally { clearInterval(timer); }
  } else throw Error('仅允许准备、检查、本轮已确认的正常维护备份和启动；不支持初始化、清锁或强停');
}
