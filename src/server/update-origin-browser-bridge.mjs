import { createServer } from 'node:http';
import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { privateDirectory, writePrivateFile, readPrivateFile } from './runtime-paths.mjs';
import { planPort3000Merge, comparableSnapshot } from '../shared/data-contract/port3000-merge.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const target = 'http://localhost:3000';
const sources = ['http://localhost:8888', 'http://127.0.0.1:8888'];
const uuid = value => /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value || '');
const own = (value, fields) => value && Object.keys(value).sort().join(',') === fields.slice().sort().join(',');

// Migration-only listeners. The installer must own and stop the old app first.
// Neither listener exposes generation, configuration, credentials or install.
// The one authorized Chrome extension opens top-level documents in its existing
// profile; cross-origin iframe storage is deliberately never used.
export function createUpdateOriginBrowserBridge({ backupRoot, extensionId, sourceOrigin, contractRoot,
  browserSession, maxBytes = 1024 ** 3, timeoutMs = 10 * 60 * 1000 }) {
  if (!sources.includes(sourceOrigin) || !path.isAbsolute(backupRoot || '') || !/^[a-p]{32}$/.test(extensionId || '')
    || !(contractRoot instanceof URL) || contractRoot.protocol !== 'file:' || !Number.isSafeInteger(maxBytes) || maxBytes < 1024
    || !uuid(browserSession) || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1000) throw Error('update_migration_bridge_invalid');
  const nonce = randomUUID(), prefix = '/online-migration-' + nonce;
  const directory = path.join(backupRoot, 'localhost-' + nonce);
  const extension = 'chrome-extension://' + extensionId;
  const modules = new Map(['port-migration.mjs', 'browser-backup-codec.mjs', 'port3000-merge.mjs']
    .map(name => ['/data-contract/' + name, new URL(name, contractRoot)]));
  let phase = 'waiting-source', claimant = null, writing = false, failure = false, closed = false;
  let sourceSha256, targetSha256, mergedSha256;
  const expires = Date.now() + timeoutMs;
  const reply = (res, status, value, type = 'application/json') => {
    const cors = res._onlineOrigin === extension ? { 'access-control-allow-origin': extension, 'access-control-allow-methods': 'GET,POST', 'access-control-allow-headers': 'content-type' } : {};
    res.writeHead(status, { 'content-type': type + '; charset=utf-8', 'cache-control': 'no-store', ...cors,
      'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; script-src 'self' 'unsafe-inline'; connect-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'" });
    res.end(typeof value === 'string' ? value : JSON.stringify(value));
  };
  const body = async req => {
    if (req.headers['content-type'] !== 'application/json') throw Error();
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > maxBytes) throw Error(); chunks.push(chunk); }
    return Buffer.concat(chunks);
  };
  const snapshot = (bytes, origin) => {
    const value = JSON.parse(bytes);
    if (value.app !== 'guan-ai-workbench' || value.kind !== 'full-browser-backup' || value.format !== 1
      || value.origin !== origin || !Array.isArray(value.databases) || !value.localStorage || !value.sessionStorage) throw Error();
    return value;
  };
  const save = async (name, bytes) => {
    await privateDirectory(directory); await writePrivateFile(path.join(directory, name), bytes, { exclusive: true });
    if (!bytes.equals(await readFile(path.join(directory, name)))) throw Error();
    return hash(bytes);
  };
  const persist = () => writePrivateFile(path.join(directory, 'MIGRATION.json'), JSON.stringify({ format: 1,
    source: sourceOrigin, target, phase, exportMode: 'top-level', sourceSha256, targetSha256, mergedSha256,
    // Retain the existing verified-landing contract after the real service starts.
    sha256: sourceSha256, mergePolicy: 'retain-target-projects-source-preferences' }));
  const page = script => `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>工作台自动迁移</title><body><p role="status">正在备份和迁移工作台数据，请勿关闭此临时页面。旧地址数据不会删除。</p><script type="module">${script}</script></body></html>`;
  const handler = async (req, res) => {
    try {
      if (closed) throw Error();
      const host = req.headers.host, requestOrigin = req.headers.origin;
      res._onlineOrigin = requestOrigin;
      if (![new URL(sourceOrigin).host, new URL(target).host].includes(host)) { reply(res, 403, { error: 'local_origin_required' }); return; }
      const url = new URL(req.url, 'http://' + host), side = host === new URL(target).host ? 'target' : 'source';
      if (url.pathname === '/local-app/online-migration/session' && req.method === 'GET' && side === 'source' && requestOrigin === extension) {
        reply(res, 200, { protocol: 2, phase: failure || Date.now() > expires ? 'failed' : phase, sourceUrl: sourceOrigin + prefix + '/source', targetUrl: target + prefix,
          controlUrl: sourceOrigin + prefix, sourceOrigin, targetOrigin: target }); return;
      }
      if (failure || Date.now() > expires) throw Error();
      if (url.pathname === prefix + '/claim' && req.method === 'POST' && side === 'source' && requestOrigin === extension) {
        const value = JSON.parse(await body(req));
        if (!own(value, ['session']) || value.session !== browserSession || claimant && claimant !== value.session) throw Error();
        claimant = value.session; reply(res, 200, { claimed: true }); return;
      }
      if (!claimant) throw Error();
      if (req.method === 'GET' && modules.has(url.pathname) && (!requestOrigin || requestOrigin === url.origin)) {
        reply(res, 200, await readFile(modules.get(url.pathname), 'utf8'), 'text/javascript'); return;
      }
      if (req.method === 'GET' && url.pathname === prefix + '/source' && side === 'source') {
        reply(res, 200, page(`import {exportBrowserStorage} from '/data-contract/port-migration.mjs';
try{const r=await fetch('${prefix}/source-backup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(await exportBrowserStorage())});if(!r.ok)throw Error();document.querySelector('p').textContent='旧地址完整备份已验证，正在复制数据…';}catch{document.querySelector('p').textContent='备份失败，原数据保留，更新已停止。';}`), 'text/html'); return;
      }
      if (req.method === 'GET' && url.pathname === prefix && side === 'target' && phase === 'source-backed-up') {
        reply(res, 200, page(`import {exportBrowserStorage,restoreBrowserStorage} from '/data-contract/port-migration.mjs';
try{const before=await exportBrowserStorage();let r=await fetch('${prefix}/target-backup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(before)});if(!r.ok)throw Error();r=await fetch('${prefix}/snapshot');if(!r.ok)throw Error();await restoreBrowserStorage(await r.json(),{mergeTargetBackup:before});r=await fetch('${prefix}/verified',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(await exportBrowserStorage())});if(!r.ok)throw Error();localStorage.setItem('guan-port3000-copy-v1','top-level-verified');document.querySelector('p').textContent='完整复制及逐项校验通过，正在切换服务…';}catch{document.querySelector('p').textContent='迁移停止，旧数据与备份保留，请勿反复覆盖。';}`), 'text/html'); return;
      }
      if (req.method === 'GET' && url.pathname === prefix + '/snapshot' && side === 'target' && phase === 'target-backed-up') {
        reply(res, 200, await readFile(path.join(directory, 'browser-127.json'), 'utf8')); return;
      }
      if (req.method !== 'POST' || requestOrigin !== url.origin || writing) throw Error();
      const allowed = side === 'source' && url.pathname === prefix + '/source-backup' && phase === 'waiting-source'
        || side === 'target' && url.pathname === prefix + '/target-backup' && phase === 'source-backed-up'
        || side === 'target' && url.pathname === prefix + '/verified' && phase === 'target-backed-up';
      if (!allowed) throw Error();
      writing = true;
      try {
        const bytes = await body(req), value = snapshot(bytes, url.origin);
        if (side === 'source') {
          // An empty wrong profile must never become a successful migration.
          if (!value.databases.length && !Object.keys(value.localStorage).length) throw Error();
          sourceSha256 = await save('browser-127.json', bytes); phase = 'source-backed-up';
        } else if (phase === 'source-backed-up') {
          targetSha256 = await save('browser-localhost-before.json', bytes);
          await planPort3000Merge(snapshot(await readFile(path.join(directory, 'browser-127.json')), sourceOrigin), value);
          phase = 'target-backed-up';
        } else {
          const expected = await planPort3000Merge(snapshot(await readFile(path.join(directory, 'browser-127.json')), sourceOrigin),
            snapshot(await readFile(path.join(directory, 'browser-localhost-before.json')), target));
          if (comparableSnapshot(value) !== comparableSnapshot(expected.snapshot)) throw Error();
          mergedSha256 = await save('browser-localhost-merged.json', bytes); phase = 'browser-verified';
          res.setHeader('set-cookie', `guan_port3000_verified=${nonce}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000`);
        }
        await persist(); reply(res, 200, { phase });
      } catch { failure = true; throw Error(); } finally { writing = false; }
    } catch { reply(res, 409, { error: 'update_migration_safely_stopped' }); }
  };
  const servers = [createServer(handler), createServer(handler)];
  return {
    servers, directory, sourceOrigin,
    abort() { failure = true; },
    status: () => ({ phase, failed: failure, expired: Date.now() > expires, claimed: Boolean(claimant) }),
    async verify() {
      if (phase !== 'browser-verified' || failure) throw Error('update_migration_backup_unverified');
      for (const [file, expected] of [['browser-127.json', sourceSha256], ['browser-localhost-before.json', targetSha256], ['browser-localhost-merged.json', mergedSha256]])
        if (hash(await readFile(path.join(directory, file))) !== expected) throw Error('update_migration_backup_unverified');
      const receipt = JSON.parse(await readPrivateFile(path.join(directory, 'MIGRATION.json'), { maxBytes: 4096 }));
      if (receipt.phase !== phase || receipt.source !== sourceOrigin || receipt.target !== target || receipt.mergedSha256 !== mergedSha256)
        throw Error('update_migration_backup_unverified');
      return { directory, nonce, sourceSha256, targetSha256, mergedSha256, verified: true };
    },
    async listen() {
      try {
        for (const [server, port] of [[servers[0], 8888], [servers[1], 3000]])
          await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
      } catch { await this.close(); throw Error('update_migration_port_occupied'); }
    },
    async close() {
      closed = true;
      await Promise.all(servers.map(server => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); })));
    },
  };
}
