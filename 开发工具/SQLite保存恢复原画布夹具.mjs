import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { 根目录 } from './公共.mjs';
import { 建立SQLite保存恢复隔离副本, 加载SQLite保存恢复隔离启动器 } from './接入SQLite保存恢复隔离副本.mjs';
import { 建立SQLite写入协调隔离服务, 加载SQLite写入协调隔离服务 } from './接入SQLite写入协调隔离服务.mjs';
import { 检查保存恢复后继, 核验保存恢复自有依赖 } from '../上游适配/SQLite保存恢复批准.mjs';

// 完整真实React画布、批准磁盘启动器与新临时库；不注入host或授权材料。
export async function createRecoveryCanvasFixture() {
  核验保存恢复自有依赖(根目录);
  const integration = 建立SQLite保存恢复隔离副本();
  const serviceIntegration = 建立SQLite写入协调隔离服务(), approved = await 加载SQLite写入协调隔离服务(serviceIntegration);
  const { startIsolatedAuthorizedWorkbench } = await 加载SQLite保存恢复隔离启动器(integration);
  const root = mkdtempSync(join(tmpdir(), 'guan-stage6-recovery-canvas-')), web = join(integration.副本, 'web');
  const require = createRequire(join(web, 'package.json')), { build } = await import(pathToFileURL(require.resolve('vite')).href), dist = join(root, 'dist');
  await build({ root: web, configFile: join(web, 'vite.config.ts'), cacheDir: join(root, 'node_modules/.vite'), logLevel: 'warn',
    build: { outDir: dist, emptyOutDir: false }, css: { postcss: { plugins: [require('@tailwindcss/postcss')({ base: join(web, 'src') })] } } });
  if (!检查保存恢复后继(integration.副本)) throw Error('构建后保存恢复副本完整性未通过');
  核验保存恢复自有依赖(根目录);
  let workspace, service;
  const storage = { ...approved, openWorkspace(options) { workspace = approved.openWorkspace(options); return workspace; },
    async startDataService(options) { service = await approved.startDataService(options); return service; } };
  const launcher = await startIsolatedAuthorizedWorkbench({ webRoot: dist, dataRoot: join(root, '数据'), initialize: true, storage });
  return { ...launcher, root, dataRoot: join(root, '数据'), workspace, dataURL: service.url, integration, serviceIntegration, createBackup: () => service.createBackup() };
}
