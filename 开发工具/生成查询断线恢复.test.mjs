import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { StorageError } from '../扩展功能/本机存储/协议.mjs';
import { GENERATION_PROTOCOL } from '../扩展功能/生成网关/生成协议.mjs';
import { createGenerationClient } from '../扩展功能/生成任务/生成任务客户端.mjs';
import { recoverGenerationResponse } from '../扩展功能/生成任务/本机任务响应恢复.mjs';
import { runCanvasImageTask } from '../扩展功能/画布生成/图片任务衔接.mjs';
import { generationFixture } from './生成网关隔离夹具.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const error = code => new StorageError(code, '合成本机连接故障', code === 'request_timeout' ? 504 : 503);
const request = { method: 'POST', path: '/v1/images/generations', contentType: 'application/json', body: 'e30=' };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function fixture({ faults = {}, state = 'succeeded' } = {}) {
  const jobs = new Map(), commands = [], records = [], waits = [];
  const bytes = Buffer.from('{"data":[{"b64_json":"aXNvbGF0ZWQ="}]}');
  let applications = 0;
  const response = { id: digest(bytes), size: bytes.length, status: state === 'failed' ? 400 : 200, contentType: 'application/json' };
  const command = async value => {
    commands.push(structuredClone(value));
    const fault = faults[value.operation]?.shift();
    if (fault && fault !== 'lost_ack') throw error(fault);
    let job = jobs.get(value.id || value.task?.id), result;
    if (value.operation === 'submit') {
      job = { ...value.task, state, applied: false, reason: state === 'failed' ? 'upstream_http_error' : '', result: response };
      jobs.set(job.id, job); result = job;
    } else if (value.operation === 'get') {
      assert.ok(job, '恢复只能查询已记录的原任务'); result = job;
    } else if (value.operation === 'result') result = { ...job, bytes: bytes.toString('base64') };
    else if (value.operation === 'checkpoint') { assert.equal(applications, 1); result = { rootRevision: 1, rootHash: 'b'.repeat(64) }; }
    else if (value.operation === 'applied') { assert.equal(applications, 1); job.applied = true; result = job; }
    else if (value.operation === 'cancel') { job.state = 'cancelled'; result = job; }
    else assert.fail('未预期操作：' + value.operation);
    if (fault === 'lost_ack') throw error('request_timeout');
    return { protocol: GENERATION_PROTOCOL, result: structuredClone(result) };
  };
  const host = createGenerationClient({ command });
  const options = {
    host, scope: { productId: 'product-A', nodeId: 'node-A', slotId: 'image-A' },
    prepare: async () => structuredClone(request), bind: async () => 'provider:' + 'a'.repeat(64),
    recordTask: async record => records.push(structuredClone(record)),
    applyAndSave: async () => { applications++; }, wait: async () => {},
    retryWait: async milliseconds => { waits.push(milliseconds); },
  };
  return { options, commands, records, jobs, waits, get applications() { return applications; } };
}

