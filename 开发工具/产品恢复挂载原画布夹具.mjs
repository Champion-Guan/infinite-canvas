import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, realpathSync } from 'node:fs';
import { randomBytes, createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline';
import { DatabaseSync } from 'node:sqlite';
import { 根目录 } from './公共.mjs';
import { 读取恢复挂载隔离记录, 核验恢复挂载完整包, 加载恢复挂载磁盘服务 } from './接入产品恢复挂载隔离副本.mjs';
import { readFreshRevealCanvas } from './视区跟随原画布夹具.mjs';
import { createShardedApplicationStorage } from '../扩展功能/本机存储/分片应用存储.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
// 原React页面、批准磁盘包、独立临时SQLite和内存随机主密钥，不使用真实用户或凭据。
export async function createProductRestoreFixture({ reviewRecord }) {
  const integration = 读取恢复挂载隔离记录(reviewRecord);
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'guan-product-restore-original-'))), web = join(integration.副本, 'web');
  const require = createRequire(join(web, 'package.json')), ts = require('typescript');
  const config = ts.readConfigFile(join(web, 'tsconfig.json'), ts.sys.readFile);
  if (config.error) throw Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, web);
  const program = ts.createProgram(parsed.fileNames, { ...parsed.options, incremental: false, noEmit: true });
  const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
  if (diagnostics.length) throw Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCurrentDirectory: () => web, getCanonicalFileName: path => path, getNewLine: () => '\n' }));
  console.log('恢复挂载完整磁盘TS类型检查通过。');
  const { build } = await import(pathToFileURL(require.resolve('vite')).href), dist = join(root, 'dist');
  await build({ root: web, configFile: join(web, 'vite.config.ts'), cacheDir: join(root, 'node_modules/.vite'), logLevel: 'warn',
    build: { outDir: dist, emptyOutDir: false }, css: { postcss: { plugins: [require('@tailwindcss/postcss')({ base: join(web, 'src') })] } } });
  核验恢复挂载完整包(integration.组合包, true);
  const approved = await 加载恢复挂载磁盘服务(integration);
  const { startIsolatedAuthorizedWorkbench } = await import(pathToFileURL(join(integration.副本, '扩展功能/本机服务/受限工作台启动器.mjs')).href);
  let workspace, service, launcher, initialized = false;
  const material = randomBytes(32), dataRoot = join(root, '数据');
  const credentialKeyProvider = { read: async () => Buffer.from(material), create: async () => Buffer.from(material) };
  async function start() {
    launcher = await startIsolatedAuthorizedWorkbench({ webRoot: dist, dataRoot, initialize: !initialized, credentialKeyProvider,
      endpoint: { hostname: 'localhost', port: 0 }, storage: { ...approved,
        openWorkspace(options) { workspace = approved.openWorkspace(options); return workspace; },
        async startDataService(options) { service = await approved.startDataService(options); return service; } } });
    initialized = true; return { origin: launcher.origin, dataURL: service.url, root, dataRoot };
  }
  const client = () => ({ readDocument: (...args) => workspace.readDocument(...args), writeDocument: value => workspace.writeDocument(value),
    readMedia: id => workspace.readMedia(id), async writeMedia(blob) { return workspace.writeMedia(Buffer.from(await blob.arrayBuffer()), blob.type); } });
  const readCanvas = () => readFreshRevealCanvas(client());
  const png = readFileSync(join(根目录, '.运行/output/playwright/产品悬浮删除-20261018/产品回收验收.png'));
  const mediaSHA256 = sha(png), storageKey = 'image:restore-isolated-png';
  const a = { id: 'restore-product-A', title: '隔离产品A', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    nodes: [
      { id: 'restore-text-A', type: 'text', title: '恢复验收文本', position: { x: 80, y: 60 }, width: 260, height: 180,
        metadata: { content: '尺寸展示：128 × 128；保留原节点、连线和独立视区。', status: 'idle' } },
      { id: 'restore-image-A', type: 'image', title: '恢复验收图片', position: { x: 420, y: 60 }, width: 260, height: 260,
        metadata: { content: 'data:image/png;base64,' + png.toString('base64'), storageKey, naturalWidth: 128, naturalHeight: 128, bytes: png.length, mimeType: 'image/png', images: [] } },
    ], connections: [{ id: 'restore-edge-A', fromNodeId: 'restore-text-A', toNodeId: 'restore-image-A' }],
    chatSessions: [{ id: 'restore-chat-A', title: '合成历史对话', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
      messages: [{ id: 'restore-message-A', role: 'user', text: '仅隔离测试，不调用生成服务。', references: [] }] }],
    activeChatId: 'restore-chat-A', backgroundMode: 'lines', showImageInfo: true, viewport: { x: 50, y: 90, k: 0.9 } };
  const b = { id: 'restore-product-B', title: '隔离产品B', createdAt: '2026-01-02T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z',
    nodes: [{ id: 'restore-text-B', type: 'text', title: 'B独立内容', position: { x: 100, y: 100 }, width: 260, height: 180, metadata: { content: 'B内容不得被恢复A覆盖。', status: 'idle' } }],
    connections: [], chatSessions: [], activeChatId: null, backgroundMode: 'lines', showImageInfo: false, viewport: { x: -35, y: 20, k: 1.1 } };
  async function seed() {
    const app = createShardedApplicationStorage({ client: client() });
    try {
      await app.createInstance({ storeName: 'image_files' }).setItem(storageKey, new Blob([png], { type: 'image/png' }));
      await app.createInstance().setItem('infinite-canvas:canvas_store', JSON.stringify({ state: { projects: [b, a], deletedProjects: [] }, version: 0 }));
      await app.createInstance({ storeName: 'preferences' }).setItem('guan-products:active:v1', a.id);
      await app.flush();
    } finally { app.close(); }
  }
  function normalize(project) {
    const copy = structuredClone(project); delete copy.updatedAt;
    for (const node of copy.nodes) if (node.type === 'image') delete node.metadata.content;
    return copy;
  }
  async function verify() {
    const canvas = await readCanvas();
    for (const expected of [a, b]) {
      const actual = canvas.state.projects.find(item => item.id === expected.id) ?? canvas.state.deletedProjects.find(item => item.id === expected.id)?.project;
      assert.ok(actual, '缺少完整产品：' + expected.id); assert.deepEqual(normalize(actual), normalize(expected));
    }
    const media = workspace.readMedia(mediaSHA256); assert.deepEqual(media.bytes, png);
    return { status: 'pass', activeIds: canvas.state.projects.map(item => item.id), deletedIds: canvas.state.deletedProjects.map(item => item.id),
      textNodes: 2, imageNodes: 1, connections: 1, chatSessions: 1, distinctViewportsPreserved: true, mediaBytes: png.length, mediaSHA256 };
  }
  async function stop() { if (launcher) { const current = launcher; launcher = null; await current.close(); } }
  try {
    const info = await start(); await seed();
    return { ...info, integration, readCanvas, verify, stop,
      async restart() { await stop(); return start(); },
      coldCheck() {
        if (launcher) throw Error('须正常停止本轮服务再冷读');
        const db = new DatabaseSync(join(dataRoot, '工作台.sqlite'), { readOnly: true });
        try { return { integrity: db.prepare('PRAGMA integrity_check').get().integrity_check, foreignKeys: db.prepare('PRAGMA foreign_key_check').all().length }; }
        finally { db.close(); }
      },
      async close() { try { await stop(); } finally { material.fill(0); } },
    };
  } catch (error) { try { await stop(); } finally { material.fill(0); } throw error; }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.length !== 3 || !process.argv[2].startsWith('--隔离记录=')) throw Error('仅接受恢复挂载复审隔离记录');
  const fixture = await createProductRestoreFixture({ reviewRecord: process.argv[2].slice('--隔离记录='.length) });
  console.log('RESTORE_FIXTURE_READY ' + JSON.stringify({ origin: fixture.origin, dataURL: fixture.dataURL, root: fixture.root, dataRoot: fixture.dataRoot }));
  const input = createInterface({ input: process.stdin });
  for await (const line of input) {
    try {
      const command = JSON.parse(line);
      if (command.op === 'read') console.log('RESTORE_RESULT ' + JSON.stringify(await fixture.readCanvas()));
      else if (command.op === 'verify') console.log('RESTORE_RESULT ' + JSON.stringify(await fixture.verify()));
      else if (command.op === 'stop') { await fixture.stop(); console.log('RESTORE_RESULT ' + JSON.stringify(fixture.coldCheck())); }
      else if (command.op === 'restart') console.log('RESTORE_RESULT ' + JSON.stringify(await fixture.restart()));
      else if (command.op === 'exit') break;
      else throw Error('未知控制命令');
    } catch (error) { console.log('RESTORE_ERROR ' + error.message); }
  }
  input.close(); process.stdin.pause(); await fixture.close();
}
