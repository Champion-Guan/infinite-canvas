import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { generationFixture, listen, closeServer } from './生成网关隔离夹具.mjs';
import { createRoutedImageGateway } from '../扩展功能/故障切换/渠道切换网关.mjs';
import { emptyFallback } from '../扩展功能/故障切换/原版策略.mjs';
import { hashJSON } from '../扩展功能/故障切换/SQLite切换配置.mjs';
import { openGenerationTasks } from '../扩展功能/生成任务/SQLite生成任务.mjs';
import { createGenerationHTTPHandler } from '../扩展功能/生成网关/生成HTTP入口.mjs';
import { createGenerationClient } from '../扩展功能/生成任务/生成任务客户端.mjs';
import { GENERATION_PROTOCOL } from '../扩展功能/生成网关/生成协议.mjs';
import { IMAGE_RETRY_INTERVAL, IMAGE_AUTO_RETRY_LIMIT, canRetryImageResponse, normalizeImageFailureResponse, runSingleImageRetry, waitImageRetry } from '../扩展功能/生成任务/图片自动重试规则.mjs';

const response = (status, message = '图片服务暂时繁忙或不可用，请稍后再试。') =>
  ({ status, contentType: 'application/json', bytes: Buffer.from(JSON.stringify({ error: { message } })) });
const success = () => ({ status: 200, contentType: 'application/json', bytes: Buffer.from('{"data":[{"b64_json":"aW1hZ2U="}]}') });

for (const [status, message, retry] of [
  [503, 'status_code=503, 图片服务暂时繁忙或不可用，请稍后再试。', true],
  [504, '官方接口超时或暂时波动，请稍后重试。', true],
  [400, 'status_code=503, 图片服务暂时繁忙或不可用，请稍后再试。', true],
  [400, 'service temporarily unavailable', true],
  [400, '提示词违规，请修改后重新生成。', false],
  [503, '提示词违规，请修改后重新生成。', false],
  [500, 'insufficient_quota: 余额不足，请稍后重试', false],
  [503, 'invalid_api_key', false],
  [400, '请求携带的图片数量过多，最多只能上传14张图片。', false],
  [401, 'invalid_api_key', false], [403, 'Forbidden', false], [404, 'model not found', false],
  [422, 'invalid size', false], [429, 'rate limit', false], [400, 'unrecognized error', false],
  [500, 'temporary failure', true], [502, 'Bad Gateway', true],
]) test(`错误分类 ${status} ${message}`, () => assert.equal(canRetryImageResponse(response(status, message)), retry));

