import { randomBytes } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { isWorkbenchOrigin } from '../本机服务/工作台端口.mjs';

const protocol = 'guan-web-update-ready.v1';
const prefix = '/__guan-local/update-ready/';
const validPath = path => typeof path === 'string' && /^\/__guan-local\/update-ready\/[a-f0-9]{48}$/.test(path);

// 随服务启动生成，只读且不签发页面票据，不参与授权页面/任务计数。
export function createUpdateReadinessProbe(readStatus) {
  const path = prefix + randomBytes(24).toString('hex');
  return Object.freeze({
    path,
    async handle(request, response, origin) {
      if (!request.url?.startsWith(prefix)) return false;
      const allowed = request.url === path && request.method === 'GET' &&
        request.headers.host === new URL(origin).host && !request.headers.origin &&
        (!request.headers['sec-fetch-site'] || request.headers['sec-fetch-site'] === 'none');
      if (!allowed) {
        response.writeHead(403); response.end(); request.resume(); return true;
      }
      try {
        const status = await readStatus();
        response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        response.end(JSON.stringify({ protocol, ready: status.ready === true, version: status.version,
          managerVersion: status.managerVersion, workspaceId: status.workspaceId, origin }));
      } catch {
        response.writeHead(503, { 'cache-control': 'no-store' }); response.end();
      }
      return true;
    },
  });
}

export function readUpdateReadinessProbe(origin, path, { timeout = 2000 } = {}) {
  if (!isWorkbenchOrigin(origin) || !validPath(path)) return Promise.resolve(null);
  const url = new URL(origin);
  // 固定回环地址与Host，不走代理、DNS、重定向或页面授权入口。
  return new Promise(resolve => {
    let finished = false;
    const finish = value => { if (!finished) { finished = true; clearTimeout(timer); resolve(value); } };
    const request = httpRequest({ hostname: '127.0.0.1', port: url.port, path,
      method: 'GET', headers: { host: url.host }, agent: false }, response => {
      let size = 0;
      const chunks = [];
      response.on('data', chunk => {
        size += chunk.length;
        if (size > 4096) { request.destroy(); finish(null); } else chunks.push(chunk);
      });
      response.on('end', () => {
        try {
          const value = JSON.parse(Buffer.concat(chunks));
          finish(response.statusCode === 200 && value.protocol === protocol && value.origin === origin ? value : null);
        } catch { finish(null); }
      });
      response.on('error', () => finish(null));
      response.on('aborted', () => finish(null));
    });
    const timer = setTimeout(() => { request.destroy(); finish(null); }, timeout);
    request.on('error', () => finish(null));
    request.end();
  });
}
