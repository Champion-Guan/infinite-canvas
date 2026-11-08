import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { 根目录 } from './公共.mjs';
import { 读取卡片布局隔离记录, 核验卡片布局完整源码 } from './接入卡片自动避让隔离副本.mjs';
import { 加载SQLite写入协调隔离服务 } from './接入SQLite写入协调隔离服务.mjs';
import { 核验日常启动自有依赖 } from '../上游适配/SQLite日常启动批准.mjs';

// 只从获批后的磁盘副本构建原React；不调用正式日常API，不接3100/Keychain。
export async function createPlacementCanvasFixture({ reviewRecord } = {}) {
  核验日常启动自有依赖(根目录);
  const integration = 读取卡片布局隔离记录(reviewRecord);
  const root = mkdtempSync(join(tmpdir(), 'guan-stage7-placement-canvas-')), web = join(integration.副本, 'web'), require = createRequire(join(web, 'package.json'));
  const ts = require('typescript'), config = ts.readConfigFile(join(web, 'tsconfig.json'), ts.sys.readFile);
  if (config.error) throw Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, web), program = ts.createProgram(parsed.fileNames, { ...parsed.options, incremental: false, noEmit: true });
  const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
  if (diagnostics.length) throw Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCurrentDirectory: () => web, getCanonicalFileName: path => path, getNewLine: () => '\n' }));
  console.log('卡片布局完整磁盘TS类型检查通过。');
  const { build } = await import(pathToFileURL(require.resolve('vite')).href), dist = join(root, 'dist');
  await build({ root: web, configFile: join(web, 'vite.config.ts'), cacheDir: join(root, 'node_modules/.vite'), logLevel: 'warn',
    build: { outDir: dist, emptyOutDir: false }, css: { postcss: { plugins: [require('@tailwindcss/postcss')({ base: join(web, 'src') })] } } });
  核验卡片布局完整源码(integration.副本, true); 核验日常启动自有依赖(根目录);
  const serviceIntegration = JSON.parse(readFileSync(join(根目录, '.运行/SQLite写入协调-2XvqNB/写入协调接入记录.json')));
  const approved = await 加载SQLite写入协调隔离服务(serviceIntegration);
  const { startIsolatedAuthorizedWorkbench } = await import(pathToFileURL(join(integration.副本, '扩展功能/本机服务/受限工作台启动器.mjs')).href);
  let workspace, service;
  const storage = { ...approved, openWorkspace(options) { workspace = approved.openWorkspace(options); return workspace; },
    async startDataService(options) { service = await approved.startDataService(options); return service; } };
  const material = randomBytes(32), credentialKeyProvider = { read: async () => Buffer.from(material), create: async () => Buffer.from(material) };
  let launcher;
  try { launcher = await startIsolatedAuthorizedWorkbench({ webRoot: dist, dataRoot: join(root, '数据'), initialize: true, storage, credentialKeyProvider,
    endpoint: { hostname: 'localhost', port: 0 } }); }
  catch (error) { material.fill(0); throw error; }
  return { ...launcher, root, dataRoot: join(root, '数据'), workspace, dataURL: service.url, integration, serviceIntegration,
    testKeyProvider: credentialKeyProvider, createBackup: () => service.createBackup(),
    async close() { try { await launcher.close(); } finally { material.fill(0); } } };
}
