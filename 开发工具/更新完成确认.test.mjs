import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { spawn } from 'node:child_process';
import { createUpdateReadinessProbe, readUpdateReadinessProbe } from '../扩展功能/客户安装/更新就绪探针.mjs';
import { readDetachedProgress, createDetachedProgressObserver } from '../扩展功能/客户安装/独立更新观察.mjs';
import { processIdentity } from '../扩展功能/客户安装/管理进程身份.mjs';
import { writeState, versionPath } from '../扩展功能/客户安装/Web安装目录.mjs';
import { WEB_ORIGIN } from '../扩展功能/客户安装/Web发布协议.mjs';
import { 更新进度脚本 } from '../扩展功能/软件更新/更新进度页面.mjs';
import { assembleSoftwareUpdates } from '../扩展功能/软件更新/更新服务装配.mjs';

const current = { version: '2.0.0-beta.21', commit: 'b'.repeat(40),
  name: '2.0.0-beta.21-' + 'b'.repeat(40), origin: WEB_ORIGIN, dataSchema: 1 };
const previous = { ...current, version: '2.0.0-beta.19',
  name: '2.0.0-beta.19-' + 'a'.repeat(40), commit: 'a'.repeat(40) };
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), '更新完成确认-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const paths = { root, versions: join(root, '版本'), state: join(root, '当前版本.json'),
    lock: join(root, '运行锁.json'), address: join(root, '运行地址.json') };
  await mkdir(paths.versions, { mode: 0o700 });
  const owner = processIdentity(process.pid);
  let ready = { ready: true, version: current.version, managerVersion: current.version, workspaceId: 'workspace' };
  let fail = false, reads = 0, beforeRead;
  const probe = createUpdateReadinessProbe(async () => {
    reads++; await beforeRead?.();
    if (fail) throw Error('offline');
    return ready;
  });
  let origin;
  const server = createServer(async (req, res) => {
    if (!await probe.handle(req, res, origin)) { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = 'http://localhost:' + server.address().port;
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const state = { phase: 'committed', current, previous, workspaceId: 'workspace' };
  const address = { owner, ready: true, origin, version: current.version,
    workspaceId: 'workspace', readinessPath: probe.path };
  await writeState(paths.state, state);
  await writeState(paths.lock, owner);
  await writeState(paths.address, address);
  return { paths, owner, state, address, probe, origin, setReady: value => { ready = value; },
    getReady: () => ready, setFail: value => { fail = value; }, reads: () => reads,
    beforeRead: value => { beforeRead = value; } };
}
function raw(origin, path, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = request(origin + path, { method, headers }, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ code: res.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    req.once('error', reject); req.end();
  });
}

test('重现安装已提交、进程命令文本不匹配时永久交接；实时核对通过后确认成功', async t => {
  const f = await fixture(t);
  assert.equal(f.owner.command.endsWith('/扩展功能/客户安装/Web客户命令.mjs supervisor'), false);
  // 旧版只依赖命令文本，已健康的新服务仍被显示为交接中。
  await writeState(f.paths.address, { ...f.address, readinessPath: undefined });
  assert.equal((await readDetachedProgress(f.paths, current.version)).state, 'restarting-manager');
  await writeState(f.paths.address, f.address);
  const result = await readDetachedProgress(f.paths, current.version);
  assert.equal(result.state, 'success'); assert.equal(result.origin, f.origin);
  assert.equal(f.reads(), 1);
});

test('旧版无探针仍兼容原进程身份校验，进程退出后不复用旧地址', async t => {
  const f = await fixture(t);
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)',
    join(versionPath(f.paths, current), '扩展功能/客户安装/Web客户命令.mjs'), 'supervisor'],
  { stdio: 'ignore' });
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  try {
    const owner = processIdentity(child.pid);
    await writeState(f.paths.lock, owner);
    await writeState(f.paths.address, { ...f.address, owner, readinessPath: undefined });
    assert.equal((await readDetachedProgress(f.paths, current.version)).state, 'success');
    await new Promise(resolve => { child.once('exit', resolve); child.kill('SIGTERM'); });
    assert.notEqual((await readDetachedProgress(f.paths, current.version)).state, 'success');
    assert.equal(f.reads(), 0);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      await new Promise(resolve => { child.once('exit', resolve); child.kill('SIGTERM'); });
    }
  }
});

