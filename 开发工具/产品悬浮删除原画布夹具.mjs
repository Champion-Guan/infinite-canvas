import { createRequire } from 'node:module';
import { mkdtempSync, realpathSync } from 'node:fs';
import { randomBytes, createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline';
import { DatabaseSync } from 'node:sqlite';
import { 读取产品删除隔离记录, 核验产品删除完整包, 加载产品删除磁盘服务 } from './接入产品悬浮删除隔离副本.mjs';
import { readFreshRevealCanvas } from './视区跟随原画布夹具.mjs';

// 批准磁盘包、临时空SQLite、进程内随机主密钥。无生产路径、Keychain或外部API。
export async function createProductDeleteFixture({ reviewRecord }) {
  const integration = 读取产品删除隔离记录(reviewRecord);
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'guan-product-delete-original-'))), web = join(integration.副本, 'web');
  const require = createRequire(join(web, 'package.json')), ts = require('typescript');
  const config = ts.readConfigFile(join(web, 'tsconfig.json'), ts.sys.readFile);
  if (config.error) throw Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, web);
  const program = ts.createProgram(parsed.fileNames, { ...parsed.options, incremental: false, noEmit: true });
  const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
  if (diagnostics.length) throw Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCurrentDirectory: () => web, getCanonicalFileName: path => path, getNewLine: () => '\n' }));
  console.log('产品悬浮删除完整磁盘TS类型检查通过。');
  const { build } = await import(pathToFileURL(require.resolve('vite')).href), dist = join(root, 'dist');
  await build({ root: web, configFile: join(web, 'vite.config.ts'), cacheDir: join(root, 'node_modules/.vite'), logLevel: 'warn',
    build: { outDir: dist, emptyOutDir: false }, css: { postcss: { plugins: [require('@tailwindcss/postcss')({ base: join(web, 'src') })] } } });
  核验产品删除完整包(integration.组合包, true);
  const approved = await 加载产品删除磁盘服务(integration);
  const { startIsolatedAuthorizedWorkbench } = await import(pathToFileURL(join(integration.副本, '扩展功能/本机服务/受限工作台启动器.mjs')).href);
  let workspace, service, launcher, initialized = false;
  const material = randomBytes(32), dataRoot = join(root, '数据');
  const credentialKeyProvider = { read: async () => Buffer.from(material), create: async () => Buffer.from(material) };
  async function start() {
    launcher = await startIsolatedAuthorizedWorkbench({ webRoot: dist, dataRoot, initialize: !initialized, credentialKeyProvider,
      // 受限启动器只允许随机临时端口0或另行授权的3100；重开不能复用已分配端口。
      endpoint: { hostname: 'localhost', port: 0 }, storage: { ...approved,
        openWorkspace(options) { workspace = approved.openWorkspace(options); return workspace; },
        async startDataService(options) { service = await approved.startDataService(options); return service; } } });
    initialized = true;
    return { origin: launcher.origin, dataURL: service.url, root, dataRoot };
  }
  function readCanvas() {
    return readFreshRevealCanvas({ readDocument: (...args) => workspace.readDocument(...args), writeDocument: value => workspace.writeDocument(value),
      readMedia: id => workspace.readMedia(id), async writeMedia(blob) { return workspace.writeMedia(Buffer.from(await blob.arrayBuffer()), blob.type); } });
  }
  async function stop() { if (launcher) { const current = launcher; launcher = null; await current.close(); } }
  try {
    const info = await start();
    return { ...info, integration, readCanvas, stop,
      async restart() { await stop(); return start(); },
      coldCheck() {
        if (launcher) throw Error('须正常停止本轮服务再冷读');
        const db = new DatabaseSync(join(dataRoot, '工作台.sqlite'), { readOnly: true });
        try { return { integrity: db.prepare('PRAGMA integrity_check').get().integrity_check, foreignKeys: db.prepare('PRAGMA foreign_key_check').all().length,
          tables: db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() }; } finally { db.close(); }
      },
      // 只报告合成媒体存在/长度/哈希，不打印授权或主密钥。
      async media(id) {
        const result = await workspace.readMedia(id);
        if (!result) return null;
        const bytes = result.bytes ?? result.data ?? result;
        if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) return { exists: true, fields: Object.keys(result) };
        return { exists: true, length: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
      },
      async close() { try { await stop(); } finally { material.fill(0); } },
    };
  } catch (error) { try { await stop(); } finally { material.fill(0); } throw error; }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.length !== 3 || !process.argv[2].startsWith('--隔离记录=')) throw Error('仅接受产品删除隔离记录');
  const fixture = await createProductDeleteFixture({ reviewRecord: process.argv[2].slice('--隔离记录='.length) });
  console.log('DELETE_FIXTURE_READY ' + JSON.stringify({ origin: fixture.origin, dataURL: fixture.dataURL, root: fixture.root, dataRoot: fixture.dataRoot }));
  const input = createInterface({ input: process.stdin });
  for await (const line of input) {
    try {
      const command = JSON.parse(line);
      if (command.op === 'read') console.log('DELETE_RESULT ' + JSON.stringify(await fixture.readCanvas()));
      else if (command.op === 'media') console.log('DELETE_RESULT ' + JSON.stringify(await fixture.media(command.id)));
      else if (command.op === 'stop') { await fixture.stop(); console.log('DELETE_RESULT ' + JSON.stringify(fixture.coldCheck())); }
      else if (command.op === 'restart') console.log('DELETE_RESULT ' + JSON.stringify(await fixture.restart()));
      else if (command.op === 'exit') break;
      else throw Error('未知控制命令');
    } catch (error) { console.log('DELETE_ERROR ' + error.message); }
  }
  input.close(); process.stdin.pause(); await fixture.close();
}
