import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { request } from 'node:http';
import { once } from 'node:events';
import path from 'node:path';
import { createUpdateOriginBrowserBridge } from '../src/server/update-origin-browser-bridge.mjs';
import { stableServiceOrigin } from '../src/server/update-service-origin.mjs';
import { writePrivateFile } from '../src/server/runtime-paths.mjs';
import { planPort3000Merge } from '../src/shared/data-contract/port3000-merge.mjs';

const extensionId = 'a'.repeat(32), browserSession = '11111111-1111-4111-a111-111111111111';
async function setup(t, sourceOrigin = 'http://localhost:8888') {
  const root = await mkdtemp(path.join(tmpdir(), 'guan-online-bridge-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bridge = createUpdateOriginBrowserBridge({ backupRoot: path.join(root, 'backups'), extensionId, browserSession, sourceOrigin,
    contractRoot: new URL('../src/shared/data-contract/', import.meta.url) });
  for (const server of bridge.servers) { server.listen(0, '127.0.0.1'); await once(server, 'listening'); }
  t.after(() => bridge.close());
  const send = (side, host, url, body, origin = 'http://' + host) => new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: bridge.servers[side].address().port, path: url,
      method: body === undefined ? 'GET' : 'POST', headers: { host, origin, 'content-type': 'application/json' } }, res => {
      const chunks = []; res.on('data', x => chunks.push(x)); res.on('end', () => resolve({ status: res.statusCode,
        headers: res.headers, body: Buffer.concat(chunks).toString() }));
    }); req.on('error', reject); req.end(body === undefined ? undefined : JSON.stringify(body));
  });
  const info = JSON.parse((await send(0, new URL(sourceOrigin).host, '/local-app/online-migration/session', undefined,
    'chrome-extension://' + extensionId)).body);
  return { root, bridge, send, info, sourceOrigin, sourceHost: new URL(sourceOrigin).host, prefix: new URL(info.controlUrl).pathname };
}
const snapshot = origin => ({ app: 'guan-ai-workbench', kind: 'full-browser-backup', format: 1, origin,
  localStorage: {}, sessionStorage: {}, databases: [] });

for (const sourceOrigin of ['http://localhost:8888', 'http://127.0.0.1:8888'])
  test('top-level copy independently verifies both snapshots, preserves unrelated settings and supplies durable native origin: ' + sourceOrigin, async t => {
    const { root, bridge, send, prefix, sourceHost } = await setup(t, sourceOrigin);
    const controlOrigin = 'chrome-extension://' + extensionId;
    assert.equal((await send(0, sourceHost, prefix + '/claim', { session: '22222222-2222-4222-a222-222222222222' }, controlOrigin)).status, 409);
    assert.equal((await send(0, sourceHost, prefix + '/claim', { session: browserSession }, controlOrigin)).status, 200);
    assert.match((await send(0, sourceHost, prefix + '/source')).body, /exportBrowserStorage/);
    const source = snapshot(sourceOrigin); source.localStorage['infinite-canvas:theme_store'] = 'dark';
    assert.equal((await send(0, sourceHost, prefix + '/source-backup', source)).status, 200);
    assert.match((await send(1, 'localhost:3000', prefix)).body, /restoreBrowserStorage/);
    const target = snapshot('http://localhost:3000'); target.localStorage['other-project:setting'] = 'retained';
    assert.equal((await send(1, 'localhost:3000', prefix + '/target-backup', target)).status, 200);
    const merged = (await planPort3000Merge(source, target)).snapshot;
    const result = await send(1, 'localhost:3000', prefix + '/verified', merged);
    assert.equal(result.status, 200); assert.match(result.headers['set-cookie'][0], /HttpOnly/);
    assert.equal((await bridge.verify()).verified, true);
    assert.equal(await stableServiceOrigin(root), 'http://127.0.0.1:8888');
    await writePrivateFile(path.join(root, 'installation/service-origin.json'), JSON.stringify({ format: 1,
      origin: 'http://127.0.0.1:3000', migration: path.basename(bridge.directory) }));
    assert.equal(await stableServiceOrigin(root), 'http://127.0.0.1:3000');
    await appendFile(path.join(bridge.directory, 'browser-localhost-merged.json'), ' ');
    await assert.rejects(bridge.verify(), /backup_unverified/);
    await assert.rejects(stableServiceOrigin(root), /record_invalid/);
  });

test('wrong host/extension, replay, fake verification and existing business conflicts cannot authorize installation', async t => {
  const { bridge, send, prefix, sourceHost } = await setup(t);
  assert.equal((await send(0, 'localhost.evil:8888', prefix + '/source')).status, 403);
  assert.equal((await send(0, sourceHost, '/local-app/online-migration/session', undefined, 'chrome-extension://' + 'b'.repeat(32))).status, 409);
  assert.equal((await send(1, 'localhost:3000', prefix + '/verified', { verified: true })).status, 409);
  assert.equal((await send(0, sourceHost, prefix + '/claim', { session: browserSession }, 'chrome-extension://' + extensionId)).status, 200);
  const source = snapshot('http://localhost:8888'); source.localStorage['unrelated:key'] = 'source';
  assert.equal((await send(0, sourceHost, prefix + '/source-backup', source)).status, 200);
  const target = snapshot('http://localhost:3000'); target.localStorage['unrelated:key'] = 'existing';
  assert.equal((await send(1, 'localhost:3000', prefix + '/target-backup', target)).status, 409);
  assert.equal(bridge.status().failed, true);
  await assert.rejects(bridge.verify(), /backup_unverified/);
  const failed = await send(0, sourceHost, '/local-app/online-migration/session', undefined, 'chrome-extension://' + extensionId);
  assert.equal(JSON.parse(failed.body).phase, 'failed'); // Extension can safely close only its own temporary tabs.
});
