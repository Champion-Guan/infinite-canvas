import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { generationFixture } from './生成网关隔离夹具.mjs';
import { runCanvasImageTask, imageRequestHash } from '../扩展功能/画布生成/图片任务衔接.mjs';
import { openGenerationTasks } from '../扩展功能/生成任务/SQLite生成任务.mjs';

const code = expected => error => error?.code === expected;
const preparedIdentity = async input => ({ id: input.id, productId: input.productId, nodeId: input.nodeId,
  binding: input.binding, requestHash: await imageRequestHash(input.request) });

test('旧身份没有提交且提示词已改变：显式重试先封存旧ID，再成功生成并保存一次', async () => {
  const f = await generationFixture();
  try {
    const bound = await f.bind(), original = f.submit(bound.binding), previous = await preparedIdentity(original);
    const records = [], checkpoints = new Map();
    const host = {
      get: async id => f.tasks.get(id), retirePreparedTask: value => f.tasks.retirePreparedTask(value),
      submit: value => f.tasks.submit(value), checkpoint: async id => checkpoints.get(id),
      async deliver(task, { applyAndSave }) {
        const saved = f.tasks.result(task.id);
        const checkpoint = await applyAndSave({ ...saved, bytes: saved.bytes.toString('base64') });
        return f.tasks.confirmApplied(task.id, checkpoint);
      },
    };
    const options = { host, scope: { productId: original.productId, nodeId: original.nodeId, slotId: 'image-A' },
      previous: { taskId: original.id, slotId: 'image-A', binding: previous.binding, requestHash: previous.requestHash }, retry: true,
      prepare: async () => ({ ...original.request, body: Buffer.from('{"model":"synthetic","prompt":"修改后的提示词"}').toString('base64') }),
      bind: async () => bound.binding, recordTask: async value => records.push(value),
      applyAndSave: async job => { checkpoints.set(job.id, f.saveCanvas(job)); }, wait: () => f.tasks.drain(),
    };
    assert.equal((await runCanvasImageTask(options)).applied, true);
    assert.equal(f.tasks.get(original.id).reason, 'replaced_before_dispatch');
    assert.equal(f.tasks.get(original.id).state, 'cancelled');
    assert.notEqual(records[0].taskId, original.id); assert.equal(f.requests.length, 1);
    // 模拟另一旧页面仍持有相同旧身份；共用同一后继ID，不再收费生成一次。
    await runCanvasImageTask(options);
    assert.equal(records[1].taskId, records[0].taskId); assert.equal(f.requests.length, 1);
    await assert.rejects(f.tasks.submit(original), code('generation_id_conflict'));
    assert.equal(f.requests.length, 1);
  } finally { await f.close(); }
});

test('封存身份可幂等重复并跨服务重开保留，旧页面迟到提交仍被拦截', async () => {
  const f = await generationFixture();
  try {
    const bound = await f.bind(), input = f.submit(bound.binding), previous = await preparedIdentity(input);
    const first = await f.tasks.retirePreparedTask(previous);
    assert.deepEqual(await f.tasks.retirePreparedTask(previous), first);
    assert.equal(f.requests.length, 0);
    await f.tasks.close();
    const reopened = await openGenerationTasks({ workspace: f.workspace, gateway: f.gateway, coordinator: f.coordinator, verifyApplied: f.verifyApplied });
    try {
      assert.equal(reopened.get(input.id).reason, 'replaced_before_dispatch');
      await assert.rejects(reopened.submit(input), code('generation_id_conflict'));
      assert.equal(f.requests.length, 0);
    } finally { await reopened.close(); }
  } finally { await f.close(); }
});

test('提交与旧身份收口并发时，以服务端已存在的任务为准，不能取消或重发', async () => {
  const f = await generationFixture();
  try {
    const bound = await f.bind(), input = f.submit(bound.binding), previous = await preparedIdentity(input);
    const [, restored] = await Promise.all([f.tasks.submit(input), f.tasks.retirePreparedTask(previous)]);
    assert.notEqual(restored.reason, 'replaced_before_dispatch');
    await f.tasks.drain(); assert.equal(f.tasks.get(input.id).state, 'succeeded'); assert.equal(f.requests.length, 1);
  } finally { await f.close(); }
});

test('待核实的真实在途任务保持原状；显式重试也不能用新请求覆盖', async () => {
  const f = await generationFixture();
  try {
    const bound = await f.bind(), input = f.submit(bound.binding), previous = await preparedIdentity(input);
    f.reply.disconnect = true; await f.tasks.submit(input); await f.tasks.drain();
    const before = f.tasks.get(input.id);
    assert.equal((await f.tasks.retirePreparedTask(previous)).state, 'uncertain');
    await assert.rejects(runCanvasImageTask({
      host: { get: async id => f.tasks.get(id), retirePreparedTask: () => assert.fail('不能封存已存在任务'),
        submit: () => assert.fail('不能重复提交'), deliver() {}, checkpoint() {} },
      scope: { productId: input.productId, nodeId: input.nodeId, slotId: 'one' },
      previous: { taskId: input.id, slotId: 'one', binding: input.binding, requestHash: previous.requestHash }, retry: true,
      prepare: () => assert.fail('不能重新组装'), bind() {}, recordTask() {}, applyAndSave() {},
    }), code('generation_result_unknown'));
    assert.deepEqual(f.tasks.get(input.id), before); assert.equal(f.requests.length, 1);
  } finally { await f.close(); }
});

test('账本缺失但存在执行痕迹时拒绝封存，不把缺失误当成未发送', async () => {
  const f = await generationFixture();
  try {
    const bound = await f.bind(), input = f.submit(bound.binding), previous = await preparedIdentity(input);
    f.workspace.writeDocument({ collection: 'extension', id: 'guan-fallback-attempt:' + input.id,
      value: { phase: 'dispatching' }, expectedRevision: 0, operationId: randomUUID() });
    await assert.rejects(f.tasks.retirePreparedTask(previous), code('generation_admission_pending'));
    assert.throws(() => f.tasks.get(input.id), code('generation_not_found')); assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});

test('拒绝跨产品身份及无效字段，满账本不新增封存记录', async () => {
  const f = await generationFixture({ maxTasks: 2 });
  try {
    const bound = await f.bind(), input = f.submit(bound.binding), previous = await preparedIdentity(input);
    await f.tasks.retirePreparedTask(previous);
    await assert.rejects(f.tasks.retirePreparedTask({ ...previous, productId: 'another-product' }), code('generation_scope_mismatch'));
    await assert.rejects(f.tasks.retirePreparedTask({ ...previous, extra: true }), code('invalid_canvas_task'));
    const next = f.submit(bound.binding);
    await assert.rejects(f.tasks.retirePreparedTask(await preparedIdentity(next)), code('generation_capacity'));
    assert.equal(f.tasks.list(input.productId).length, 1); assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});

test('未显式重试仍保留旧请求摘要保护，不能自动换任务ID', async () => {
  const f = await generationFixture();
  try {
    const bound = await f.bind(), input = f.submit(bound.binding);
    await assert.rejects(runCanvasImageTask({
      host: { get: async id => f.tasks.get(id), submit() {}, deliver() {}, checkpoint() {},
        retirePreparedTask: () => assert.fail('没有显式重试不能封存') },
      scope: { productId: input.productId, nodeId: input.nodeId, slotId: 'one' },
      previous: { taskId: input.id, slotId: 'one', binding: input.binding, requestHash: 'c'.repeat(64) },
      prepare: async () => input.request, bind() {}, recordTask() {}, applyAndSave() {},
    }), code('generation_request_changed'));
    assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});
