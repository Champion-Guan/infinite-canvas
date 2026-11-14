import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { waitForProxyStartup } from '../扩展功能/网络代理/等待代理启动.mjs';
import { openNetworkProxyService } from '../扩展功能/网络代理/代理服务.mjs';
import { 创建本地转发 } from '../扩展功能/网络代理/本地转发服务.mjs';
import { assembleSoftwareUpdates } from '../扩展功能/软件更新/更新服务装配.mjs';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { createNetworkProxyHTTPHandler } from '../扩展功能/网络代理/代理HTTP入口.mjs';
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const tick = () => new Promise(done => setImmediate(done));

test('单次取消等待不取消代理共用启动，其他等待者正常恢复', async () => {
  const gate = deferred(), controller = new AbortController();
  const first = waitForProxyStartup(gate.promise, controller.signal), second = waitForProxyStartup(gate.promise);
  controller.abort(); await assert.rejects(first, error => error.name === 'AbortError');
  gate.resolve('ready'); assert.equal(await second, 'ready');
});

test('本地代理开关快照不等待网络核心观测', async () => {
  const block = deferred(), entered = deferred();
  const handler = createNetworkProxyHTTPHandler({ origin: 'http://localhost:3000', authorize: async () => {},
    proxy: { status: () => ({ relayEnabled: true, starting: true }), observeStatus: async () => { entered.resolve(); await block.promise; return {}; } } });
  const request = operation => {
    const req = Readable.from([Buffer.from(JSON.stringify({ operation }))]);
    Object.assign(req, { url: '/__guan-local/network-proxy', method: 'POST', headers: {
      host: 'localhost:3000', origin: 'http://localhost:3000', 'content-type': 'application/json', 'x-guan-proxy-protocol': 'guan-network-proxy.v1',
    } });
    const res = new EventEmitter(); res.setHeader = () => {}; res.writeHead = () => {};
    res.end = body => { res.body = JSON.parse(body); };
    return handler(req, res).then(() => res.body.result);
  };
  const observed = request('status');
  try { await entered.promise; assert.deepEqual(await request('snapshot'), { relayEnabled: true, starting: true }); }
  finally { block.resolve(); await observed; }
});

test('后台恢复不阻塞工作台，启动等待只在完成后返回，关闭的代理保留关闭', async () => {
  const gate = deferred();
  const proxy = await openNetworkProxyService({
    workspace: { workspaceId: 'test', readDocument: () => null },
    vault: { store() {}, read() {} }, runTrustedWrite: fn => fn(), runtime: { start() { assert.fail('没有配置不得启动'); } },
    deferStartup: true, initialConfiguration: () => gate.promise,
  });
  try {
    assert.equal(proxy.status().starting, true);
    let ready = false; const waiting = proxy.waitUntilReady().then(() => { ready = true; });
    await tick(); assert.equal(ready, false);
    gate.resolve(null); await waiting;
    assert.equal(proxy.status().starting, false);
    assert.equal(proxy.status().running, false);
    assert.ok(proxy.status().startupMs >= 0);
  } finally { gate.resolve(null); await proxy.waitUntilReady(); await proxy.close(); }
});

test('读取订阅显示信息和配置恢复并行，核心不等待显示来源解密', async () => {
  const display = deferred(), started = deferred();
  const hash = (await import('node:crypto')).createHash;
  const seal = (id, text) => ({ refs: ['secret:' + id.repeat(64)], hash: hash('sha256').update(text).digest('hex') });
  const source = 'https://example.com/sub', config = 'proxies: []';
  const value = { format: 'guan-network-proxy-state.v1', enabled: true, relayEnabled: true, sourceKind: 'url',
    source: seal('a', source), config: seal('b', config), configName: '配置' };
  const proxy = await openNetworkProxyService({
    workspace: { workspaceId: 'test', readDocument: () => ({ workspaceId: 'test', revision: 1, mediaIds: [], value }) },
    vault: { store() {}, read: ref => ref.includes('aaaa') ? display.promise : Promise.resolve(config) },
    runTrustedWrite: fn => fn(), deferStartup: true,
    runtime: { async start(text) { assert.equal(text, config); started.resolve(); return { running: () => true, stop: async () => {} }; } },
  });
  try {
    await started.promise;
    await tick();
    assert.equal(proxy.status().running, true);
    display.resolve(source); await proxy.waitUntilReady();
  } finally { display.resolve(source); await proxy.waitUntilReady(); await proxy.close(); }
});

test('本地转发启动等待期间不拿租约不发送，取消不发出，完成后只发一次', async () => {
  const gate = deferred(); let sends = 0, leases = 0;
  const relay = 创建本地转发({
    proxy: { waitUntilReady: ({ signal }) => waitForProxyStartup(gate.promise, signal),
      status: () => ({ relayEnabled: true, enabled: false }), acquireRoute: () => { leases++; return { release() {} }; } },
    direct: async () => { sends++; return { status: 204, bytes: Buffer.alloc(0) }; },
  });
  const value = { url: 'https://example.com/image', method: 'GET', headers: {}, body: '' };
  const controller = new AbortController(), cancelled = relay(value, { signal: controller.signal });
  controller.abort(); await assert.rejects(cancelled);
  const request = relay(value); await tick();
  assert.equal(sends, 0); assert.equal(leases, 0);
  gate.resolve(); await request; assert.equal(sends, 1); assert.equal(leases, 1);
});

test('更新检查在代理启动中保持等待，完成后才获取租约，不提前记录不可用', async t => {
  const root = await mkdtemp(join(tmpdir(), '代理启动更新-'));
  const gate = deferred(), waiting = deferred(); let acquired = 0;
  const updates = assembleSoftwareUpdates({ dataRoot: root, origin: 'http://localhost:3000', currentVersion: '2.0.0',
    authorize: async () => 'page', networkProxy: {
      getStatus: () => ({ enabled: true }), waitUntilReady: async ({ signal }) => { waiting.resolve(); await waitForProxyStartup(gate.promise, signal); },
      acquireRoute() { acquired++; throw Error('合成不可用，不执行外网'); },
    } });
  t.after(async () => { gate.resolve(); await updates.close(); await rm(root, { recursive: true, force: true }); });
  const request = Readable.from([Buffer.from('{"operation":"check"}')]);
  Object.assign(request, { url: '/__guan-local/software-updates', method: 'POST', headers: {
    host: 'localhost:3000', origin: 'http://localhost:3000', 'content-type': 'application/json', 'x-guan-local-protocol': 'guan-local-authorization.v1',
  } });
  const response = new EventEmitter();
  response.writeHead = () => {};
  response.end = body => { response.body = JSON.parse(body); };
  const flight = updates.handle(request, response);
  await waiting.promise; assert.equal(acquired, 0);
  gate.resolve(); await flight; assert.equal(acquired, 1);
  assert.equal(response.body.result.error, 'proxy_unavailable');
});
