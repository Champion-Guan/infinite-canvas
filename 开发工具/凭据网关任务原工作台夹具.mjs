// 本轮全链批准包的真实React/SQLite启动夹具，不注入授权host，不使用默认Chrome。
import { createRequire } from 'node:module';
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline';
import { 读取凭据网关任务隔离记录, 核验凭据网关任务完整包, 加载凭据网关任务磁盘服务 } from './接入凭据网关任务隔离副本.mjs';
import { readFreshRevealCanvas } from './视区跟随原画布夹具.mjs';

export async function createGatewayWorkbenchFixture(record) {
  const integration = 读取凭据网关任务隔离记录(record), root = realpathSync(mkdtempSync(join(tmpdir(), 'guan-gateway-ui-'))), web = join(integration.副本, 'web');
  const require = createRequire(join(web, 'package.json')), ts = require('typescript');
  const config = ts.readConfigFile(join(web, 'tsconfig.json'), ts.sys.readFile);
  if (config.error) throw Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, web), program = ts.createProgram(parsed.fileNames, { ...parsed.options, incremental: false, noEmit: true });
  const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
  if (diagnostics.length) throw Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCurrentDirectory: () => web, getCanonicalFileName: p => p, getNewLine: () => '\n' }));
  console.log('GATEWAY_DISK_TYPES_OK');
  const { build } = await import(pathToFileURL(require.resolve('vite')).href), dist = join(root, 'dist');
  await build({ root: web, configFile: join(web, 'vite.config.ts'), cacheDir: join(root, 'cache'), logLevel: 'warn', build: { outDir: dist, emptyOutDir: false },
    css: { postcss: { plugins: [require('@tailwindcss/postcss')({ base: join(web, 'src') })] } } });
  核验凭据网关任务完整包(integration.组合包, true);
  console.log('GATEWAY_DISK_BUILD_OK');
  const approved = await 加载凭据网关任务磁盘服务(integration);
  const { startIsolatedAuthorizedWorkbench } = await import(pathToFileURL(join(integration.副本, '扩展功能/本机服务/受限工作台启动器.mjs')).href);
  const material = randomBytes(32), dataRoot = join(root, '数据'); let launcher, workspace, initialized = false;
  async function start() {
    launcher = await startIsolatedAuthorizedWorkbench({ webRoot: dist, dataRoot, initialize: !initialized,
      credentialKeyProvider: { read: async () => Buffer.from(material), create: async () => Buffer.from(material) }, endpoint: { hostname: 'localhost', port: 0 },
      storage: { ...approved, openWorkspace(options) { workspace = approved.openWorkspace(options); return workspace; } } });
    initialized = true; return { origin: launcher.origin, root, dataRoot };
  }
  async function stop() { if (launcher) { await launcher.close(); launcher = null; } }
  try {
    const info = await start();
    return { ...info, async evidence() {
      const canvas = await readFreshRevealCanvas({ readDocument: (...args) => workspace.readDocument(...args), readMedia: id => workspace.readMedia(id) });
      const artifact = join(root, '画布证据-' + Date.now() + '.json'), value = { canvas, status: launcher.getStatus() };
      writeFileSync(artifact, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); return { artifact, ...value };
    }, stop, async restart() { await stop(); return start(); }, async close() { try { await stop(); } finally { material.fill(0); } } };
  } catch (error) { try { await stop(); } finally { material.fill(0); } throw error; }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.length !== 3 || !process.argv[2].startsWith('--隔离记录=')) throw Error('只接受本轮凭据网关隔离记录');
  const fixture = await createGatewayWorkbenchFixture(process.argv[2].slice('--隔离记录='.length));
  console.log('GATEWAY_UI_READY ' + JSON.stringify({ origin: fixture.origin, root: fixture.root, dataRoot: fixture.dataRoot }));
  const input = createInterface({ input: process.stdin });
  for await (const line of input) {
    try {
      const command = JSON.parse(line);
      if (command.op === 'evidence') console.log('GATEWAY_UI_RESULT ' + JSON.stringify(await fixture.evidence()));
      else if (command.op === 'restart') console.log('GATEWAY_UI_RESULT ' + JSON.stringify(await fixture.restart()));
      else if (command.op === 'exit') break;
      else throw Error('未知控制命令');
    } catch (error) { console.log('GATEWAY_UI_ERROR ' + error.message); }
  }
  input.close(); process.stdin.pause(); await fixture.close();
}
