import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { 根目录 } from './公共.mjs';
import { 建立SQLite工作台授权隔离副本 } from './接入SQLite工作台授权隔离副本.mjs';
import { 建立SQLite写入协调隔离服务, 加载SQLite写入协调隔离服务 } from './接入SQLite写入协调隔离服务.mjs';
import { 核验授权入口自有依赖, 检查授权入口后继 } from '../上游适配/SQLite工作台授权入口批准.mjs';
import { 建立SQLite媒体隔离启动器, 加载SQLite媒体隔离启动器 } from './接入SQLite临时媒体隔离启动器.mjs';

// 唯一新增核心接入来自获批9文件事务。使用真实授权入口，不注入host/会话/运行时。
export async function createAuthorizedCanvasFixture() {
  核验授权入口自有依赖(根目录);
  const integration = 建立SQLite工作台授权隔离副本();
  const serviceIntegration = 建立SQLite写入协调隔离服务(), approved = await 加载SQLite写入协调隔离服务(serviceIntegration);
  const launcherIntegration = 建立SQLite媒体隔离启动器(), { startIsolatedAuthorizedWorkbench } = await 加载SQLite媒体隔离启动器(launcherIntegration);
  const root = mkdtempSync(join(tmpdir(), 'guan-stage6-authorized-canvas-')), web = join(integration.副本, 'web');
  const require = createRequire(join(web, 'package.json')), { build } = await import(pathToFileURL(require.resolve('vite')).href);
  const dist = join(root, 'dist');
  await build({ root: web, configFile: join(web, 'vite.config.ts'), cacheDir: join(root, 'node_modules/.vite'), logLevel: 'warn',
    build: { outDir: dist, emptyOutDir: false }, css: { postcss: { plugins: [require('@tailwindcss/postcss')({ base: join(web, 'src') })] } } });
  if (!检查授权入口后继(integration.副本)) throw Error('构建后授权副本完整性未通过');
  核验授权入口自有依赖(根目录);
  let workspace, service;
  const storage = { ...approved, openWorkspace(options) { workspace = approved.openWorkspace(options); return workspace; },
    async startDataService(options) { service = await approved.startDataService(options); return service; } };
  const launcher = await startIsolatedAuthorizedWorkbench({ webRoot: dist, dataRoot: join(root, '数据'), initialize: true, storage });
  return { ...launcher, root, dataRoot: join(root, '数据'), workspace, dataURL: service.url, integration, serviceIntegration, launcherIntegration,
    createBackup: () => service.createBackup() };
}
