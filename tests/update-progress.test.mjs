import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request } from 'node:http';
import vm from 'node:vm';
import { serveUpdateProgress, progressSnapshot, UpdateProgressLauncher } from '../src/server/update-progress.mjs';
import { SoftwareUpdates } from '../src/server/software-updates.mjs';

test('success and rollback require actual owned healthy service; unrelated old journal cannot succeed', () => {
  const s = { state: 'committed', targetVersion: '1.1.0', currentVersion: '1.1.0', reason: null };
  assert.equal(progressSnapshot('1.1.0', s, null).state, 'starting');
  assert.equal(progressSnapshot('1.1.0', s, { owned: true, currentVersion: '1.0.9' }).state, 'starting');
  assert.equal(progressSnapshot('1.1.0', s, { owned: true, currentVersion: '1.1.0' }).state, 'success');
  assert.equal(progressSnapshot('1.2.0', s, { owned: true, currentVersion: '1.1.0' }).state, 'preparing');
  s.state = 'rolled-back'; s.currentVersion = '1.0.9';
  assert.equal(progressSnapshot('1.1.0', s, null).state, 'recovery-required');
  assert.equal(progressSnapshot('1.1.0', s, { owned: true, currentVersion: '1.0.9' }).state, 'rolled-back');
  assert.equal(progressSnapshot('1.1.0', { state: 'blocked', targetVersion: null, reason: 'update_state_invalid' }, null).state, 'blocked');
  assert.equal(progressSnapshot('1.1.0', { state: 'awaiting-browser-exit', targetVersion: null, reason: null }, null).state, 'awaiting-browser-exit');
});
test('independent monitor is read-only, capability scoped and does not occupy workbench port', async t => {
  let reads = 0;
  const monitor = await serveUpdateProgress({ target: '1.1.0', readStatus: async () => { reads++; return { target: '1.1.0', state: 'awaiting-browser-exit', reason: null }; } });
  t.after(() => monitor.close());
  assert.notEqual(new URL(monitor.url).port, '8888');
  const page = await fetch(monitor.url); assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.match(await page.text(), /此窗口可保持打开/);
  const script = await (await fetch(monitor.url + 'app.js')).text();
  assert.doesNotThrow(() => new vm.Script(script));
  assert.match(script, /当前步骤/);
  assert.equal((await fetch(monitor.url + 'status', { method: 'POST' })).status, 403);
  assert.equal((await fetch(monitor.url + 'status', { headers: { origin: 'https://evil.example' } })).status, 403);
  const hostileHost = await new Promise((resolve, reject) => {
    const req = request(monitor.url + 'status', { headers: { host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject); req.end();
  });
  assert.equal(hostileHost, 403);
  assert.equal((await fetch(new URL('/status', monitor.url))).status, 404);
  assert.equal((await fetch(monitor.url + 'install')).status, 404);
  assert.equal(reads, 0);
  assert.equal((await (await fetch(monitor.url + 'status')).json()).state, 'awaiting-browser-exit');
  assert.equal(reads, 1);
});
test('backend progress endpoint chooses verified identity, never caller target or private data', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'progress-test-')); await chmod(directory, 0o700);
  try {
    const targets = [];
    const updates = new SoftwareUpdates({ directory, currentVersion: '1.0.0', manager: {},
      downloader: { stageIdentity: () => ({ version: '1.1.0' }) }, progress: { open: async v => { targets.push(v); return { url: 'fixture' }; } } });
    assert.deepEqual(await updates.progressWindow(), { url: 'fixture' });
    assert.deepEqual(targets, ['1.1.0']);
    updates.currentVersion = '1.2.0'; await assert.rejects(updates.progressWindow(), /version_not_newer/);
    updates.manager = null; await assert.rejects(updates.progressWindow(), /update_progress_unavailable/);
  } finally { await rm(directory, { recursive: true }); }
});
test('detached progress child survives parent IPC disconnection and concurrent opens coalesce', async () => {
  const root = await mkdtemp(join(tmpdir(), 'progress-child-')); await chmod(root, 0o700);
  const launcher = new UpdateProgressLauncher({ projectRoot: fileURLToPath(new URL('../', import.meta.url)), privateRoot: root });
  try {
    const [one, two] = await Promise.all([launcher.open('1.1.0'), launcher.open('1.1.0')]);
    assert.equal(one.url, two.url);
    launcher.current.child.disconnect();
    assert.equal((await fetch(one.url)).status, 200);
    assert.equal((await (await fetch(one.url + 'status')).json()).state, 'unavailable');
  } finally { launcher.current?.child.kill(); await rm(root, { recursive: true }); }
});