for (const operation of ['get', 'result', 'checkpoint', 'applied']) {
  test(`${operation} 超时及断连后自动恢复，沿用原ID且只应用图片一次`, async () => {
    const f = fixture({ faults: { [operation]: ['request_timeout', 'generation_connection_unknown'] } });
    if (operation === 'get') {
      const submit = f.options.host.submit;
      f.options.host = { ...f.options.host, async submit(value) {
        const job = await submit(value); return { ...job, state: 'running' };
      } };
    }
    const job = await runCanvasImageTask(f.options);
    assert.equal(job.applied, true);
    assert.equal(f.applications, 1);
    assert.equal(f.records.length, 1);
    assert.equal(f.commands.filter(value => value.operation === 'submit').length, 1);
    assert.deepEqual(f.waits, [1000, 2000]);
    assert.equal(new Set(f.commands.map(value => value.id || value.task.id)).size, 1);
  });
}
test('提交ACK超时后自动查询原任务，不重发收费请求', async () => {
  const f = fixture({ faults: { submit: ['lost_ack'], get: ['request_timeout'] } });
  const job = await runCanvasImageTask(f.options);
  assert.equal(job.applied, true);
  assert.equal(f.commands.filter(value => value.operation === 'submit').length, 1);
  assert.equal(f.commands.filter(value => value.operation === 'get').length, 2);
});
for (const operation of ['checkpoint', 'applied']) test(`${operation}遇到自动保存造成的过期检查点只刷新证明，不重新应用或提交`, async () => {
  const f = fixture({ faults: { [operation]: [operation === 'checkpoint' ? 'generation_canvas_unsaved' : 'generation_canvas_unconfirmed'] } });
  assert.equal((await runCanvasImageTask(f.options)).applied, true);
  assert.equal(f.applications, 1);
  assert.equal(f.commands.filter(value => value.operation === 'submit').length, 1);
  assert.equal(f.commands.filter(value => value.operation === 'checkpoint').length, 2);
});
test('继续保存确认发生超时或applied回执丢失时自动恢复，不下载响应、不新建模型请求', async () => {
  const f = fixture({ faults: { get: ['request_timeout'], applied: ['lost_ack'] } });
  await runCanvasImageTask({ ...f.options, deferConfirm: () => true });
  const before = f.commands.length, task = f.records[0], job = f.jobs.get(task.taskId);
  assert.equal((await f.options.host.confirmSaved({ id: task.taskId, productId: 'product-A', nodeId: 'node-A' },
    { responseHash: job.result.id, retryWait: async () => {} })).applied, true);
  assert.ok(f.commands.slice(before).every(value => ['get', 'checkpoint', 'applied'].includes(value.operation)));
  assert.equal(f.applications, 1);
});
test('仅查询恢复即使原任务已applied且retry为true也绝不创建另一笔收费请求', async () => {
  const f = fixture(); await runCanvasImageTask(f.options);
  const before = f.commands.length;
  await runCanvasImageTask({ ...f.options, previous: f.records[0], recoverOnly: true, retry: true,
    prepare: () => assert.fail('查询不能准备新请求'), bind: () => assert.fail('查询不能绑定新请求'),
    applyAndSave: async () => ({ rootRevision: 1, rootHash: 'b'.repeat(64) }) });
  assert.ok(!f.commands.slice(before).some(value => ['submit', 'bind', 'retire-prepared'].includes(value.operation)));
});
test('原任务记录缺失或本机尚未找到时，仅查询恢复拒绝补交，也不收口为新任务', async () => {
  const f = fixture();
  await assert.rejects(runCanvasImageTask({ ...f.options, recoverOnly: true }), { code: 'generation_recovery_missing' });
  await runCanvasImageTask({ ...f.options, deferConfirm: () => true });
  await assert.rejects(runCanvasImageTask({ ...f.options, previous: f.records[0], recoverOnly: true, retry: true,
    host: { ...f.options.host, get: async () => { throw new StorageError('generation_not_found', 'missing', 404); },
      retirePreparedTask: () => assert.fail('查询不能收口任务') },
    prepare: () => assert.fail('查询不能准备新请求') }), { code: 'generation_recovery_missing' });
  assert.equal(f.commands.filter(value => value.operation === 'submit').length, 1);
});
test('停止查询只停止等待，不取消原模型任务，也不补交请求', async () => {
  const f = fixture(); await runCanvasImageTask({ ...f.options, deferConfirm: () => true });
  const controller = new AbortController(), waiting = deferred(), release = deferred();
  const flight = runCanvasImageTask({ ...f.options, previous: f.records[0], recoverOnly: true, signal: controller.signal,
    host: { ...f.options.host, get: async id => ({ ...await f.options.host.get(id), state: 'running' }),
      cancel: () => assert.fail('停止查询不能取消原任务') },
    wait: async () => { waiting.resolve(); await release.promise; } });
  await waiting.promise; controller.abort(); release.resolve();
  await assert.rejects(flight, { name: 'AbortError' });
  assert.equal(f.commands.filter(value => value.operation === 'submit').length, 1);
  assert.equal(f.jobs.get(f.records[0].taskId).state, 'succeeded');
});
test('确认ACK丢失后重复确认，不重复保存或添加图片', async () => {
  const f = fixture({ faults: { applied: ['lost_ack'] } });
  assert.equal((await runCanvasImageTask(f.options)).applied, true);
  assert.equal(f.applications, 1);
  assert.equal(f.commands.filter(value => value.operation === 'applied').length, 2);
});
test('恢复已有任务时查询超时也自动继续，不重新准备或提交', async () => {
  const f = fixture();
  await runCanvasImageTask({ ...f.options, deferConfirm: () => true });
  const before = f.commands.length, get = f.options.host.get;
  let unavailable = true;
  const job = await runCanvasImageTask({ ...f.options, previous: f.records[0],
    host: { ...f.options.host, async get(id) {
      if (unavailable) { unavailable = false; throw error('request_timeout'); }
      return get(id);
    } },
    prepare: async () => assert.fail('不可重新准备'), bind: async () => assert.fail('不可重新绑定'),
    applyAndSave: async () => {},
  });
  assert.equal(job.applied, true);
  assert.equal(f.commands.slice(before).some(value => value.operation === 'submit'), false);
});
test('收到明确的上游400失败才结束任务，不自动重提', async () => {
  const f = fixture({ state: 'failed' });
  await assert.rejects(runCanvasImageTask(f.options), { code: 'generation_failed' });
  assert.equal(f.applications, 0);
  assert.deepEqual(f.commands.map(command => command.operation), ['submit', 'result']);
});
test('业务错误、归属错误及响应损坏不作为连接故障重试', async () => {
  for (const code of ['generation_scope_mismatch', 'generation_result_invalid', 'generation_not_found', 'generation_ack_invalid']) {
    let calls = 0;
    await assert.rejects(recoverGenerationResponse(async () => { calls++; throw new StorageError(code, '合成业务错误', 409); },
      { wait: async () => assert.fail('不重试业务错误') }), { code });
    assert.equal(calls, 1);
  }
});
test('持续断连使用有上限的退避间隔，取消后停止查询且不重发任务', async () => {
  const controller = new AbortController(), waits = [];
  let queries = 0;
  await assert.rejects(recoverGenerationResponse(async () => { queries++; throw error('request_timeout'); },
    { signal: controller.signal, wait: async milliseconds => {
      waits.push(milliseconds); if (waits.length === 7) controller.abort();
    } }), { name: 'AbortError' });
  assert.equal(queries, 7);
  assert.deepEqual(waits, [1000, 2000, 4000, 8000, 10000, 10000, 10000]);
});
test('取消能中断正在等待的查询，迟到成功响应不再应用', async () => {
  const f = fixture(), gate = deferred(), controller = new AbortController(), started = deferred();
  const flight = runCanvasImageTask({ ...f.options, signal: controller.signal,
    host: { ...f.options.host, async submit(value) {
      const job = await f.options.host.submit(value); return { ...job, state: 'running' };
    }, async get(id) { started.resolve(); await gate.promise; return f.options.host.get(id); } },
  });
  await started.promise; controller.abort();
  await assert.rejects(flight, { name: 'AbortError' });
  gate.resolve(); await nextTurn();
  assert.equal(f.applications, 0);
  assert.equal(f.commands.filter(value => value.operation === 'submit').length, 1);
});
test('一个任务取图断连不会阻塞同产品其他图片保存', async () => {
  const slow = fixture({ faults: { result: ['request_timeout'] } }), fast = fixture(), gate = deferred(), waiting = deferred();
  const first = runCanvasImageTask({ ...slow.options, retryWait: async () => { waiting.resolve(); await gate.promise; } });
  try {
    await waiting.promise;
    assert.equal((await runCanvasImageTask({ ...fast.options, scope: { ...fast.options.scope, slotId: 'image-B' } })).applied, true);
  } finally { gate.resolve(); await first; }
});

