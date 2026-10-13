import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, stat, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createServer, request } from 'node:http';
import { createHash } from 'node:crypto';
import { createLocalhostMigration } from '../src/server/localhost-migration.mjs';
import { localBrowserOrigin } from '../src/server/local-browser-origin.mjs';
import { ActivityGate } from '../src/server/activity-gate.mjs';

test('browser aliases require exact matching host and Origin, never cross-Origin trust', () => {
  const configured = 'http://127.0.0.1:8888';
  for (const host of ['127.0.0.1:8888', 'localhost:8888']) {
    assert.equal(localBrowserOrigin({ headers: { host, origin: 'http://' + host } }, configured), 'http://' + host);
    assert.equal(localBrowserOrigin({ headers: { host, origin: host.startsWith('localhost') ? configured : 'http://localhost:8888' } }, configured), null);
  }
  for (const host of ['localhost.evil:8888', 'localhost:8889', '192.168.1.2:8888'])
    assert.equal(localBrowserOrigin({ headers: { host, origin: 'http://' + host } }, configured), null);
});

test('real migration HTTP saves a private exact backup before verifying and rejects replay/cross-Origin requests', async t => {
  const root = await mkdtemp(join(tmpdir(), 'guan-localhost-test-')); t.after(() => rm(root, { recursive: true, force: true }));
  let handle;
  const server = createServer((req, res) => handle(req, res)); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); return new Promise(r => server.close(r)); });
  const port = server.address().port, source = `http://127.0.0.1:${port}`, target = `http://localhost:${port}`, prefix = '/local-app/localhost-migration';
  handle = createLocalhostMigration({ port, backupRoot: root, gate: new ActivityGate() });
  const send = (path, body, origin = target, host = `localhost:${port}`) => new Promise((resolve, reject) => {
    const req = request(source + path, { method: 'POST', headers: { host, origin, 'content-type': 'application/json' } }, res => {
      const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks)) }));
    }); req.on('error', reject); req.end(JSON.stringify(body));
  });
  assert.equal((await send(prefix + '/session', {}, source)).status, 409);
  const { body: { nonce } } = await send(prefix + '/session', {});
  assert.match(nonce, /^[a-f0-9-]{36}$/);
  const sourcePage = await fetch(source + prefix + '/source?nonce=' + nonce);
  const sourceHtml = await sourcePage.text();
  assert.match(sourceHtml, /parent===window&&opener/);
  assert.match(sourceHtml, /opener.postMessage/);
  assert.match(sourcePage.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  const oldDir = join(root, 'localhost-00000000-0000-4000-8000-000000000001'); await mkdir(oldDir);
  const oldBytes = JSON.stringify({localStorage:{},databases:[]});
  await writeFile(join(oldDir,'browser-127.json'),oldBytes);
  await writeFile(join(oldDir,'MIGRATION.json'),JSON.stringify({source,target,phase:'browser-verified',sha256:createHash('sha256').update(oldBytes).digest('hex')}));
  const targetSnapshot = {app:'guan-ai-workbench',kind:'full-browser-backup',format:1,origin:target,localStorage:{'guan-localhost-copy-v1':'verified','guan-workbench-theme':'light'},databases:[],sessionStorage:{}};
  const targetSaved = await send(prefix+'/target-backup?nonce='+nonce,targetSnapshot);
  assert.equal(targetSaved.status,200); assert.equal(targetSaved.body.recoverEmptyAliasCopy,true);
  assert.equal((await send(prefix+'/target-backup?nonce='+nonce,targetSnapshot)).status,409);
  const backupPath = prefix + '/backup?nonce=' + nonce, verifiedPath = prefix + '/verified?nonce=' + nonce;
  assert.equal((await send(verifiedPath, { sha256: 'bad', verified: true })).status, 409);
  const snapshot = { app: 'guan-ai-workbench', kind: 'full-browser-backup', format: 1, origin: source,
    databases: [], localStorage: { canvas: 'private-fixture' }, sessionStorage: {} };
  assert.equal((await send(backupPath, snapshot, source)).status, 409);
  const saved = await send(backupPath, snapshot); assert.equal(saved.status, 200);
  const files = await readdir(root); assert.equal(files.length, 2);
  const directory = 'localhost-' + nonce;
  const file = join(root, directory, 'browser-127.json'), bytes = await readFile(file);
  assert.equal(bytes.toString(), JSON.stringify(snapshot)); assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), saved.body.sha256);
  assert.equal((await send(backupPath, snapshot)).status, 409);
  assert.equal((await send(verifiedPath, { sha256: 'bad', verified: true })).status, 409);
  assert.equal((await send(verifiedPath, { sha256: saved.body.sha256, verified: true })).status, 200);
  assert.equal((await send(verifiedPath, { sha256: saved.body.sha256, verified: true })).status, 409);
  const receipt = JSON.parse(await readFile(join(root, directory, 'MIGRATION.json')));
  assert.equal(receipt.phase, 'browser-verified'); assert.equal(receipt.exportMode,'top-level');
});
