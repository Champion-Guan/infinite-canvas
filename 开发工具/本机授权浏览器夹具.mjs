import { createServer } from 'node:http';
import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createSessionController } from '../扩展功能/本机服务/受控会话.mjs';
import { createLocalAuthorizationGateway } from '../扩展功能/本机服务/本机授权网关.mjs';
import { 建立SQLite写入协调隔离服务, 加载SQLite写入协调隔离服务 } from './接入SQLite写入协调隔离服务.mjs';

export async function createAuthorizationBrowserFixture() {
  const integration = 建立SQLite写入协调隔离服务(), storage = await 加载SQLite写入协调隔离服务(integration);
  const root = mkdtempSync(join(tmpdir(), 'guan-stage6-auth-ui-'));
  const modules = new Map(['协议.mjs', '浏览器适配.mjs', '续期数据客户端.mjs', '应用存储适配.mjs', '应用值编码.mjs', '本机授权客户端.mjs'].map(name => ['/modules/' + name, readFileSync(new URL('../扩展功能/本机存储/' + name, import.meta.url))]));
  modules.set('/页面.mjs', readFileSync(new URL('./本机授权浏览器页面.mjs', import.meta.url)));
  const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>本机授权隔离验收</title>
  <main><h1>本机存储授权 · 隔离验收</h1><p>只使用临时合成数据库，不接入3100或旧数据。</p>
  <form><label>本机入口的一次性授权码<input type="password" autocomplete="off" spellcheck="false" required></label><button disabled>授权连接</button></form>
  <p role="status">尚未授权</p><label><input id="lose-response" type="checkbox">模拟一次保存响应丢失（仅隔离测试）</label>
  <p><button id="save" disabled>保存合成记录</button><button id="retry" disabled>重试同一笔保存</button><button id="close" disabled>撤销本页授权</button></p>
  </main><script type="module" src="/页面.mjs"></script></html>`;
  let gateway, controller, service, workspace;
  const paths = [];
  const server = createServer(async (req, res) => {
    paths.push(req.url); // 验收另核对路径无授权码；不记录请求体或请求头。
    if (gateway && await gateway.handle(req, res)) return;
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'self'; connect-src 'self' ${service?.url ?? ''}; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`);
    if (req.headers.host !== server.address().address + ':' + server.address().port || req.method !== 'GET') { res.writeHead(403); res.end(); return; }
    let path; try { path = decodeURIComponent(req.url); } catch { res.writeHead(400); res.end(); return; }
    if (path === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html); return; }
    if (modules.has(path)) { res.setHeader('Content-Type', 'text/javascript; charset=utf-8'); res.end(modules.get(path)); return; }
    res.writeHead(404); res.end();
  });
  server.requestTimeout = 5000; server.headersTimeout = 5000; server.keepAliveTimeout = 100; server.maxConnections = 16; server.maxHeadersCount = 32;
  try {
    await new Promise((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', done); });
    const origin = 'http://127.0.0.1:' + server.address().port;
    workspace = storage.openWorkspace({ dataRoot: join(root, '数据'), initialize: true });
    service = await storage.startDataService({ workspace, allowedOrigins: [origin] });
    controller = createSessionController({ service, origin });
    gateway = createLocalAuthorizationGateway({ origin, dataURL: service.url, controller });
    return { root, origin, paths, workspace, dataURL: service.url, issueTicket: () => gateway.issueTicket(), getStatus: () => gateway.getStatus(), integration,
      async close() { gateway.close(); controller.close(); await new Promise(done => server.close(done)); await service.close(); workspace.close(); } };
  } catch (error) { gateway?.close(); controller?.close(); if (server.listening) await new Promise(done => server.close(done)); await service?.close(); workspace?.close(); throw error; }
}
