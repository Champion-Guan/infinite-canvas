import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { parseVersion } from '../软件更新/stable-version.mjs';
import { isWorkbenchOrigin } from '../本机服务/工作台端口.mjs';
import { 更新进度页面, 更新进度样式, 更新进度脚本 } from '../软件更新/更新进度页面.mjs';

// 状态由仍在运行的独立管理器提供；事务提交本身不能证明新服务已激活。
export function webProgressSnapshot(target, status, { transaction, service, alive }) {
  const relevant = status.targetVersion === target;
  const healthy = alive === true && service?.ready === true && service.acceptingPages !== false &&
    service.version === transaction?.current?.version && service.workspaceId === transaction?.workspaceId &&
    isWorkbenchOrigin(service.origin);
  let state = relevant ? status.state : 'unavailable';
  if (state === 'committed') state = transaction?.phase === 'committed' && transaction.current.version === target && healthy ? 'success' : 'starting';
  if (state === 'success' && status.managerVersion && status.managerVersion !== target) state = 'restarting-manager';
  if (state === 'rolled-back' && !(transaction?.phase === 'rolled-back' && healthy)) state = 'recovery-required';
  return { target, state, reason: relevant ? status.reason : null,
    currentVersion: status.currentVersion, origin: healthy ? service.origin : null,
    diagnostic: status.diagnostic || transaction?.diagnostic || null, waiting: status.waiting || null };
}

export async function serveWebUpdateProgress({ target, readStatus, lifetimeMs = 60 * 60 * 1000 }) {
  if (!parseVersion(target)) throw Error('progress_target_invalid');
  const capability = randomBytes(24).toString('hex');
  let host, closed = false;
  const server = createServer(async (request, response) => {
    const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
      'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'" };
    const send = (code, type, body) => { if (!response.destroyed) { response.writeHead(code, { ...headers, 'content-type': type }); response.end(body); } };
    const prefix = `/${capability}/`;
    // 当前工作台转入独立回环端口，浏览器会标为cross-site；仅放行持有随机地址的顶层导航。
    // 状态接口、脚本、样式及iframe仍要求同源，页面本身不含安装/写入能力。
    const navigation = request.url === prefix && request.headers['sec-fetch-mode'] === 'navigate' && request.headers['sec-fetch-dest'] === 'document' &&
      (!request.headers.origin || isWorkbenchOrigin(request.headers.origin));
    if (request.method !== 'GET' || request.headers.host !== host || request.headers.origin && request.headers.origin !== `http://${host}` && !navigation ||
        request.headers['sec-fetch-site'] === 'cross-site' && !navigation) return send(403, 'text/plain', 'Forbidden');
    if (request.url === prefix) return send(200, 'text/html; charset=utf-8', 更新进度页面);
    if (request.url === prefix + 'style.css') return send(200, 'text/css; charset=utf-8', 更新进度样式);
    if (request.url === prefix + 'app.js') return send(200, 'text/javascript; charset=utf-8', 更新进度脚本);
    if (request.url === prefix + 'status') {
      try { return send(200, 'application/json', JSON.stringify(await readStatus())); }
      catch { return send(200, 'application/json', JSON.stringify({ target, state: 'unavailable', reason: null, origin: null })); }
    }
    send(404, 'text/plain', 'Not found');
  });
  server.requestTimeout = 10000; server.headersTimeout = 10000; server.maxConnections = 16;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  host = `127.0.0.1:${server.address().port}`;
  const close = () => { if (!closed) { closed = true; clearTimeout(timer); server.close(); server.closeAllConnections(); } };
  const timer = setTimeout(close, lifetimeMs); timer.unref();
  return { target, url: `http://${host}/${capability}/`, close, get closed() { return closed; } };
}

// 每个管理器最多一个观察服务，不写磁盘，重复点击复用同一地址。
export function createWebProgressObserver(readStatus, serve = serveWebUpdateProgress) {
  let current = null, pending = null;
  return {
    async open(target) {
      if (pending) { await pending; return this.open(target); }
      if (current?.target === target && !current.closed) return { url: current.url };
      current?.close();
      pending = serve({ target, readStatus: () => readStatus(target) });
      try { current = await pending; return { url: current.url }; }
      finally { pending = null; }
    },
    async close() { if (pending) await pending.catch(() => {}); current?.close(); current = null; },
  };
}
