import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { DatabaseSync } from 'node:sqlite';
import { 根目录 } from './公共.mjs';
import { openWorkspace } from '../扩展功能/本机存储/SQLite工作区.mjs';
import { startDataService } from '../扩展功能/本机服务/数据服务.mjs';
import { createSessionController } from '../扩展功能/本机服务/可重连受控会话.mjs';
import { createLocalAuthorizationGateway } from '../扩展功能/本机服务/可重连授权网关.mjs';

// 独立自有测试页，仅serve内存构建。不得装配工作台副本、使用固定端口或外部数据根。
const require = createRequire(join(根目录, '.运行/Excel勾选事件-25SJER/组合包/画布副本/web/package.json'));
const { build } = createRequire(require.resolve('vite'))('esbuild');
const result = await build({ entryPoints: [join(根目录, '开发工具/会话恢复浏览器页面.tsx')], bundle: true, write: false,
  format: 'esm', platform: 'browser', target: 'es2022', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [{ name: 'synthetic-recovery-alias', setup(api) {
    api.onResolve({ filter: /^@\/guan\/上游浏览器存储桥$/ }, () => ({ path: join(根目录, '扩展功能/本机存储/可重连存储桥.ts') }));
    api.onResolve({ filter: /^react(?:\/.*)?$|^react-dom(?:\/.*)?$/ }, args => ({ path: require.resolve(args.path) }));
  } }],
});
const javascript = result.outputFiles[0].contents;
const root = mkdtempSync(join(tmpdir(), 'guan-session-browser-')), dataRoot = join(root, '数据');
const workspace = openWorkspace({ dataRoot, initialize: true });
let clockOffset = 0, gateway, controller, service;
const now = () => Date.now() + clockOffset;
const server = createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self' ${service?.url ?? ''}; frame-ancestors 'none'`);
  if (gateway && await gateway.handle(req, res)) return;
  if (req.headers.host !== 'localhost:' + server.address().port || req.method !== 'GET') { res.writeHead(403); res.end(); return; }
  if (req.url === '/fixture.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end(javascript); return; }
  if (req.url !== '/') { res.writeHead(404); res.end(); return; }
  const code = gateway.issueTicket().code;
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="guan-local-bootstrap" content="' + code + '"><title>会话恢复隔离验收</title></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>');
});
let listening = false;
try {
  await new Promise((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', done); }); listening = true;
  const origin = 'http://localhost:' + server.address().port;
  service = await startDataService({ workspace, allowedOrigins: [origin], sessionTTL: 60_000, now });
  controller = createSessionController({ service, origin, now });
  gateway = createLocalAuthorizationGateway({ origin, dataURL: service.url, controller, now });
  console.log('SESSION_BROWSER_READY ' + JSON.stringify({ origin, root, dataRoot, testOnlyClock: true }));
  const input = createInterface({ input: process.stdin });
  for await (const line of input) {
    const value = JSON.parse(line);
    if (value.op === 'expire') { clockOffset += 61_000; console.log('SESSION_BROWSER_CLOCK_ADVANCED'); }
    else if (value.op === 'read') console.log('SESSION_BROWSER_DATA ' + JSON.stringify(workspace.listDocuments('extension').map(doc => workspace.readDocument('extension', doc.id))));
    else if (value.op === 'exit') break;
    else throw Error('未知夹具命令');
  }
  input.close(); process.stdin.pause();
} finally {
  gateway?.close(); controller?.close();
  if (listening) await new Promise(done => server.close(done));
  await service?.close(); workspace.close();
  const db = new DatabaseSync(join(dataRoot, '工作台.sqlite'), { readOnly: true });
  try { console.log('SESSION_BROWSER_COLD ' + JSON.stringify({ integrity: db.prepare('PRAGMA integrity_check').get().integrity_check, foreignKeys: db.prepare('PRAGMA foreign_key_check').all().length })); }
  finally { db.close(); }
}