test('上游仍在等待时，本机get立即返回running，不等待上游响应', async () => {
  const gate = deferred(), started = deferred();
  const f = await generationFixture({ beforeReply: async () => { started.resolve(); await gate.promise; } });
  try {
    const { binding } = await f.bind(), input = f.submit(binding);
    await f.tasks.submit(input); await started.promise;
    const start = performance.now(), job = f.tasks.get(input.id);
    assert.equal(job.state, 'running');
    assert.equal(job.result, null);
    assert.ok(performance.now() - start < 1000);
    assert.equal(f.requests.length, 1);
  } finally { gate.resolve(); await f.close(); }
});

test('71张真实SQLite任务并行：查询取图断线自动恢复，69张成功、2张上游400，不重复收费请求', async () => {
  const f = await generationFixture({ respond: async (_req, res, request) => {
    const { index } = JSON.parse(request.bytes);
    res.writeHead(index < 2 ? 400 : 200, { 'content-type': 'application/json' });
    res.end(index < 2 ? '{"error":{"message":"synthetic safety rejection"}}' : JSON.stringify({ data: [{ b64_json: Buffer.from('synthetic-image-' + index).toString('base64') }] }));
  } });
  try {
    const { binding } = await f.bind(), counts = new Map(), checkpoints = new Map(), applied = new Set(), records = new Map();
    const host = createGenerationClient({ command: async value => {
      const id = value.id || value.task?.id, key = value.operation + ':' + id, count = (counts.get(key) || 0) + 1;
      counts.set(key, count);
      if (['get', 'result', 'checkpoint', 'applied'].includes(value.operation) && count === 1) throw error('request_timeout');
      let result;
      if (value.operation === 'submit') result = await f.tasks.submit(value.task);
      else if (value.operation === 'get') result = f.tasks.get(id);
      else if (value.operation === 'result') { result = f.tasks.result(id); result.bytes = result.bytes.toString('base64'); }
      else if (value.operation === 'checkpoint') result = checkpoints.get(id);
      else if (value.operation === 'applied') result = await f.tasks.confirmApplied(id, value.checkpoint);
      else assert.fail('意外操作：' + value.operation);
      return { protocol: GENERATION_PROTOCOL, result };
    } });
    const outcomes = await Promise.allSettled(Array.from({ length: 71 }, (_, index) => runCanvasImageTask({
      host, scope: { productId: 'product-A', nodeId: 'node-' + index, slotId: 'slot-' + index },
      bind: async () => binding, prepare: async () => ({ ...request, body: Buffer.from(JSON.stringify({ index })).toString('base64') }),
      recordTask: async record => { records.set(record.taskId, record); },
      applyAndSave: async job => {
        assert.equal(applied.has(job.id), false); applied.add(job.id);
        const before = f.workspace.readDocument('canvas', job.productId);
        const nodes = [...(before?.value.nodes || []), { id: job.nodeId, type: 'image', position: { x: index * 10, y: 0 },
          metadata: { generationTaskId: job.id, storageKey: 'media:' + job.result.id } }];
        const ack = f.workspace.writeDocument({ collection: 'canvas', id: job.productId,
          value: { id: job.productId, title: '合成批量产品', nodes, connections: [] },
          mediaIds: [...new Set(nodes.map(node => node.metadata.storageKey.slice(6)))],
          expectedRevision: before?.revision || 0, operationId: randomUUID() });
        checkpoints.set(job.id, { productId: job.productId, revision: ack.revision, hash: ack.hash });
      },
      wait: nextTurn, retryWait: nextTurn,
    })));
    assert.equal(outcomes.filter(value => value.status === 'fulfilled' && value.value.applied).length, 69);
    assert.equal(outcomes.filter(value => value.status === 'rejected' && value.reason.code === 'generation_failed').length, 2);
    assert.equal(f.requests.length, 71);
    assert.equal(applied.size, 69);
    assert.equal(records.size, 71);
    assert.equal(f.workspace.readDocument('canvas', 'product-A').value.nodes.length, 69);
    assert.ok([...counts].filter(([key]) => key.startsWith('submit:')).every(([, count]) => count === 1));
  } finally { await f.close(); }
});
