import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { PassThrough } from 'node:stream';
import { randomBytes, randomUUID } from 'node:crypto';
import { authorizeLocalStorage } from '../扩展功能/本机存储/本机授权客户端.mjs';
import { createRenewingDataClient } from '../扩展功能/本机存储/续期数据客户端.mjs';
import { createLocalAuthorizationGateway } from '../扩展功能/本机服务/本机授权网关.mjs';
import { createSessionController } from '../扩展功能/本机服务/受控会话.mjs';
import { createGenerationHTTPHandler } from '../扩展功能/生成网关/生成HTTP入口.mjs';
import { PROTOCOL } from '../扩展功能/本机存储/协议.mjs';
import { generationFixture, listen, closeServer } from './生成网关隔离夹具.mjs';

test('超过4个已授权本机请求同时处理，不挤掉同批其他请求', async () => {
  const origin = 'http://localhost:3000', pending = [], responses = [];
  let release, entered = 0, checks = 0;
  const waiting = new Promise(resolve => { release = resolve; });
  const handle = createGenerationHTTPHandler({ origin, authorize: () => { checks++; }, tasks: { submit() {} },
    gateway: { async bind() { entered++; await waiting; return { binding: 'provider:' + 'b'.repeat(64) }; } } });
  try {
    for (let index = 0; index < 12; index++) {
      const request = new PassThrough(), response = { destroyed: false, writableEnded: false, setHeader() {},
        writeHead(status) { this.status = status; }, end(value) { this.value = JSON.parse(value); } };
      request.url = '/__guan-local/generation'; request.method = 'POST';
      request.headers = { host: new URL(origin).host, origin, 'content-type': 'application/json', 'x-guan-generation-protocol': 'guan-generation.v1' };
      responses.push(response); pending.push(handle(request, response));
      request.end(JSON.stringify({ operation: 'bind', profile: {} }));
    }
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(entered, 12);
    release(); await Promise.all(pending);
    assert.ok(responses.every(response => response.status === 200));
    assert.equal(checks, 36);
  } finally { release(); await Promise.allSettled(pending); }
});

test('34图同批授权提交与超过120次轮询均通过，续期共用一次且每图只请求一次', { timeout: 15_000 }, async () => {
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  const f = await generationFixture({ beforeReply: () => waiting });
  let authorization, generation, controller, client, time = Date.now(), renewals = 0;
  const server = createServer(async (request, response) => {
    if (await generation?.(request, response) || await authorization?.handle(request, response)) return;
    response.writeHead(404); response.end();
  });
  try {
    const origin = await listen(server);
    controller = createSessionController({ origin, now: () => time, renewalWindow: 30_000, service: {
      issueSession: () => ({ protocol: PROTOCOL, workspaceId: f.workspace.workspaceId, origin,
        token: randomBytes(32).toString('hex'), csrf: randomBytes(32).toString('hex'), expiresAt: time + 60_000 }),
      revokeSession() {},
    } });
    authorization = createLocalAuthorizationGateway({ origin, controller, now: () => time, dataURL: 'http://127.0.0.1:49999' });
    generation = createGenerationHTTPHandler({ origin, gateway: f.gateway, tasks: f.tasks, now: () => time,
      authorize: request => authorization.assertGenerationPage(request) });
    const fetchImpl = (url, options) => {
      if (url.endsWith('/session') && JSON.parse(options.body).operation === 'renew') renewals++;
      return fetch(url, { ...options, headers: { ...options.headers, Origin: origin, 'Sec-Fetch-Site': 'same-origin' } });
    };
    const auth = await authorizeLocalStorage({ origin, code: authorization.issueTicket().code, now: () => time, fetchImpl,
      prepareSession: () => client.ensureSession() });
    client = createRenewingDataClient({ ...auth, origin, now: () => time, fetchImpl, autoReconnect: true });
    await client.ensureSession(); time += 35_000;
    const binding = await f.bind(), inputs = Array.from({ length: 34 }, () => f.submit(binding.binding, { nodeId: randomUUID() }));
    const accepted = await Promise.allSettled(inputs.map(input => auth.generationPort.submit(input)));
    assert.deepEqual(accepted.filter(item => item.status === 'rejected').map(item => item.reason.code), []);
    assert.equal(f.tasks.getStatus().running, 34);
    time += 24 * 60 * 60_000;
    for (let round = 0; round < 6; round++)
      await Promise.all(inputs.map(input => auth.generationPort.get(input.id)));
    assert.equal(renewals, 1);
    assert.equal(authorization.getStatus().authorizedPages, 1);
    release(); await f.tasks.drain();
    assert.equal(f.requests.length, 34);
    for (const input of inputs) assert.equal((await auth.generationPort.get(input.id)).state, 'succeeded');
    await auth.host.close();
    await assert.rejects(auth.generationPort.get(inputs[0].id), error => error.code === 'authorization_expired');
    assert.equal(f.requests.length, 34);
  } finally {
    release(); await closeServer(server); authorization?.close(); controller?.close(); await f.close();
  }
});

test('默认任务账本超过256条仍能整批提交，历史身份保留且每笔只请求一次', { timeout: 60_000 }, async () => {
  const f = await generationFixture();
  try {
    const binding = await f.bind();
    const inputs = Array.from({ length: 258 }, () => f.submit(binding.binding, { nodeId: randomUUID() }));
    for (let start = 0; start < inputs.length; start += 34) {
      const results = await Promise.allSettled(inputs.slice(start, start + 34).map(input => f.tasks.submit(input)));
      assert.deepEqual(results.filter(item => item.status === 'rejected').map(item => item.reason.code), []);
      await f.tasks.drain();
    }
    assert.equal(f.tasks.list('product-A').length, 258);
    assert.equal(f.requests.length, 258);
    for (const input of inputs) assert.equal(f.tasks.get(input.id).state, 'succeeded');
    await f.tasks.submit(inputs[0]);
    assert.equal(f.requests.length, 258);
  } finally { await f.close(); }
});

for (const [code, status, expected] of [
  ['generation_http_busy', 429, /繁忙/],
  ['generation_busy', 429, /容量/],
  ['session_expired', 401, /会话/],
  ['authorization_denied', 401, /授权/],
]) test(`生成错误${code}保留错误种类并显示对应原因`, async () => {
  const origin = 'http://localhost:3000';
  const auth = await authorizeLocalStorage({ origin, code: 'a'.repeat(64), fetchImpl: async url =>
    url.endsWith('/authorize')
      ? Response.json({ protocol: 'guan-local-authorization.v1', origin, dataURL: 'http://127.0.0.1:49999', capability: 'b'.repeat(64), expiresAt: Date.now() + 60_000 })
      : Response.json({ protocol: 'guan-generation.v1', error: { code, message: '服务端原始内容不直接显示' } }, { status }),
  });
  await assert.rejects(auth.generationPort.list('product-A'), error => {
    assert.equal(error.code, code); assert.equal(error.status, status); assert.match(error.message, expected);
    if (code !== 'authorization_denied') assert.doesNotMatch(error.message, /授权已拒绝|可信入口重新授权/);
    return true;
  });
});
