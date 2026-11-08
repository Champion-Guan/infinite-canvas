import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { 根目录 } from './公共.mjs';
import { 建立SQLite配置合并隔离副本, 读取配置合并复验记录, 核验配置合并完整源码 } from './接入SQLite配置合并隔离副本.mjs';
import { 建立SQLite写入协调隔离服务, 加载SQLite写入协调隔离服务 } from './接入SQLite写入协调隔离服务.mjs';
import { 核验配置合并自有依赖 } from '../上游适配/SQLite配置合并批准.mjs';
import { 媒体启动器路径 } from '../上游适配/SQLite临时媒体策略批准.mjs';

export async function createCoalescedCredentialCanvasFixture({ prerequisiteRecord, reviewRecord } = {}) {
  核验配置合并自有依赖(根目录);
  const integration = reviewRecord ? 读取配置合并复验记录(reviewRecord) : 建立SQLite配置合并隔离副本(prerequisiteRecord);
  const root = mkdtempSync(join(tmpdir(), 'guan-stage6-coalesced-canvas-')), web = join(integration.副本, 'web'), require = createRequire(join(web, 'package.json'));
  const ts = require('typescript'), config = ts.readConfigFile(join(web, 'tsconfig.json'), ts.sys.readFile);
  if (config.error) throw Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, web), program = ts.createProgram(parsed.fileNames, { ...parsed.options, incremental: false, noEmit: true });
  const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
  if (diagnostics.length) throw Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCurrentDirectory: () => web, getCanonicalFileName: path => path, getNewLine: () => '\n' }));
  console.log('配置合并完整磁盘TS类型检查通过。');
  const { build } = await import(pathToFileURL(require.resolve('vite')).href), dist = join(root, 'dist');
  await build({ root: web, configFile: join(web, 'vite.config.ts'), cacheDir: join(root, 'node_modules/.vite'), logLevel: 'warn',
    build: { outDir: dist, emptyOutDir: false }, css: { postcss: { plugins: [require('@tailwindcss/postcss')({ base: join(web, 'src') })] } } });
  核验配置合并完整源码(integration.副本, true); 核验配置合并自有依赖(根目录);
  const serviceIntegration = 建立SQLite写入协调隔离服务(), approved = await 加载SQLite写入协调隔离服务(serviceIntegration);
  const { startIsolatedAuthorizedWorkbench } = await import(pathToFileURL(join(integration.副本, 媒体启动器路径)).href);
  let workspace, service;
  const storage = { ...approved, openWorkspace(options) { workspace = approved.openWorkspace(options); return workspace; },
    async startDataService(options) { service = await approved.startDataService(options); return service; } };
  const material = randomBytes(32), credentialKeyProvider = { read: async () => Buffer.from(material), create: async () => Buffer.from(material) };
  let launcher;
  try { launcher = await startIsolatedAuthorizedWorkbench({ webRoot: dist, dataRoot: join(root, '数据'), initialize: true, storage, credentialKeyProvider }); }
  catch (error) { material.fill(0); throw error; }
  return { ...launcher, root, dataRoot: join(root, '数据'), workspace, dataURL: service.url, integration, serviceIntegration,
    testKeyProvider: credentialKeyProvider, createBackup: () => service.createBackup(),
    async close() { try { await launcher.close(); } finally { material.fill(0); } } };
}
