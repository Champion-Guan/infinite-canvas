// 本轮完整批准包的真实UI/SQLite隔离夹具，不接触日常服务和客户数据。
import { createRequire } from 'node:module';
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline';
import { DatabaseSync } from 'node:sqlite';
import { 读取Excel删除字体平滑隔离记录, 核验Excel删除字体平滑完整包, 加载Excel删除字体平滑磁盘服务 } from './接入Excel删除字体平滑隔离副本.mjs';
import { readFreshRevealCanvas } from './视区跟随原画布夹具.mjs';

export async function createDeleteSmoothingFixture(record) {
  const integration = 读取Excel删除字体平滑隔离记录(record);
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'guan-delete-smoothing-'))), web = join(integration.副本, 'web');
  const require = createRequire(join(web, 'package.json')), ts = require('typescript');
  const config = ts.readConfigFile(join(web, 'tsconfig.json'), ts.sys.readFile);
  if (config.error) throw Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, web);
  const program = ts.createProgram(parsed.fileNames, { ...parsed.options, incremental: false, noEmit: true });
  const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
  if (diagnostics.length) throw Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCurrentDirectory: () => web, getCanonicalFileName: p => p, getNewLine: () => '\n' }));
  console.log('DELETE_SMOOTHING_DISK_TYPES_OK');
  const { build } = await import(pathToFileURL(require.resolve('vite')).href), dist = join(root, 'dist');
  await build({ root: web, configFile: join(web, 'vite.config.ts'), cacheDir: join(root, 'node_modules/.vite'), logLevel: 'warn',
    build: { outDir: dist, emptyOutDir: false }, css: { postcss: { plugins: [require('@tailwindcss/postcss')({ base: join(web, 'src') })] } } });
  核验Excel删除字体平滑完整包(integration.组合包, true);
  const approved = await 加载Excel删除字体平滑磁盘服务(integration);
  const { startIsolatedAuthorizedWorkbench } = await import(pathToFileURL(join(integration.副本, '扩展功能/本机服务/受限工作台启动器.mjs')).href);
  const material = randomBytes(32), dataRoot = join(root, '数据');
  let workspace, service, launcher, initialized = false;
  let failWrites = false;
  const commits = [];
  async function start() {
    launcher = await startIsolatedAuthorizedWorkbench({ webRoot: dist, dataRoot, initialize: !initialized,
      credentialKeyProvider: { read: async () => Buffer.from(material), create: async () => Buffer.from(material) },
      endpoint: { hostname: 'localhost', port: 0 }, storage: { ...approved,
        openWorkspace(options) { workspace = approved.openWorkspace({ ...options, beforeCommit(info) { if (failWrites) throw Error('DELETE_SMOOTHING_SYNTHETIC_COMMIT_FAILURE'); commits.push(info); } }); return workspace; },
        async startDataService(options) { service = await approved.startDataService({ ...options, sessionTTL: 10 * 60_000 }); return service; } } });
    initialized = true; return { origin: launcher.origin, root, dataRoot };
  }
  const client = () => ({ readDocument: (...args) => workspace.readDocument(...args), readMedia: id => workspace.readMedia(id) });
  async function stop() { if (launcher) { const current = launcher; launcher = null; await current.close(); } }
  try {
    const info = await start();
    return { ...info,
      setWriteFailure(value) { failWrites = value === true; return { failWrites }; },
      async evidence() {
        const canvas = await readFreshRevealCanvas(client());
        const artifact = join(root, '画布证据-' + Date.now() + '.json');
        writeFileSync(artifact, JSON.stringify(canvas, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
        return { artifact, canvas, commits: commits.length };
      }, stop,
      async restart() { await stop(); return start(); },
      coldCheck() {
        if (launcher) throw Error('先正常停止本轮服务');
        const db = new DatabaseSync(join(dataRoot, '工作台.sqlite'), { readOnly: true });
        try { return { integrity: db.prepare('PRAGMA integrity_check').get().integrity_check,
          foreignKeys: db.prepare('PRAGMA foreign_key_check').all().length,
          documents: db.prepare('SELECT collection,id,revision,hash FROM documents ORDER BY collection,id').all() }; }
        finally { db.close(); }
      },
      async close() { try { await stop(); } finally { material.fill(0); } },
    };
  } catch (error) { try { await stop(); } finally { material.fill(0); } throw error; }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.length !== 3 || !process.argv[2].startsWith('--隔离记录=')) throw Error('只接受本轮工作簿删除隔离记录');
  const fixture = await createDeleteSmoothingFixture(process.argv[2].slice('--隔离记录='.length));
  console.log('DELETE_SMOOTHING_READY ' + JSON.stringify({ origin: fixture.origin, root: fixture.root, dataRoot: fixture.dataRoot }));
  const input = createInterface({ input: process.stdin });
  for await (const line of input) {
    try {
      const command = JSON.parse(line);
      if (command.op === 'evidence') console.log('DELETE_SMOOTHING_RESULT ' + JSON.stringify(await fixture.evidence()));
      else if (command.op === 'fault') console.log('DELETE_SMOOTHING_RESULT ' + JSON.stringify(fixture.setWriteFailure(command.enabled)));
      else if (command.op === 'stop') { await fixture.stop(); console.log('DELETE_SMOOTHING_RESULT ' + JSON.stringify(fixture.coldCheck())); }
      else if (command.op === 'restart') console.log('DELETE_SMOOTHING_RESULT ' + JSON.stringify(await fixture.restart()));
      else if (command.op === 'exit') break;
      else throw Error('未知控制命令');
    } catch (error) { console.log('DELETE_SMOOTHING_ERROR ' + error.message); }
  }
  input.close(); process.stdin.pause(); await fixture.close();
}
