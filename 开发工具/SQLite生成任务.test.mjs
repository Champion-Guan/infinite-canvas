import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { openGenerationTasks } from '../扩展功能/生成任务/SQLite生成任务.mjs';
import { generationFixture } from './生成网关隔离夹具.mjs';

const code = wanted => error => error?.code === wanted;
test('请求→结果媒体→原产品画布落盘核验→完成，切产品不改归属', async () => {
  const f = await generationFixture();
  try {
    const binding = await f.bind(), input = f.submit(binding.binding);
    assert.equal((await f.tasks.submit(input)).state, 'accepted'); await f.tasks.drain();
    const job = f.tasks.get(input.id); assert.equal(job.state, 'succeeded'); assert.equal(job.applied, false);
    await assert.rejects(f.tasks.confirmApplied(input.id, { productId: 'product-B', saved: true }), code('generation_canvas_unconfirmed'));
    const checkpoint = f.saveCanvas(job), done = await f.tasks.confirmApplied(input.id, checkpoint);
    assert.equal(done.applied, true); assert.equal(done.productId, input.productId); assert.equal(f.workspace.readDocument('canvas', 'product-B'), null);
    assert.deepEqual(await f.tasks.confirmApplied(input.id, checkpoint), done);
  } finally { await f.close(); }
});
test('同ID连续/并发重复提交仅发出一次，相同ID不同正文拒绝', async () => {
  const f = await generationFixture();
  try {
    const b = await f.bind(), input = f.submit(b.binding);
    await Promise.all([f.tasks.submit(input), f.tasks.submit(input), f.tasks.submit(input)]); await f.tasks.drain();
    await f.tasks.submit(input); assert.equal(f.requests.length, 1);
    await assert.rejects(f.tasks.submit({ ...input, request: { ...input.request, body: 'e30=' } }), code('generation_id_conflict'));
  } finally { await f.close(); }
});
test('网络断线保留待核实记录，同ID查询或重提不重复收费请求', async () => {
  const f = await generationFixture();
  try { const b = await f.bind(), input = f.submit(b.binding); f.reply.disconnect = true; await f.tasks.submit(input); await f.tasks.drain(); assert.equal(f.tasks.get(input.id).state, 'uncertain'); await f.tasks.submit(input); assert.equal(f.requests.length, 1); }
  finally { await f.close(); }
});
test('上游HTTP失败保留消毒后的错误响应，不冒充画布保存成功', async () => {
  const f = await generationFixture();
  try { const b = await f.bind(), input = f.submit(b.binding); f.reply.status = 429; await f.tasks.submit(input); await f.tasks.drain(); assert.equal(f.tasks.get(input.id).state, 'failed'); assert.equal(f.tasks.result(input.id).result.status, 429); await assert.rejects(f.tasks.confirmApplied(input.id, {}), code('generation_not_successful')); }
  finally { await f.close(); }
});
test('结果保存失败可只重试本机保存，不重新调用API', async () => {
  let fail = false;
  const f = await generationFixture({ wrapWorkspace: workspace => ({ ...workspace, writeMedia(...args) { if (fail) throw Error('synthetic disk full'); return workspace.writeMedia(...args); } }) });
  try {
    const b = await f.bind(), input = f.submit(b.binding); fail = true;
    await f.tasks.submit(input); await f.tasks.drain(); assert.equal(f.tasks.get(input.id).reason, 'result_save_unconfirmed');
    await assert.rejects(f.tasks.close(), code('generation_busy')); fail = false;
    assert.equal((await f.tasks.retryResultSave(input.id)).state, 'succeeded'); assert.equal(f.requests.length, 1);
  } finally { await f.close(); }
});
test('SQLite已提交后丢ACK按完整后态确认，不重发API', async () => {
  let lose = true;
  const f = await generationFixture({ wrapWorkspace: workspace => ({ ...workspace, writeDocument(value) { const ack = workspace.writeDocument(value); if (lose && value.id === 'guan-generation-ledger-v1') { lose = false; throw Error('synthetic lost ack'); } return ack; } }) });
  try { const b = await f.bind(), input = f.submit(b.binding); await f.tasks.submit(input); await f.tasks.drain(); assert.equal(f.tasks.get(input.id).state, 'succeeded'); assert.equal(f.requests.length, 1); }
  finally { await f.close(); }
});
test('接受任务落盘失败不发出上游请求', async () => {
  let fail = false;
  const f = await generationFixture({ wrapWorkspace: workspace => ({ ...workspace, writeDocument(value) { if (fail && value.id === 'guan-generation-ledger-v1') throw Error('synthetic disk failure'); return workspace.writeDocument(value); } }) });
  try { const b = await f.bind(), input = f.submit(b.binding); fail = true; await assert.rejects(f.tasks.submit(input)); assert.equal(f.requests.length, 0); fail = false; }
  finally { await f.close(); }
});
test('冷重开保留成功结果及画布ACK，不依赖页内状态', async () => {
  const f = await generationFixture();
  try {
    const b = await f.bind(), input = f.submit(b.binding); await f.tasks.submit(input); await f.tasks.drain(); const saved = f.tasks.result(input.id);
    await f.tasks.confirmApplied(input.id, f.saveCanvas(saved)); await f.tasks.close();
    const reopened = await openGenerationTasks({ workspace: f.workspace, gateway: f.gateway, coordinator: f.coordinator, verifyApplied: f.verifyApplied });
    assert.equal(reopened.get(input.id).applied, true); assert.deepEqual(reopened.result(input.id).bytes, saved.bytes); await reopened.submit(input); assert.equal(f.requests.length, 1); await reopened.close();
  } finally { await f.close(); }
});
test('冷启动running转待核实、accepted转未发送中断，绝不自动重发', async () => {
  const f = await generationFixture();
  try {
    const b = await f.bind(), input = f.submit(b.binding); await f.tasks.submit(input); await f.tasks.drain(); await f.tasks.close();
    const doc = f.workspace.readDocument('extension', 'guan-generation-ledger-v1'), jobs = [doc.value.jobs[0], { ...doc.value.jobs[0], id: randomUUID() }];
    jobs[0] = { ...jobs[0], state: 'running', result: null, applied: false }; jobs[1] = { ...jobs[1], state: 'accepted', result: null, applied: false };
    f.workspace.writeDocument({ collection: 'extension', id: doc.id, value: { ...doc.value, jobs }, expectedRevision: doc.revision, operationId: randomUUID() });
    const reopened = await openGenerationTasks({ workspace: f.workspace, gateway: f.gateway, coordinator: f.coordinator, verifyApplied: f.verifyApplied });
    assert.equal(reopened.get(jobs[0].id).state, 'uncertain'); assert.equal(reopened.get(jobs[1].id).state, 'cancelled'); assert.equal(f.requests.length, 1); await reopened.close();
  } finally { await f.close(); }
});
test('账本容量满和正常关闭均安全拒绝新任务', async () => {
  const f = await generationFixture({ maxTasks: 1 });
  try { const b = await f.bind(), input = f.submit(b.binding); await f.tasks.submit(input); await f.tasks.drain(); await assert.rejects(f.tasks.submit(f.submit(b.binding)), code('generation_capacity')); assert.equal(f.requests.length, 1); await f.tasks.close(); await assert.rejects(f.tasks.submit(input), code('generation_closed')); }
  finally { await f.close(); }
});
test('并发容量独立限制，取消已发出请求只能标待核实，不能证明远端停止', async () => {
  let release, seen;
  const blocked = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { seen = resolve; });
  const f = await generationFixture({ maxConcurrent: 1, beforeReply: async () => { seen(); await blocked; } });
  try {
    const b = await f.bind(), input = f.submit(b.binding); await f.tasks.submit(input); await started;
    await assert.rejects(f.tasks.submit(f.submit(b.binding)), code('generation_busy'));
    await assert.rejects(f.tasks.close(), code('generation_busy'));
    assert.equal((await f.tasks.cancel(input.id)).state, 'uncertain'); assert.equal(f.requests.length, 1);
  } finally { release(); await f.close(); }
});

