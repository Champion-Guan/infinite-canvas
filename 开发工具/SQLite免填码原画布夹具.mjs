import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { 根目录 } from './公共.mjs';
import { 建立SQLite免填码隔离副本, 加载SQLite免填码隔离启动器 } from './接入SQLite免填码隔离副本.mjs';
import { 建立SQLite写入协调隔离服务, 加载SQLite写入协调隔离服务 } from './接入SQLite写入协调隔离服务.mjs';
import { 检查免填码后继, 核验免填码自有依赖 } from '../上游适配/SQLite免填码启动批准.mjs';

// 真实React画布和磁盘精确批准启动器；不注入host、授权码或应用运行时。
export async function createAutomaticCanvasFixture() {
  核验免填码自有依赖(根目录);
  const integration = 建立SQLite免填码隔离副本();
  const serviceIntegration = 建立SQLite写入协调隔离服务(), approved = await 加载SQLite写入协调隔离服务(serviceIntegration);
  const { startIsolatedAuthorizedWorkbench } = await 加载SQLite免填码隔离启动器(integration);
  const root = mkdtempSync(join(tmpdir(), 'guan-stage6-auto-canvas-')), web = join(integration.副本, 'web');
  const require = createRequire(join(web, 'package.json')), { build } = await import(pathToFileURL(require.resolve('vite')).href), dist = join(root, 'dist');
  await build({ root: web, configFile: join(web, 'vite.config.ts'), cacheDir: join(root, 'node_modules/.vite'), logLevel: 'warn',
    build: { outDir: dist, emptyOutDir: false }, css: { postcss: { plugins: [require('@tailwindcss/postcss')({ base: join(web, 'src') })] } } });
  if (!检查免填码后继(integration.副本)) throw Error('构建后免填码副本完整性未通过');
  核验免填码自有依赖(根目录);
  let workspace, service;
  const storage = { ...approved, openWorkspace(options) { workspace = approved.openWorkspace(options); return workspace; },
    async startDataService(options) { service = await approved.startDataService(options); return service; } };
  const launcher = await startIsolatedAuthorizedWorkbench({ webRoot: dist, dataRoot: join(root, '数据'), initialize: true, storage });
  return { ...launcher, root, dataRoot: join(root, '数据'), workspace, dataURL: service.url, integration, serviceIntegration, createBackup: () => service.createBackup() };
}
