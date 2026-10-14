import test from 'node:test';
import assert from 'node:assert/strict';
import { request, createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPort3000ReadonlyBridge } from '../src/server/port3000-readonly-bridge.mjs';
import { createLocalhostMigration } from '../src/server/localhost-migration.mjs';
import { ActivityGate } from '../src/server/activity-gate.mjs';

test('old-origin bridge exposes only a nonce-bound exporter and codecs; verified landing survives a handler restart', async t => {
  const root = await mkdtemp(join(tmpdir(), 'guan-port3000-')); t.after(() => rm(root, { recursive: true, force: true }));
  const options = { port: 3000, sourceOrigin: 'http://localhost:8888', backupRoot: root, gate: new ActivityGate() };
  const migration = createLocalhostMigration(options);
  const bridge = createPort3000ReadonlyBridge({ migration, contractRoot: new URL('../src/shared/data-contract/', import.meta.url) });
  const target = createServer((req, res) => migration(req, res));
  for (const server of [bridge, target]) {
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  }
  const send = (server, host, path, body) => new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: server.address().port, path, method: body === undefined ? 'GET' : 'POST',
      headers: { host, origin: 'http://' + host, 'content-type': 'application/json' } }, res => {
      const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    }); req.on('error', reject); req.end(body === undefined ? undefined : JSON.stringify(body));
  });
  for (const path of ['/', '/canvas/product', '/local-app/health', '/local-app/credentials', '/data-contract/index.js'])
    assert.equal((await send(bridge, 'localhost:8888', path)).status, 404);
  assert.equal((await send(bridge, 'localhost.evil:8888', '/data-contract/port-migration.mjs')).status, 403);
  assert.equal((await send(bridge, 'localhost:8888', '/data-contract/port-migration.mjs')).status, 200);
  const prefix = '/local-app/localhost-migration';
  const session = JSON.parse((await send(target, 'localhost:3000', prefix + '/session', {})).body);
  assert.equal((await send(bridge, 'localhost:8888', prefix + '/source?nonce=bad')).status, 409);
  assert.match((await send(bridge, 'localhost:8888', prefix + '/source?nonce=' + session.nonce)).body, /http:\/\/localhost:3000/);
  const snapshot = { app: 'guan-ai-workbench', kind: 'full-browser-backup', format: 1,
    origin: 'http://localhost:8888', localStorage: { canvas: 'saved' }, sessionStorage: {}, databases: [] };
  assert.equal((await send(target, 'localhost:3000', prefix + '/target-backup?nonce=' + session.nonce,
    { ...snapshot, origin: 'http://localhost:3000', localStorage: {} })).status, 200);
  const saved = JSON.parse((await send(target, 'localhost:3000', prefix + '/backup?nonce=' + session.nonce, snapshot)).body);
  assert.equal((await send(target, 'localhost:3000', prefix + '/verified?nonce=' + session.nonce, { verified: true, sha256: saved.sha256 })).status, 409);
  assert.equal((await send(target, 'localhost:3000', prefix + '/merged-backup?nonce=' + session.nonce,
    { ...snapshot, origin: 'http://localhost:3000', localStorage: { canvas: 'tampered' } })).status, 409);
  const merged = JSON.parse((await send(target, 'localhost:3000', prefix + '/merged-backup?nonce=' + session.nonce,
    { ...snapshot, origin: 'http://localhost:3000' })).body);
  const headers = { host: 'localhost:3000', cookie: 'guan_port3000_verified=' + session.nonce };
  assert.equal(await migration.hasVerifiedLanding({ headers }), false);
  const verified = await send(target, 'localhost:3000', prefix + '/verified?nonce=' + session.nonce, { verified: true, sha256: saved.sha256, mergedSha256: merged.sha256 });
  assert.equal(verified.status, 200); assert.match(verified.headers['set-cookie'][0], /HttpOnly; SameSite=Strict/);
  assert.equal(await createLocalhostMigration(options).hasVerifiedLanding({ headers }), true);
  assert.equal(await migration.hasVerifiedLanding({ headers: { ...headers, host: 'localhost:8888' } }), false);
  assert.equal(await migration.hasVerifiedLanding({ headers: { host: 'localhost:3000', cookie: 'guan_port3000_verified=../../secret' } }), false);
});