test('探针失败、版本/管理器/工作区不一致、未激活均不误报成功；恢复后自动成功', async t => {
  const f = await fixture(t), ready = f.getReady();
  for (const change of [{ ready: false }, { version: previous.version },
    { managerVersion: previous.version }, { workspaceId: 'other' }]) {
    f.setReady({ ...ready, ...change });
    const value = await readDetachedProgress(f.paths, current.version);
    assert.equal(value.state, 'restarting-manager'); assert.equal(value.origin, null);
  }
  f.setReady(ready); f.setFail(true);
  assert.equal((await readDetachedProgress(f.paths, current.version)).reason, 'update_progress_probe_unavailable');
  f.setFail(false);
  assert.equal((await readDetachedProgress(f.paths, current.version)).state, 'success');
  await writeState(f.paths.lock, { ...f.owner, started: 'stale-process' });
  const reads = f.reads();
  assert.notEqual((await readDetachedProgress(f.paths, current.version)).state, 'success');
  assert.equal(f.reads(), reads);
});

test('探针请求期间再次换版或管理器锁改变时，丢弃过期成功结果', async t => {
  const f = await fixture(t);
  f.beforeRead(() => writeState(f.paths.lock, { ...f.owner, started: 'next-process' }));
  assert.notEqual((await readDetachedProgress(f.paths, current.version)).state, 'success');
  await writeState(f.paths.lock, f.owner);
  f.beforeRead(() => writeState(f.paths.state, { ...f.state, phase: 'switching' }));
  assert.notEqual((await readDetachedProgress(f.paths, current.version)).state, 'success');
});

test('回退只有实时旧版服务和旧版管理器都就绪才允许返回', async t => {
  const f = await fixture(t);
  await writeState(f.paths.state, { ...f.state, phase: 'rolled-back', current: previous, previous: current });
  await writeState(f.paths.address, { ...f.address, version: previous.version });
  f.setReady({ ...f.getReady(), version: previous.version, managerVersion: previous.version });
  assert.equal((await readDetachedProgress(f.paths, current.version)).state, 'rolled-back');
  f.setFail(true);
  assert.equal((await readDetachedProgress(f.paths, current.version)).state, 'recovery-required');
});

test('真实观察子进程断开旧管理器IPC后，同一进度地址确认新服务并返回实际端口', async t => {
  const f = await fixture(t);
  let spawned;
  f.setReady({ ...f.getReady(), managerVersion: previous.version });
  const observer = createDetachedProgressObserver(target => ({ target, state: 'restarting-manager' }),
    f.paths, { onSpawn: proc => { spawned = proc; } });
  try {
    const { url } = await observer.open(current.version);
    assert.equal((await (await fetch(url + 'status')).json()).state, 'restarting-manager');
    await observer.close({ handoff: true });
    f.setReady({ ...f.getReady(), managerVersion: current.version });
    const value = await (await fetch(url + 'status')).json();
    assert.equal(value.state, 'success'); assert.equal(value.origin, f.origin);
    f.setFail(true);
    assert.notEqual((await (await fetch(url + 'status')).json()).state, 'success');
  } finally {
    await observer.close();
    if (spawned?.exitCode === null) await new Promise(resolve => { spawned.once('exit', resolve); spawned.kill('SIGTERM'); });
  }
});

test('探针只读且有随机地址，拒绝跨站、跨源、错误Host/地址及写操作，不取得页面授权', async t => {
  const f = await fixture(t);
  assert.match(f.probe.path, /^\/__guan-local\/update-ready\/[a-f0-9]{48}$/);
  for (const options of [{ method: 'POST' }, { headers: { host: 'foreign.example' } },
    { headers: { origin: f.origin } }, { headers: { 'sec-fetch-site': 'cross-site' } }]) {
    assert.equal((await raw(f.origin, f.probe.path, options)).code, 403);
  }
  assert.equal((await raw(f.origin, f.probe.path + 'x')).code, 403);
  assert.equal(f.reads(), 0);
  let authorizations = 0;
  const updates = assembleSoftwareUpdates({ dataRoot: f.paths.root, origin: f.origin,
    currentVersion: current.version, readinessProbe: f.probe,
    authorize: () => { authorizations++; }, networkProxy: { getStatus: () => ({ enabled: false }) } });
  t.after(() => updates.close());
  let code, body;
  await updates.handle({ url: f.probe.path, method: 'GET', headers: { host: new URL(f.origin).host } },
    { writeHead(value) { code = value; }, end(value) { body = JSON.parse(value); } });
  assert.equal(code, 200); assert.equal(body.ready, true); assert.equal(authorizations, 0);
  assert.deepEqual(Object.keys(body).sort(), ['managerVersion', 'origin', 'protocol', 'ready', 'version', 'workspaceId']);
  for (const [origin, path] of [['http://foreign.example:3000', f.probe.path],
    [f.origin, '/'], [f.origin, '/__guan-local/update-ready/' + 'a'.repeat(48) + '?x']]) {
    assert.equal(await readUpdateReadinessProbe(origin, path), null);
  }
});

