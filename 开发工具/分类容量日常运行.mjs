import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { 根目录 } from './公共.mjs';
import { 安全目录, 安全文件, 静态产物清单, 核验日常运行包 } from './日常运行包.mjs';
import { 核验稳定助手 } from './日常助手部署.mjs';
import { 管理日常会话 } from './日常命令行会话.mjs';
import { 读取分类容量隔离记录, 核验分类容量完整包, 加载分类容量磁盘服务 } from './接入SQLite分类容量隔离副本.mjs';
import { 分类容量差异SHA256 } from '../上游适配/SQLite分类容量批准.mjs';

const record = join(根目录, '.运行/SQLite分类容量-YzaI8L/分类容量接入记录.json');
const baselinePath = join(根目录, '.运行/SQLite日常准备-UWriM2/准备清单.json');
const baselineSHA = 'a44877449e31671952933ddd7a1b5e1f3acaa12aa7479a6395d4aa94d104b1ed';
const dataRoot = '/Users/guanchengbin/Library/Application Support/AI-Workbench-重建版/工作区';
const sha = value => createHash('sha256').update(value).digest('hex');
const emit = value => console.log(JSON.stringify(value));
function sources() {
  const integration = 读取分类容量隔离记录(record), baseline = 核验日常运行包(baselinePath, baselineSHA);
  const swift = join(integration.副本, '扩展功能/本机凭据/系统钥匙串.swift');
  if (安全文件(swift).sha256 !== baseline.manifest.helper.sourceSHA256) throw Error('新旧助手来源不一致');
  return { integration, baseline };
}
export async function 准备分类容量日常包() {
  const { integration, baseline } = sources();
  const root = mkdtempSync(join(根目录, '.运行/SQLite分类日常准备-'));
  const cache = mkdtempSync(join(realpathSync(tmpdir()), 'guan-categorized-daily-cache-'));
  const web = join(integration.副本, 'web'), require = createRequire(join(web, 'package.json')), ts = require('typescript');
  const config = ts.readConfigFile(join(web, 'tsconfig.json'), ts.sys.readFile);
  if (config.error) throw Error('TypeScript配置无法读取');
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, web);
  const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(ts.createProgram(parsed.fileNames, { ...parsed.options, noEmit: true, incremental: false }))];
  if (diagnostics.length) throw Error('完整原画布类型检查失败');
  const { build } = await import(pathToFileURL(require.resolve('vite')).href);
  await build({ root: web, configFile: join(web, 'vite.config.ts'), cacheDir: join(cache, 'vite'), logLevel: 'warn',
    build: { outDir: join(root, 'web'), emptyOutDir: false }, css: { postcss: { plugins: [require('@tailwindcss/postcss')({ base: join(web, 'src') })] } } });
  核验分类容量完整包(integration.组合包, true);
  const manifest = { protocol: 'guan-categorized-daily.v1', integrationRecord: record, deltaSHA256: 分类容量差异SHA256,
    baselinePath, baselineSHA, helperSourceSHA256: baseline.manifest.helper.sourceSHA256, web: 静态产物清单(join(root, 'web')) };
  const bytes = JSON.stringify(manifest, null, 2) + '\n', path = join(root, '准备清单.json');
  writeFileSync(path, bytes, { flag: 'wx', mode: 0o600 });
  核验分类容量日常包(path, sha(bytes));
  return { path, sha256: sha(bytes), originalReactBundle: true, realDataOpened: false, helperExecuted: false };
}
export function 核验分类容量日常包(path, expected) {
  const file = resolve(path), root = dirname(file);
  if (!root.startsWith(resolve(根目录, '.运行') + sep) || !/^SQLite分类日常准备-[A-Za-z0-9]+$/.test(root.split(sep).at(-1)) ||
    file !== join(root, '准备清单.json') || !/^[0-9a-f]{64}$/.test(expected ?? '')) throw Error('分类日常包路径不符');
  安全目录(root, true); 安全文件(file);
  const bytes = readFileSync(file), manifest = JSON.parse(bytes);
  if (sha(bytes) !== expected || manifest.protocol !== 'guan-categorized-daily.v1' || manifest.integrationRecord !== record ||
    manifest.deltaSHA256 !== 分类容量差异SHA256 || manifest.baselinePath !== baselinePath || manifest.baselineSHA !== baselineSHA ||
    Object.keys(manifest).sort().join(',') !== 'baselinePath,baselineSHA,deltaSHA256,helperSourceSHA256,integrationRecord,protocol,web' ||
    readdirSync(root).sort().join(',') !== 'web,准备清单.json' || JSON.stringify(静态产物清单(join(root, 'web'))) !== JSON.stringify(manifest.web)) throw Error('分类日常包内容或指纹不符');
  const { integration, baseline } = sources();
  if (manifest.helperSourceSHA256 !== baseline.manifest.helper.sourceSHA256) throw Error('分类日常助手不符');
  return { integration, baseline, root, manifest, webRoot: join(root, 'web') };
}
// 不展示正文或解密凭据；用所有表的行哈希比较维护前后业务数据。
export function 工作区表摘要(root) {
  const db = new DatabaseSync(join(root, '工作台.sqlite'), { readOnly: true });
  try {
    if (db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok' || db.prepare('PRAGMA foreign_key_check').all().length) throw Error('数据库完整性检查失败');
    const tables = {};
    for (const name of ['workspace', 'documents', 'media', 'document_media', 'operations']) {
      const rows = db.prepare('SELECT * FROM ' + name).all().map(row => JSON.stringify(row)).sort();
      tables[name] = { count: rows.length, sha256: sha(JSON.stringify(rows)) };
    }
    return { workspaceId: db.prepare("SELECT value FROM workspace WHERE key='id'").get().value, tables };
  } finally { db.close(); }
}
export async function 维护前正常备份(prepared) {
  if (spawnSync('lsof', ['-t', '-nP', '-iTCP:3100', '-sTCP:LISTEN']).status !== 1 || existsSync(join(dataRoot, '.实例锁.json'))) throw Error('3100或实例锁仍在，必须正常停止');
  if (spawnSync('lsof', ['+D', dataRoot]).status !== 1) throw Error('正式数据仍在使用');
  const before = 工作区表摘要(dataRoot), storage = await 加载分类容量磁盘服务(prepared.integration);
  const output = mkdtempSync(join(根目录, '.运行/output/分类容量3100切换-'));
  const workspace = storage.openWorkspace({ dataRoot }); let backup;
  try { backup = await workspace.createBackup(); } finally { workspace.close(); }
  if (existsSync(join(dataRoot, '.实例锁.json')) || JSON.stringify(工作区表摘要(dataRoot)) !== JSON.stringify(before)) throw Error('维护备份改变业务表或未正常关锁');
  const recovered = join(output, '备份恢复核验'); storage.restoreBackup({ backupRoot: backup.path, targetRoot: recovered });
  if (JSON.stringify(工作区表摘要(recovered)) !== JSON.stringify(before)) throw Error('备份恢复不一致');
  const result = { passed: true, date: new Date().toISOString(), dataRoot, before, backupPath: backup.path, recovered, productionRowsUnchanged: true, credentialsDecryptedByCheck: false };
  writeFileSync(join(output, '切换前备份.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return { output, passed: true, workspaceId: before.workspaceId, backupPath: backup.path };
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const [mode, file, digest, confirmation] = process.argv.slice(2);
  if (mode === '--准备' && process.argv.length === 3) emit(await 准备分类容量日常包());
  else if (['--检查', '--维护备份', '--启动'].includes(mode) && process.argv.length === (mode === '--启动' ? 6 : 5)) {
    const prepared = 核验分类容量日常包(file, digest);
    if (mode === '--检查') emit({ passed: true, realDataOpened: false });
    else if (mode === '--维护备份') emit(await 维护前正常备份(prepared));
    else {
      if (confirmation !== '--已保存并关闭' || !process.stdin.isTTY) throw Error('需要当前保存关闭确认及交互控制台');
      const helper = 核验稳定助手(prepared.baseline), storage = await 加载分类容量磁盘服务(prepared.integration);
      const { startDailyWorkbench } = await import(pathToFileURL(join(prepared.integration.副本, '扩展功能/本机服务/日常工作台.mjs')).href);
      const app = await startDailyWorkbench({ webRoot: prepared.webRoot, storage, helperPath: helper.helperPath,
        helperSHA256: prepared.baseline.manifest.helper.sha256, savedAndClosed: true, initialize: false });
      emit({ phase: 'ready', pid: process.pid, origin: app.origin, workspaceId: app.workspaceId, status: app.getStatus(), initialize: false });
      const timer = setInterval(async () => {
        try { const r = await fetch(app.origin + '/logo.svg', { method: 'HEAD', signal: AbortSignal.timeout(3000) }); await r.body?.cancel(); emit({ phase: 'heartbeat', pid: process.pid, http: r.status }); }
        catch { emit({ phase: 'heartbeat-failed', pid: process.pid }); }
      }, 15000);
      try { await 管理日常会话(app, { input: process.stdin, emit }); } finally { clearInterval(timer); }
    }
  } else throw Error('只支持准备、检查、正常维护备份和已确认启动；不支持首次初始化或自动停止其他服务');
}
