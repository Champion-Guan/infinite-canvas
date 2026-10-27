import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { randomUUID, createHash } from 'node:crypto';
import { StorageError } from '../扩展功能/本机存储/协议.mjs';
import { GENERATION_PROTOCOL, MAX_RESPONSE_BYTES } from '../扩展功能/生成网关/生成协议.mjs';
import { createGenerationHTTPHandler } from '../扩展功能/生成网关/生成HTTP入口.mjs';
import { createGenerationClient } from '../扩展功能/生成任务/生成任务客户端.mjs';
import { generationFixture, listen, closeServer } from './生成网关隔离夹具.mjs';

async function fixture() {
  const f = await generationFixture(); let handle, live = true, checks = 0;
  const capability = randomUUID(), server = createServer(async (req, res) => { if (!await handle(req, res)) { res.writeHead(404); res.end(); } });
  const origin = await listen(server);
  handle = createGenerationHTTPHandler({ origin, gateway: f.gateway, tasks: f.tasks, authorize(req) { checks++; if (!live || req.headers.authorization !== 'Bearer ' + capability) throw new StorageError('authorization_denied', '合成页面授权已拒绝。', 401); } });
  async function post(value, options = {}) {
    return fetch(origin + '/__guan-local/generation', { method: options.method || 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Guan-Generation-Protocol': GENERATION_PROTOCOL, Authorization: 'Bearer ' + capability, ...options.headers }, body: JSON.stringify(value) });
  }
  const command = async value => { const response = await post(value); const result = await response.json(); if (!response.ok) throw new StorageError(result.error.code, result.error.message, response.status); return result; };
  return { ...f, origin, post, client: createGenerationClient({ command }), get checks() { return checks; }, revoke() { live = false; }, async close() { await closeServer(server); await f.close(); } };
}
test('真实HTTP/客户端→后端凭据→模拟渠道→SQLite→原产品保存ACK闭环', async () => {
  const f = await fixture();
  try {
    const bound = await f.client.bind({ kind: 'openai', endpoint: f.providerOrigin, value: 'synthetic-http-key' }), input = f.submit(bound.binding);
    await f.client.submit(input); await f.tasks.drain();
    const result = await f.client.deliver(input, { applyAndSave(job) { assert.equal(job.productId, 'product-A'); return f.saveCanvas(job); } });
    assert.equal(result.applied, true); assert.equal(f.requests.length, 1); assert.ok(f.checks >= 12);
  } finally { await f.close(); }
});
test('原授权HTTP及客户端可以收口未提交身份，撤销后拒绝且不发送API', async () => {
  const f = await fixture();
  try {
    const b = await f.bind(), input = f.submit(b.binding);
    const task = { id: input.id, productId: input.productId, nodeId: input.nodeId, binding: input.binding, requestHash: 'c'.repeat(64) };
    const retired = await f.client.retirePreparedTask(task);
    assert.equal(retired.reason, 'replaced_before_dispatch'); assert.equal(retired.state, 'cancelled');
    f.revoke();
    assert.equal((await f.post({ operation: 'retire-prepared', task: { ...task, id: randomUUID() } })).status, 401);
    assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});
for (const [title, headers] of [
  ['跨站Origin', { Origin: 'http://evil.example' }], ['缺失能力', { Authorization: '' }], ['错误协议', { 'X-Guan-Generation-Protocol': 'unknown' }], ['错误Content-Type', { 'Content-Type': 'text/plain' }], ['跨站FetchSite', { 'Sec-Fetch-Site': 'cross-site' }],
]) test('HTTP拒绝' + title, async () => {
  const f = await fixture();
  try { const reply = await f.post({ operation: 'list', productId: 'product-A' }, { headers }); assert.ok(reply.status >= 400); assert.equal(f.requests.length, 0); }
  finally { await f.close(); }
});
test('页面撤销后不能下载结果或创建新任务，原结果保留', async () => {
  const f = await fixture();
  try {
    const b = await f.bind(), input = f.submit(b.binding); await f.client.submit(input); await f.tasks.drain(); f.revoke();
    assert.equal((await f.post({ operation: 'result', id: input.id })).status, 401); assert.equal(f.tasks.get(input.id).state, 'succeeded');
    assert.equal((await f.post({ operation: 'submit', task: f.submit(b.binding) })).status, 401); assert.equal(f.requests.length, 1);
  } finally { await f.close(); }
});
test('禁止HTTP读密钥、任意后端方法和secret引用重绑', async () => {
  const f = await fixture();
  try {
    for (const value of [{ operation: 'read', ref: 'secret:' + 'a'.repeat(64) }, { operation: 'close' }, { operation: 'bindExistingProfile' }, { operation: 'bind', profile: { kind: 'openai', endpoint: f.providerOrigin, credentialRef: 'secret:' + 'a'.repeat(64) } }]) assert.ok((await f.post(value)).status >= 400);
  } finally { await f.close(); }
});
test('保存失败不确认完成；重新交付同一结果可恢复，不重发API', async () => {
  const f = await fixture();
  try {
    const b = await f.bind(), input = f.submit(b.binding); await f.client.submit(input); await f.tasks.drain();
    await assert.rejects(f.client.deliver(input, { applyAndSave: async () => { throw Error('synthetic save failed'); } }));
    assert.equal(f.tasks.get(input.id).applied, false);
    assert.equal((await f.client.deliver(input, { applyAndSave: job => f.saveCanvas(job) })).applied, true); assert.equal(f.requests.length, 1);
  } finally { await f.close(); }
});
test('客户端拒绝跨产品/跨节点结果以及损坏响应体，不调用保存端口', async () => {
  const f = await fixture();
  try {
    const b = await f.bind(), input = f.submit(b.binding); await f.client.submit(input); await f.tasks.drain(); let writes = 0;
    await assert.rejects(f.client.deliver({ ...input, productId: 'product-B' }, { applyAndSave() { writes++; } }));
    const bad = createGenerationClient({ command: async () => ({ protocol: GENERATION_PROTOCOL, result: { ...f.tasks.get(input.id), bytes: 'e30=' } }) });
    await assert.rejects(bad.deliver(input, { applyAndSave() { writes++; } })); assert.equal(writes, 0);
  } finally { await f.close(); }
});
test('无法确认的HTTP提交不自动重发，原id可查询找回结果', async () => {
  const f = await fixture();
  try {
    const b = await f.bind(), input = f.submit(b.binding); let sends = 0;
    const client = createGenerationClient({ command: async value => { sends++; if (value.operation === 'submit') { await f.tasks.submit(value.task); throw Error('synthetic lost http ack'); } return { protocol: GENERATION_PROTOCOL, result: f.tasks.get(value.id) }; } });
    await assert.rejects(client.submit(input)); assert.equal(sends, 1); await f.tasks.drain(); assert.equal((await client.get(input.id)).state, 'succeeded'); assert.equal(f.requests.length, 1);
  } finally { await f.close(); }
});
test('32MiB结果可核验并交付保存，不因base64校验栈溢出或接受非规范尾部', async () => {
  const bytes = Buffer.alloc(MAX_RESPONSE_BYTES, 120), encoded = bytes.toString('base64');
  const task = { id: randomUUID(), productId: 'product-A', nodeId: 'node-A' };
  const job = { ...task, state: 'succeeded', applied: false, result: { id: createHash('sha256').update(bytes).digest('hex'), size: bytes.length } };
  let writes = 0, corrupt = false;
  const client = createGenerationClient({ command: async value => ({ protocol: GENERATION_PROTOCOL, result: value.operation === 'applied' ? { ...job, applied: true } : { ...job, bytes: corrupt ? encoded.slice(0, -2) + 'h=' : encoded } }) });
  assert.equal((await client.deliver(task, { applyAndSave(value) { writes++; assert.equal(value.result.size, MAX_RESPONSE_BYTES); return {}; } })).applied, true);
  corrupt = true;
  await assert.rejects(client.deliver(task, { applyAndSave() { writes++; } })); assert.equal(writes, 1);
});