test('读取探针限制总时长、响应大小，拒绝重定向与伪协议', async t => {
  let mode = 'timeout', hits = 0;
  const server = createServer((req, res) => {
    hits++;
    if (mode === 'timeout') return;
    if (mode === 'large') { res.end('a'.repeat(4097)); return; }
    if (mode === 'redirect') { res.writeHead(302, { location: '/unexpected' }); res.end(); return; }
    res.end(JSON.stringify({ protocol: 'other', origin }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const origin = 'http://localhost:' + server.address().port;
  const path = '/__guan-local/update-ready/' + 'a'.repeat(48);
  for (mode of ['timeout', 'large', 'redirect', 'invalid']) {
    assert.equal(await readUpdateReadinessProbe(origin, path, { timeout: 30 }), null);
  }
  assert.equal(hits, 4);
});

function pageFixture() {
  let now = 0, serial = 0;
  const timers = new Map(), navigations = [], listeners = {};
  const elements = Object.fromEntries(['state', 'version', 'detail', 'time', 'return', 'retry'].map(id => [id,
    { dataset: {}, textContent: '', addEventListener() {}, removeAttribute(key) { delete this[key]; } }]));
  const window = { location: { replace: origin => navigations.push(origin) },
    addEventListener(type, handler) { listeners[type] = handler; } };
  const context = {
    document: { querySelector: selector => elements[selector.slice(1)],
      querySelectorAll: () => Array.from({ length: 5 }, () => ({ toggleAttribute() {} })) },
    window, URL, AbortSignal, Date: { now: () => now },
    fetch: async () => ({ ok: true, json: async () => ({ state: 'restarting-manager' }) }),
    setTimeout(fn, delay) { const id = ++serial; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  runInNewContext(更新进度脚本, context);
  return { elements, navigations, listeners, render: value => context.render(value),
    advance(ms) { now += ms; }, runReturn() {
      for (const [id, timer] of [...timers]) if (timer.at <= now && timer.fn.name !== 'poll') {
        timers.delete(id); timer.fn();
      }
    } };
}

test('进度页长等待仍可恢复：成功后自动返回动态端口，失败/无地址/离开页面取消跳转', async () => {
  const f = pageFixture(); await Promise.resolve(); await Promise.resolve();
  f.render({ state: 'restarting-manager', reason: 'update_waiting_manager' });
  f.advance(324000);
  f.render({ state: 'restarting-manager', reason: 'update_waiting_manager' });
  assert.match(f.elements.detail.textContent, /等待时间较长/);
  f.render({ state: 'success', origin: 'http://localhost:3007' });
  assert.equal(f.elements.return.hidden, false);
  f.advance(1000);
  f.render({ state: 'success', origin: 'http://localhost:3007' });
  f.advance(500); f.runReturn();
  assert.deepEqual(f.navigations, ['http://localhost:3007']);
  for (const next of [{ state: 'unavailable' }, { state: 'success', origin: null }]) {
    f.render({ state: 'success', origin: 'http://localhost:3008' });
    f.render(next); f.advance(1500); f.runReturn();
    assert.equal(f.navigations.length, 1);
  }
  f.render({ state: 'success', origin: 'http://localhost:3009' });
  f.listeners.pagehide(); f.advance(1500); f.runReturn();
  assert.equal(f.navigations.length, 1);
  f.listeners.pageshow();
  f.render({ state: 'success', origin: 'http://localhost:3010' });
  f.advance(1500); f.runReturn();
  assert.equal(f.navigations.at(-1), 'http://localhost:3010');
});
