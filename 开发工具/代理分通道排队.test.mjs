import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import { createProxyRequestQueue } from '../扩展功能/网络代理/代理请求排队.mjs';
import { createNetworkProxyHTTPHandler } from '../扩展功能/网络代理/代理HTTP入口.mjs';
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const tick = () => new Promise(done => setImmediate(done));
const origin = 'http://localhost:3000';
function invoke(handle, value, headers = {}) {
  const body = Buffer.from(JSON.stringify(value)), request = Readable.from([body]);
  Object.assign(request, { url: '/__guan-local/network-proxy', method: 'POST', headers: {
    host: 'localhost:3000', origin, 'content-type': 'application/json',
    'x-guan-proxy-protocol': 'guan-network-proxy.v1', 'content-length': String(body.length), ...headers,
  } });
  const response = new EventEmitter();
  response.setHeader = () => {};
  response.writeHead = status => { response.status = status; };
  response.end = body => { response.body = JSON.parse(body); response.writableFinished = response.writableEnded = true; };
  const promise = handle(request, response).then(() => response);
  return { promise, response, request };
}

test('四个慢转发独占转发通道，第五个排队，状态和节点读取仍立即成功，无每分钟60次共用额度', async () => {
  const block = deferred(), calls = [];
  const handle = createNetworkProxyHTTPHandler({ origin, authorize: async () => {},
    proxy: { status: () => ({ running: true }), nodes: async () => [] },
    relay: async value => { calls.push(value.id); await block.promise; return {}; } });
  const flights = Array.from({ length: 5 }, (_, id) => invoke(handle, { operation: 'relay', request: { id } }));
  try {
    await tick(); assert.equal(calls.length, 4);
    for (let i = 0; i < 65; i++) {
      const r = await invoke(handle, { operation: i % 2 ? 'nodes' : 'status' }).promise;
      assert.equal(r.status, 200);
    }
  } finally { block.resolve(); await Promise.all(flights.map(f => f.promise)); }
  assert.deepEqual(calls, [0, 1, 2, 3, 4]);
});

test('等待取消、超时和队列满均不执行转发，后续名额可用且不重发', async () => {
  const block = deferred(), calls = [];
  const handle = createNetworkProxyHTTPHandler({ origin, authorize: async () => {}, proxy: { status: () => ({}) },
    queueOptions: { concurrent: 1, maxQueued: 1, timeoutMs: 50 },
    relay: async value => { calls.push(value.id); await block.promise; return {}; } });
  const first = invoke(handle, { operation: 'relay', request: { id: 1 } });
  await tick();
  const cancelled = invoke(handle, { operation: 'relay', request: { id: 2 } });
  await tick();
  const full = await invoke(handle, { operation: 'relay', request: { id: 3 } }).promise;
  assert.equal(full.body.error.code, 'proxy_queue_full');
  cancelled.response.emit('close'); await cancelled.promise;
  assert.equal(cancelled.response.body.error.code, 'proxy_queue_cancelled');
  const timed = await invoke(handle, { operation: 'relay', request: { id: 4 } }).promise;
  assert.equal(timed.body.error.code, 'proxy_queue_timeout');
  block.resolve(); await first.promise;
  await invoke(handle, { operation: 'relay', request: { id: 5 } }).promise;
  assert.deepEqual(calls, [1, 5]);
});

test('内存权重限制实际并发，按先来先服务移交，取消队首后唤醒后续请求', async () => {
  const q = createProxyRequestQueue({ concurrent: 4, maxBytes: 10, maxQueuedBytes: 5, timeoutMs: 500 });
  const release = await q.acquire({ weight: 8 });
  const controller = new AbortController(), head = q.acquire({ weight: 4, retained: 3, signal: controller.signal });
  const tail = q.acquire({ weight: 2, retained: 2 });
  await assert.rejects(q.acquire({ weight: 1, retained: 1 }), error => error.code === 'proxy_queue_full');
  assert.equal(q.status().queued, 2);
  controller.abort(); await assert.rejects(head, error => error.code === 'proxy_queue_cancelled');
  const releaseTail = await tail;
  assert.deepEqual(q.status(), { active: 2, queued: 0, reservedBytes: 10, queuedBytes: 0 });
  release(); release(); releaseTail();
  assert.equal(q.status().active, 0);
});