const noResultAck = 'upstream-ended-without-result';
test('人工核实无结果保留原任务和凭据，冷重开不重新请求且允许升级', async () => {
  const f = await generationFixture();
  try {
    const b = await f.bind(), input = f.submit(b.binding); f.reply.disconnect = true;
    await f.tasks.submit(input); await f.tasks.drain();
    assert.throws(() => f.tasks.assertCanUpdate(), code('install_tasks_pending'));
    assert.equal(f.tasks.updateBlockers()[0].canConfirmNoResult, true);
    await assert.rejects(f.tasks.confirmNoResult(input.id, 'saved'), code('generation_confirmation_required'));
    const result = await f.tasks.confirmNoResult(input.id, noResultAck);
    assert.equal(result.state, 'cancelled'); assert.equal(result.reason, 'operator_confirmed_no_result');
    const receipt = f.workspace.readDocument('extension', 'guan-generation-resolution:' + input.id);
    assert.equal(receipt.value.original.state, 'uncertain'); assert.equal(receipt.value.original.result, null);
    assert.equal(receipt.value.basis, noResultAck);
    assert.deepEqual(await f.tasks.confirmNoResult(input.id, noResultAck), result);
    assert.equal(f.workspace.readDocument('extension', receipt.id).revision, 1);
    f.tasks.assertCanUpdate(); await f.tasks.close();
    const reopened = await openGenerationTasks({ workspace: f.workspace, gateway: f.gateway, coordinator: f.coordinator, verifyApplied: f.verifyApplied });
    assert.deepEqual(await reopened.submit(input), result); reopened.assertCanUpdate();
    assert.equal(f.requests.length, 1); await reopened.close();
  } finally { await f.close(); }
});
test('核实凭据或账本保存失败时不放行；保存重试不重发', async () => {
  let failing = '';
  const f = await generationFixture({ wrapWorkspace: workspace => ({ ...workspace, writeDocument(value) {
    if (failing && value.id.startsWith(failing)) throw Error('synthetic full disk');
    return workspace.writeDocument(value);
  } }) });
  try {
    const b = await f.bind(), input = f.submit(b.binding); f.reply.disconnect = true;
    await f.tasks.submit(input); await f.tasks.drain();
    for (const target of ['guan-generation-resolution:', 'guan-generation-ledger-v1']) {
      failing = target; await assert.rejects(f.tasks.confirmNoResult(input.id, noResultAck));
      assert.equal(f.tasks.get(input.id).state, 'uncertain');
      assert.throws(() => f.tasks.assertCanUpdate(), code('install_tasks_pending'));
    }
    failing = ''; await f.tasks.confirmNoResult(input.id, noResultAck); f.tasks.assertCanUpdate();
    assert.equal(f.requests.length, 1);
  } finally { failing = ''; await f.close(); }
});
test('已有结果和待保存结果不能人工标无结果', async () => {
  let failMedia = false;
  const f = await generationFixture({ wrapWorkspace: workspace => ({ ...workspace, writeMedia(...args) {
    if (failMedia) throw Error('synthetic full disk'); return workspace.writeMedia(...args);
  } }) });
  try {
    const b = await f.bind(), success = f.submit(b.binding); await f.tasks.submit(success); await f.tasks.drain();
    await assert.rejects(f.tasks.confirmNoResult(success.id, noResultAck), code('generation_resolution_denied'));
    failMedia = true; const pending = f.submit(b.binding); await f.tasks.submit(pending); await f.tasks.drain();
    await assert.rejects(f.tasks.confirmNoResult(pending.id, noResultAck), code('generation_resolution_denied'));
    failMedia = false; await f.tasks.retryResultSave(pending.id);
  } finally { failMedia = false; await f.close(); }
});
