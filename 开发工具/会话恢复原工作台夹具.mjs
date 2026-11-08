import { createRequire } from 'node:module';
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline';
import { DatabaseSync } from 'node:sqlite';
import { 读取SQLite会话恢复隔离记录, 核验SQLite会话恢复完整包, 加载SQLite会话恢复磁盘服务 } from './接入SQLite会话恢复隔离副本.mjs';
import { readFreshRevealCanvas } from './视区跟随原画布夹具.mjs';
import { createShardedApplicationStorage } from '../扩展功能/本机存储/分片应用存储.mjs';

export async function createSessionRecoveryWorkbenchFixture(reviewRecord) {
  const integration = 读取SQLite会话恢复隔离记录(reviewRecord);
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'guan-session-workbench-'))), web = join(integration.副本, 'web');
  const require = createRequire(join(web, 'package.json')), ts = require('typescript');
  const config = ts.readConfigFile(join(web, 'tsconfig.json'), ts.sys.readFile);
  if (config.error) throw Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, web);
  const program = ts.createProgram(parsed.fileNames, { ...parsed.options, incremental: false, noEmit: true });
  const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
  if (diagnostics.length) throw Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCurrentDirectory: () => web, getCanonicalFileName: p => p, getNewLine: () => '\n' }));
  console.log('会话恢复完整磁盘TS类型检查通过。');
  const { build } = await import(pathToFileURL(require.resolve('vite')).href), dist = join(root, 'dist');
  await build({ root: web, configFile: join(web, 'vite.config.ts'), cacheDir: join(root, 'node_modules/.vite'), logLevel: 'warn',
    build: { outDir: dist, emptyOutDir: false }, css: { postcss: { plugins: [require('@tailwindcss/postcss')({ base: join(web, 'src') })] } } });
  核验SQLite会话恢复完整包(integration.组合包, true);
  const approved = await 加载SQLite会话恢复磁盘服务(integration);
  const { startIsolatedAuthorizedWorkbench } = await import(pathToFileURL(join(integration.副本, '扩展功能/本机服务/受限工作台启动器.mjs')).href);
  const material = randomBytes(32), dataRoot = join(root, '数据');
  let workspace, service, launcher, initialized = false, sessionTTL = 45_000;
  async function start() {
    launcher = await startIsolatedAuthorizedWorkbench({ webRoot: dist, dataRoot, initialize: !initialized,
      credentialKeyProvider: { read: async () => Buffer.from(material), create: async () => Buffer.from(material) },
      endpoint: { hostname: 'localhost', port: 0 }, storage: { ...approved,
        openWorkspace(options) { workspace = approved.openWorkspace(options); return workspace; },
        async startDataService(options) { service = await approved.startDataService({ ...options, sessionTTL }); return service; } } });
    initialized = true; return { origin: launcher.origin, dataURL: service.url, root, dataRoot, sessionTTL };
  }
  const client = () => ({ readDocument: (...a) => workspace.readDocument(...a), writeDocument: v => workspace.writeDocument(v),
    readMedia: id => workspace.readMedia(id), async writeMedia(blob) { return workspace.writeMedia(Buffer.from(await blob.arrayBuffer()), blob.type); } });
  async function stop() { if (launcher) { const current = launcher; launcher = null; await current.close(); } }
  try {
    const info = await start();
    const app = createShardedApplicationStorage({ client: client() });
    try {
      await app.createInstance().setItem('infinite-canvas:canvas_store', JSON.stringify({ state: { projects: [{
        id: 'excel-existing', title: '迁入前合成画布', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
        nodes: [{ id: 'excel-existing-text', type: 'text', title: '保留文本', position: { x: 100, y: 100 }, width: 260, height: 180,
          metadata: { content: '仅合成数据；导入不能覆盖原有画布。', status: 'idle' } }],
        connections: [], chatSessions: [], activeChatId: null, backgroundMode: 'lines', showImageInfo: false, viewport: { x: 0, y: 0, k: 1 },
      }], deletedProjects: [] }, version: 0 }));
      await app.flush();
    } finally { app.close(); }
    return { ...info, integration, readCanvas: () => readFreshRevealCanvas(client()),
      async summary() {
        const canvas = await readFreshRevealCanvas(client()), state = canvas.state, books = state.guanWorkbooks;
        const result = { projects: state.projects.map(({ id, title, productSetId, nodes }) => ({ id, title, productSetId, nodes })),
          deletedProjects: state.deletedProjects, activeByWorkbook: books?.activeByWorkbook,
          workbooks: books?.contract.productSets.map(({ id, source, productIds }) => ({ id, source, productIds })),
          products: books?.contract.products.map(({ id, productSetId, order, sourceRowNumber, attributes }) => ({ id, productSetId, order, sourceRowNumber, attributes })) };
        const artifact = join(root, '工作簿证据-' + Date.now() + '.json');
        writeFileSync(artifact, JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
        return { artifact, ...result };
      }, stop,
      async restart(normal = false) { await stop(); if (normal) sessionTTL = 10 * 60_000; return start(); },
      coldCheck() {
        if (launcher) throw Error('先正常停止本轮服务');
        const db = new DatabaseSync(join(dataRoot, '工作台.sqlite'), { readOnly: true });
        try { return { integrity: db.prepare('PRAGMA integrity_check').get().integrity_check, foreignKeys: db.prepare('PRAGMA foreign_key_check').all().length }; }
        finally { db.close(); }
      },
      async close() { try { await stop(); } finally { material.fill(0); } },
    };
  } catch (error) { try { await stop(); } finally { material.fill(0); } throw error; }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.length !== 3 || !process.argv[2].startsWith('--隔离记录=')) throw Error('只接受本轮Excel隔离记录');
  const fixture = await createSessionRecoveryWorkbenchFixture(process.argv[2].slice('--隔离记录='.length));
  console.log('SESSION_WORKBENCH_READY ' + JSON.stringify({ origin: fixture.origin, dataURL: fixture.dataURL, root: fixture.root, dataRoot: fixture.dataRoot }));
  const input = createInterface({ input: process.stdin });
  for await (const line of input) {
    try {
      const command = JSON.parse(line);
      if (command.op === 'read') console.log('SESSION_WORKBENCH_RESULT ' + JSON.stringify(await fixture.readCanvas()));
      else if (command.op === 'summary') console.log('SESSION_WORKBENCH_RESULT ' + JSON.stringify(await fixture.summary()));
      else if (command.op === 'stop') { await fixture.stop(); console.log('SESSION_WORKBENCH_RESULT ' + JSON.stringify(fixture.coldCheck())); }
      else if (command.op === 'normal-restart') console.log('SESSION_WORKBENCH_RESULT ' + JSON.stringify(await fixture.restart(true)));
      else if (command.op === 'exit') break;
      else throw Error('未知控制命令');
    } catch (error) { console.log('SESSION_WORKBENCH_ERROR ' + error.message); }
  }
  input.close(); process.stdin.pause(); await fixture.close();
}
