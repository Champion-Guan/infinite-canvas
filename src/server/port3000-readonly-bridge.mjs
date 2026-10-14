import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

// Only the migration exporter and its two codecs are available at the old
// Origin. No canvas, credential, generation, proxy or updater API is exposed.
export function createPort3000ReadonlyBridge({ migration, contractRoot }) {
  const files = new Map(['port-migration.mjs', 'browser-backup-codec.mjs'].map(name => ['/data-contract/' + name, new URL(name, contractRoot)]));
  return createServer(async (req, res) => {
    try {
      if (req.headers.host !== 'localhost:8888') { res.writeHead(403); res.end(); return; }
      const url = new URL(req.url, 'http://localhost:8888');
      if (req.method === 'GET' && url.pathname === '/local-app/localhost-migration/source') {
        if (await migration(req, res)) return;
      }
      if (req.method === 'GET' && files.has(url.pathname)) {
        res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
        res.end(await readFile(files.get(url.pathname))); return;
      }
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('旧数据保留。请打开 http://localhost:3000 完成备份校验迁移。');
    } catch { if (!res.headersSent) res.writeHead(409); res.end(); }
  });
}
