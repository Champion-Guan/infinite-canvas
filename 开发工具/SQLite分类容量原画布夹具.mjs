import { createRequire } from 'node:module';
import { mkdtempSync, realpathSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { 读取分类容量隔离记录, 核验分类容量完整包, 加载分类容量磁盘服务 } from './接入SQLite分类容量隔离副本.mjs';
import { createShardedApplicationStorage } from '../扩展功能/本机存储/分片应用存储.mjs';

// 完整原React设置与画布；只从本次批准的磁盘服务包加载，不使用内存候选。
export async function createCategorizedCanvasFixture({ reviewRecord }) {
  const integration = 读取分类容量隔离记录(reviewRecord);
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'guan-usage-original-'))), web = join(integration.副本, 'web');
  const require = createRequire(join(web, 'package.json')), ts = require('typescript');
  const config = ts.readConfigFile(join(web, 'tsconfig.json'), ts.sys.readFile);
  if (config.error) throw Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, web);
  const program = ts.createProgram(parsed.fileNames, { ...parsed.options, incremental: false, noEmit: true });
  const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
  if (diagnostics.length) throw Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCurrentDirectory: () => web, getCanonicalFileName: path => path, getNewLine: () => '\n' }));
  console.log('分类容量及自动避让完整磁盘TS类型检查通过。');
  const { build } = await import(pathToFileURL(require.resolve('vite')).href), dist = join(root, 'dist');
  await build({ root: web, configFile: join(web, 'vite.config.ts'), cacheDir: join(root, 'node_modules/.vite'), logLevel: 'warn',
    build: { outDir: dist, emptyOutDir: false }, css: { postcss: { plugins: [require('@tailwindcss/postcss')({ base: join(web, 'src') })] } } });
  核验分类容量完整包(integration.组合包, true);
  const approved = await 加载分类容量磁盘服务(integration);
  const { startIsolatedAuthorizedWorkbench } = await import(pathToFileURL(join(integration.副本, '扩展功能/本机服务/受限工作台启动器.mjs')).href);
  let workspace, service, launcher, app;
  const material = randomBytes(32), credentialKeyProvider = { read: async () => Buffer.from(material), create: async () => Buffer.from(material) };
  try {
    launcher = await startIsolatedAuthorizedWorkbench({ webRoot: dist, dataRoot: join(root, '数据'), initialize: true, credentialKeyProvider,
      endpoint: { hostname: 'localhost', port: 0 }, storage: { ...approved,
        openWorkspace(options) { workspace = approved.openWorkspace(options); return workspace; },
        async startDataService(options) { service = await approved.startDataService(options); return service; } } });
    app = createShardedApplicationStorage({ client: { readDocument: (...args) => workspace.readDocument(...args),
      writeDocument: value => workspace.writeDocument(value), readMedia: id => workspace.readMedia(id),
      async writeMedia(blob) { return workspace.writeMedia(Buffer.from(await blob.arrayBuffer()), blob.type); } } });
    const store = name => app.createInstance({ storeName: name });
    const image = new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2nJ6kAAAAASUVORK5CYII=', 'base64')], { type: 'image/png' });
    await store('image_files').setItem('synthetic-image', image); await store('image_previews').setItem('synthetic-preview', image);
    await store('media_files').setItem('synthetic-video', new Blob(['synthetic-video'], { type: 'video/mp4' }));
    await store('media_files').setItem('synthetic-audio', new Blob(['synthetic-audio'], { type: 'audio/ogg' }));
    await store('prompt_cache').setItem('synthetic-prompt', '分类容量合成记录'); await app.flush();
    return { ...launcher, integration, root, dataRoot: join(root, '数据'), dataURL: service.url, workspace,
      async addPrompt() { await store('prompt_cache').setItem('synthetic-prompt-two', '手动刷新合成记录'); },
      async readCanvas() { const value = await app.createInstance().getItem('infinite-canvas:canvas_store'); return value ? JSON.parse(value) : null; },
      async close() { try { app.close(); await launcher.close(); } finally { material.fill(0); } } };
  } catch (error) { try { app?.close(); await launcher?.close(); } finally { material.fill(0); } throw error; }
}