test('HTTP200错误信封按失败处理，成功图片和提示词文字不会误判', () => {
  const failed = response(200, 'status_code=503, 图片服务暂时繁忙或不可用，请稍后再试。');
  const normalized = normalizeImageFailureResponse(failed);
  assert.equal(normalized.status, 503); assert.equal(normalized.bytes, failed.bytes);
  assert.equal(canRetryImageResponse(normalized), true);
  const policy = normalizeImageFailureResponse(response(200, '提示词违规，请修改后重新生成。'));
  assert.equal(policy.status, 400); assert.equal(canRetryImageResponse(policy), false);
  const image = success(); assert.equal(normalizeImageFailureResponse(image), image);
  const content = { ...image, bytes: Buffer.from('{"data":[{"b64_json":"aW1hZ2U="}],"message":"status_code=503"}') };
  assert.equal(normalizeImageFailureResponse(content), content);
});
test('每张图最多首次加3次；每次间隔5000ms，最终保留真实错误', async () => {
  let calls = 0; const waits = [], progress = [], result = response(503);
  assert.equal(IMAGE_RETRY_INTERVAL, 5000); assert.equal(IMAGE_AUTO_RETRY_LIMIT, 3);
  assert.equal(await runSingleImageRetry({ execute: async () => { calls++; return result; },
    record: async value => progress.push(value), wait: async milliseconds => waits.push(milliseconds), now: () => 100 }), result);
  assert.equal(calls, 4); assert.deepEqual(waits, [5000, 5000, 5000]);
  assert.deepEqual(progress.filter(value => value.phase === 'waiting').map(value => value.nextRetryAt), [5100, 5100, 5100]);
});
test('成功立即停止、永久错误不等待、连接中断不重新生成', async () => {
  let calls = 0, waits = 0;
  const run = execute => runSingleImageRetry({ execute, record: async () => {}, wait: async () => waits++ });
  await run(async () => ++calls < 2 ? response(503) : success());
  assert.equal(calls, 2); assert.equal(waits, 1);
  calls = 0; waits = 0;
  await run(async () => { calls++; return response(400, '提示词违规'); });
  assert.equal(calls, 1); assert.equal(waits, 0);
  await assert.rejects(run(async () => { throw new Error('连接中断，结果未知'); }), /结果未知/);
});
test('等待期间停止立即结束，不再发出请求且保留最后错误', async () => {
  const controller = new AbortController(); let calls = 0;
  const result = await runSingleImageRetry({ signal: controller.signal, execute: async () => { calls++; return response(503); },
    record: async progress => { if (progress.phase === 'waiting') controller.abort(); } });
  assert.equal(result.status, 503); assert.equal(calls, 1);
});
test('真实5秒等待可提前取消，无遗留监听器', async () => {
  const controller = new AbortController(), started = Date.now();
  await waitImageRetry(5000, controller.signal);
  assert.ok(Date.now() - started >= 4900);
  const pending = waitImageRetry(5000, controller.signal); controller.abort();
  await assert.rejects(pending, error => error.name === 'AbortError');
});

