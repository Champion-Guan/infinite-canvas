import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { openGenerationTasks } from '../扩展功能/生成任务/SQLite生成任务.mjs';
import { prepareLegacyCompatibleTaskLedger } from '../扩展功能/客户安装/旧版升级任务兼容.mjs';
import { generationFixture } from './生成网关隔离夹具.mjs';

function makeBeta17Uncertain(workspace) {
  const document = workspace.readDocument('extension', 'guan-generation-ledger-v1');
  const jobs = document.value.jobs.map(job => ({ ...job, state: 'uncertain', reason: 'upstream_result_unknown' }));
  return workspace.writeDocument({ collection: 'extension', id: document.id, value: { ...document.value, jobs },
    expectedRevision: document.revision, operationId: randomUUID(), mediaIds: document.mediaIds });
}

test('13条无结果图片任务按beta.17可读的兼容终态落盘，beta.19冷启动后显示失败且不重发', async () => {
  const f = await generationFixture();
  let reopened;
  try {
    const binding = await f.bind(); f.reply.disconnect = true;
    const ids = [];
    for (let index = 0; index < 13; index++) {
      const input = f.submit(binding.binding, { nodeId: 'result-' + index });
      ids.push(input.id); await f.tasks.submit(input); await f.tasks.drain();
    }
    await f.tasks.close();
    makeBeta17Uncertain(f.workspace);
    const revisionBeforeCompatibility = f.workspace.readDocument('extension', 'guan-generation-ledger-v1').revision;
    const countBefore = f.requests.length;
    const result = await prepareLegacyCompatibleTaskLedger({ workspace: f.workspace, coordinator: f.coordinator });
    assert.deepEqual(result, { converted: 13, remainingImageBlockers: 0 });
    const legacyReadable = f.workspace.readDocument('extension', 'guan-generation-ledger-v1');
    assert.ok(ids.every(id => legacyReadable.value.jobs.find(job => job.id === id)?.state === 'cancelled'));
    assert.ok(legacyReadable.value.jobs.every(job => ['failed', 'cancelled'].includes(job.state) || job.state === 'succeeded' && job.applied));
    assert.equal(legacyReadable.revision, revisionBeforeCompatibility + 1);

    reopened = await openGenerationTasks({ workspace: f.workspace, gateway: f.gateway, coordinator: f.coordinator, verifyApplied: f.verifyApplied });
    for (const id of ids) {
      assert.equal(reopened.get(id).state, 'failed');
      assert.equal(reopened.get(id).reason, 'upstream_result_missing');
    }
    reopened.assertCanUpdate();
    assert.equal(f.requests.length, countBefore);
  } finally {
    await reopened?.close();
    await f.close();
  }
});

test('保存未确认和未知原因保持未决，兼容步骤不伪造终态', async () => {
  const f = await generationFixture();
  let reopened;
  try {
    const binding = await f.bind(), input = f.submit(binding.binding);
    f.reply.disconnect = true; await f.tasks.submit(input); await f.tasks.drain(); await f.tasks.close();
    makeBeta17Uncertain(f.workspace);
    const document = f.workspace.readDocument('extension', 'guan-generation-ledger-v1');
    const jobs = [
      { ...document.value.jobs[0], state: 'uncertain', result: null, reason: 'upstream_result_unknown' },
      { ...document.value.jobs[0], id: randomUUID(), state: 'uncertain', result: null, reason: 'result_save_unconfirmed' },
      { ...document.value.jobs[0], id: randomUUID(), state: 'uncertain', result: null, reason: 'future_unknown_reason' },
    ];
    f.workspace.writeDocument({ collection: 'extension', id: document.id, value: { ...document.value, jobs }, expectedRevision: document.revision,
      operationId: randomUUID(), mediaIds: [] });

    const result = await prepareLegacyCompatibleTaskLedger({ workspace: f.workspace, coordinator: f.coordinator });
    assert.deepEqual(result, { converted: 1, remainingImageBlockers: 2 });
    const interim = f.workspace.readDocument('extension', document.id);
    assert.equal(interim.value.jobs[0].state, 'cancelled');
    assert.equal(interim.value.jobs[1].state, 'uncertain');
    assert.equal(interim.value.jobs[2].state, 'uncertain');

    reopened = await openGenerationTasks({ workspace: f.workspace, gateway: f.gateway, coordinator: f.coordinator, verifyApplied: f.verifyApplied });
    assert.equal(reopened.get(jobs[0].id).state, 'failed');
    assert.equal(reopened.get(jobs[1].id).reason, 'result_save_unconfirmed');
    assert.equal(reopened.get(jobs[2].id).reason, 'future_unknown_reason');
    assert.equal(reopened.updateBlockers().length, 2);
    assert.equal(f.requests.length, 1);
  } finally {
    await reopened?.close();
    await f.close();
  }
});

test('账本写入未确认时不报告兼容完成，也不覆盖原账本', async () => {
  const f = await generationFixture();
  try {
    const binding = await f.bind(), input = f.submit(binding.binding);
    f.reply.disconnect = true; await f.tasks.submit(input); await f.tasks.drain(); await f.tasks.close();
    makeBeta17Uncertain(f.workspace);
    const before = f.workspace.readDocument('extension', 'guan-generation-ledger-v1');
    const failing = { ...f.workspace, writeDocument() { throw Error('synthetic disk full'); } };
    await assert.rejects(prepareLegacyCompatibleTaskLedger({ workspace: failing, coordinator: f.coordinator }));
    const after = f.workspace.readDocument('extension', 'guan-generation-ledger-v1');
    assert.equal(after.revision, before.revision);
    assert.equal(after.value.jobs[0].state, 'uncertain');
  } finally { await f.close(); }
});

test('SQLite已提交但丢失回执时仅凭精确后态确认，不重复提交', async () => {
  const f = await generationFixture();
  try {
    const binding = await f.bind(), input = f.submit(binding.binding);
    f.reply.disconnect = true; await f.tasks.submit(input); await f.tasks.drain(); await f.tasks.close();
    makeBeta17Uncertain(f.workspace);
    let loseAck = true, writes = 0;
    const workspace = { ...f.workspace, writeDocument(value) {
      writes++;
      const ack = f.workspace.writeDocument(value);
      if (loseAck) { loseAck = false; throw Error('synthetic lost ack'); }
      return ack;
    } };
    const result = await prepareLegacyCompatibleTaskLedger({ workspace, coordinator: f.coordinator });
    assert.equal(result.converted, 1);
    assert.equal(writes, 1);
    assert.equal(f.workspace.readDocument('extension', 'guan-generation-ledger-v1').value.jobs[0].state, 'cancelled');
  } finally { await f.close(); }
});