test('排队后再次核验授权，失效请求不发出，失败释放容量', async () => {
  let authorized = true, sends = 0;
  const block = deferred();
  const handle = createNetworkProxyHTTPHandler({ origin, authorize: async () => { if (!authorized) throw Error('ended'); },
    proxy: { status: () => ({}) }, queueOptions: { concurrent: 1 },
    relay: async () => { sends++; await block.promise; throw Error('network lost'); } });
  const first = invoke(handle, { operation: 'relay', request: {} });
  await tick(); const second = invoke(handle, { operation: 'relay', request: {} });
  await tick(); authorized = false; block.resolve();
  await Promise.all([first.promise, second.promise]);
  assert.equal(sends, 1);
  authorized = true;
  assert.equal((await invoke(handle, { operation: 'status' }).promise).status, 200);
});

test('读取正文保持体积与来源限制，无效请求不占用执行通道', async () => {
  const handle = createNetworkProxyHTTPHandler({ origin, authorize: async () => {}, proxy: { status: () => ({}) } });
  assert.equal((await invoke(handle, { operation: 'status' }, { origin: 'https://other.example' }).promise).status, 403);
  assert.equal((await invoke(handle, { operation: 'status' }, { 'content-length': String(64 * 1024 ** 2) }).promise).status, 413);
  assert.equal((await invoke(handle, { operation: 'status' }).promise).status, 200);
});

test('真实HTTP：慢转发时管理读取可用，排队请求取消后不会发出，第五个正常请求只发一次', async () => {
  const block = deferred(), ready = deferred(), calls = [];
  let handler, received = 0;
  const cancelArrived = deferred(), cancelClosed = deferred();
  const server = createServer((req, res) => {
    if (++received === 5) {
      res.once('close', () => cancelClosed.resolve());
      cancelArrived.resolve();
    }
    void handler(req, res);
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const address = `http://127.0.0.1:${server.address().port}`;
  handler = createNetworkProxyHTTPHandler({ origin: address, authorize: async () => {}, proxy: { status: () => ({ running: true }) },
    relay: async value => { calls.push(value.id); if (calls.length === 4) ready.resolve(); await block.promise; return {}; } });
  const post = (value, signal) => fetch(address + '/__guan-local/network-proxy', { method: 'POST', signal,
    headers: { origin: address, 'content-type': 'application/json', 'x-guan-proxy-protocol': 'guan-network-proxy.v1' }, body: JSON.stringify(value) });
  const flights = Array.from({ length: 4 }, (_, id) => post({ operation: 'relay', request: { id } }));
  try {
    await ready.promise;
    const cancelled = new AbortController();
    const cancelledFlight = post({ operation: 'relay', request: { id: 'cancelled' } }, cancelled.signal);
    const rejected = assert.rejects(cancelledFlight, error => error.name === 'AbortError');
    await cancelArrived.promise;
    const status = await post({ operation: 'status' });
    assert.equal(status.status, 200);
    assert.equal((await status.json()).result.running, true);
    cancelled.abort(); await rejected; await cancelClosed.promise;
    const fifth = post({ operation: 'relay', request: { id: 4 } });
    block.resolve();
    for (const response of await Promise.all([...flights, fifth])) {
      assert.equal(response.status, 200); await response.json();
    }
    assert.deepEqual(calls, [0, 1, 2, 3, 4]);
  } finally {
    block.resolve(); await Promise.allSettled(flights);
    server.closeAllConnections(); await new Promise(done => server.close(done));
  }
});