async function fixture({ behavior = () => response(503), retryWait = async () => {}, mode = 'single' } = {}) {
  const f = await generationFixture(), calls = [], waits = [];
  const base = { ...f.gateway, async execute(binding, request, options) {
    calls.push({ binding, request, signal: options.signal }); return behavior(calls, options);
  } };
  const gateway = createRoutedImageGateway({ workspace: f.workspace, base, runTrustedWrite: op => f.coordinator.runWrite(op),
    retryWait: async (...args) => { waits.push(args[0]); return retryWait(...args); } });
  const bound = await f.bind(), requests = [f.submit(bound.binding).request];
  const candidates = [{ profileId: 'synthetic', modelName: 'test-image', channelName: '模拟渠道', binding: bound.binding,
    requestHash: hashJSON(requests[0]), quality: 'auto', size: '1024x1024' }];
  let revision = 0;
  if (mode === 'fallback') {
    const config = emptyFallback(); config.enabled = true; config.capabilities.image = { enabled: true, entries: [{ profileId: 'synthetic', modelName: 'test-image', enabled: true }] };
    revision = (await gateway.fallbackSave(config, 0)).revision;
  }
  const { binding } = await gateway.createPlan({ mode, capability: 'image', revision, candidates });
  const request = { method: 'POST', path: '/v1/images/generations', contentType: 'application/json',
    body: Buffer.from(JSON.stringify({ format: 'guan-routed-image-request.v1', requests })).toString('base64') };
  return { ...f, gateway, calls, waits, binding, request };
}
test('单渠道账本：四次同请求同绑定；重复提交、页面重新查询和冷启动都不重置额度', async () => {
  const f = await fixture(); let tasks;
  try {
    tasks = await openGenerationTasks({ ...f, verifyApplied: f.verifyApplied });
    const input = { id: randomUUID(), productId: 'product-A', nodeId: 'node-A', binding: f.binding, request: f.request };
    await tasks.submit(input); await tasks.drain();
    assert.equal(tasks.get(input.id).state, 'failed'); assert.equal(f.calls.length, 4);
    assert.equal(new Set(f.calls.map(call => JSON.stringify([call.binding, call.request]))).size, 1);
    assert.deepEqual(f.waits, [5000, 5000, 5000]);
    const progress = f.gateway.imageRetryProgress(input.id);
    assert.deepEqual(progress, { attempt: 3, maxRetries: 3, phase: 'complete', nextRetryAt: null });
    await tasks.submit(input); tasks.get(input.id); assert.equal(f.calls.length, 4);
    const result = tasks.result(input.id);
    assert.equal(f.gateway.resultRoute(input.id, createHash('sha256').update(result.bytes).digest('hex')).channelName, '模拟渠道');
    await tasks.close();
    tasks = await openGenerationTasks({ ...f, verifyApplied: f.verifyApplied });
    await tasks.submit(input); assert.equal(f.calls.length, 4);
  } finally { await tasks?.drain(); await tasks?.close(); await f.close(); }
});
test('Fallback模式即使只有一个候选也不自动重试', async () => {
  const f = await fixture({ mode: 'fallback' });
  try {
    await f.gateway.execute(f.binding, f.request, { taskId: randomUUID() });
    assert.equal(f.calls.length, 1); assert.deepEqual(f.waits, []);
  } finally { await f.close(); }
});
test('两张图片独立计算次数，成功结果不受其他失败槽影响', async () => {
  let first;
  const f = await fixture({ behavior: calls => {
    first ||= calls[0].signal;
    return calls.at(-1).signal === first && calls.filter(call => call.signal === first).length < 3 ? response(503) : success();
  } });
  try {
    const controllers = [new AbortController(), new AbortController()];
    await Promise.all(controllers.map(controller => f.gateway.execute(f.binding, f.request, { taskId: randomUUID(), signal: controller.signal })));
    assert.deepEqual(controllers.map(controller => f.calls.filter(call => call.signal === controller.signal).length).sort(), [1, 3]);
  } finally { await f.close(); }
});
test('真实HTTP查询发布等待状态，停止后不再请求，最终错误保留且不新增设置操作', async () => {
  let waiting;
  const startedWaiting = new Promise(resolve => { waiting = resolve; });
  const f = await fixture({ retryWait: async (milliseconds, signal) => { waiting(); return waitImageRetry(milliseconds, signal); } });
  let tasks, server;
  try {
    tasks = await openGenerationTasks({ ...f, verifyApplied: f.verifyApplied });
    let handler;
    server = createServer((request, reply) => { void handler(request, reply); });
    const origin = await listen(server);
    handler = createGenerationHTTPHandler({ origin, gateway: f.gateway, tasks, authorize: () => {} });
    const client = createGenerationClient({ command: async value => {
      const reply = await fetch(origin + '/__guan-local/generation', { method: 'POST', headers: { origin, 'content-type': 'application/json', 'x-guan-generation-protocol': GENERATION_PROTOCOL }, body: JSON.stringify(value) });
      return reply.json();
    } });
    const input = { id: randomUUID(), productId: 'product-A', nodeId: 'node-A', binding: f.binding, request: f.request };
    let notices = 0;
    const unsubscribe = client.subscribeTask(input.id, () => notices++);
    await client.submit(input); await startedWaiting;
    const job = await client.get(input.id);
    assert.equal(job.imageRetry.phase, 'waiting'); assert.equal(client.taskSnapshot(input.id).imageRetry.maxRetries, 3);
    await client.get(input.id); assert.equal(notices, 1);
    await client.cancel(input.id);
    assert.equal((await client.get(input.id)).state, 'failed');
    assert.match(await client.failure(input), /图片服务暂时繁忙/);
    assert.equal(f.calls.length, 1);
    unsubscribe(); assert.equal(client.taskSnapshot(input.id), null);
    await assert.rejects(client.fallbackCommand({ operation: 'image-retry-save', value: { enabled: false, maxRetries: 1 }, revision: 0 }));
  } finally { await tasks?.drain(); await tasks?.close(); if (server) await closeServer(server); await f.close(); }
});
