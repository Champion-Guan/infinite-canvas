import { createRequire } from 'node:module';
import { mkdtempSync, realpathSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { 读取视区跟随隔离记录, 核验视区跟随完整包, 加载视区跟随磁盘服务 } from './接入新建卡片视区跟随隔离副本.mjs';
import { createShardedApplicationStorage } from '../扩展功能/本机存储/分片应用存储.mjs';

// 独立观察浏览器写入时，每次读取新一代根目录；不能复用应用会话的已加载缓存。
export async function readFreshRevealCanvas(client) {
  const reader = createShardedApplicationStorage({ client });
  try {
    const value = await reader.createInstance().getItem('infinite-canvas:canvas_store');
    return value ? JSON.parse(value) : null;
  } finally { reader.close(); }
}

// 真实原React画布、批准磁盘服务和空白临时SQLite。不注入简化页面或生产授权材料。
export async function createRevealCanvasFixture({ reviewRecord }) {
  const integration = 读取视区跟随隔离记录(reviewRecord);
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'guan-reveal-original-'))), web = join(integration.副本, 'web');
  const require = createRequire(join(web, 'package.json')), ts = require('typescript');
  const config = ts.readConfigFile(join(web, 'tsconfig.json'), ts.sys.readFile);
  if (config.error) throw Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, web);
  const program = ts.createProgram(parsed.fileNames, { ...parsed.options, incremental: false, noEmit: true });
  const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
  if (diagnostics.length) throw Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCurrentDirectory: () => web, getCanonicalFileName: path => path, getNewLine: () => '\n' }));
  console.log('视区跟随完整磁盘TS类型检查通过。');
  const { build } = await import(pathToFileURL(require.resolve('vite')).href), dist = join(root, 'dist');
  await build({ root: web, configFile: join(web, 'vite.config.ts'), cacheDir: join(root, 'node_modules/.vite'), logLevel: 'warn',
    build: { outDir: dist, emptyOutDir: false }, css: { postcss: { plugins: [require('@tailwindcss/postcss')({ base: join(web, 'src') })] } } });
  核验视区跟随完整包(integration.组合包, true);
  const approved = await 加载视区跟随磁盘服务(integration);
  const { startIsolatedAuthorizedWorkbench } = await import(pathToFileURL(join(integration.副本, '扩展功能/本机服务/受限工作台启动器.mjs')).href);
  let workspace, service, launcher;
  const material = randomBytes(32), credentialKeyProvider = { read: async () => Buffer.from(material), create: async () => Buffer.from(material) };
  try {
    launcher = await startIsolatedAuthorizedWorkbench({ webRoot: dist, dataRoot: join(root, '数据'), initialize: true, credentialKeyProvider,
      endpoint: { hostname: 'localhost', port: 0 }, storage: { ...approved,
        openWorkspace(options) { workspace = approved.openWorkspace(options); return workspace; },
        async startDataService(options) { service = await approved.startDataService(options); return service; } } });
    const client = { readDocument: (...args) => workspace.readDocument(...args),
      writeDocument: value => workspace.writeDocument(value), readMedia: id => workspace.readMedia(id),
      async writeMedia(blob) { return workspace.writeMedia(Buffer.from(await blob.arrayBuffer()), blob.type); } };
    return { ...launcher, integration, root, dataRoot: join(root, '数据'), dataURL: service.url, workspace,
      readCanvas: () => readFreshRevealCanvas(client),
      async close() { try { await launcher.close(); } finally { material.fill(0); } } };
  } catch (error) { try { await launcher?.close(); } finally { material.fill(0); } throw error; }
}
