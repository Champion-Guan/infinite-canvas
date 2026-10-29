import { createHash, randomUUID } from 'node:crypto';
import { requireValue, validHash, validId } from '../本机存储/协议.mjs';
import { GENERATION_PROTOCOL, TASK_STATES, terminalState, validateSubmission, jobLike, exactKeys, bindingLike } from '../生成网关/生成协议.mjs';
import { recordNoResultResolution } from './未决任务核实.mjs';
import { createTransientTextProgress } from './文本临时进度.mjs';
import { createPreparedTaskRetirement } from './未提交任务重试收口.mjs';
import { failNoResultTasks, noResultTaskFailure } from './无结果任务收口.mjs';

const ledgerId = 'guan-generation-ledger-v1', format = 'guan-generation-ledger.v1';
const hash = value => createHash('sha256').update(value).digest('hex');
const publicJob = job => ({ id: job.id, productId: job.productId, nodeId: job.nodeId, state: job.state, applied: job.applied, createdAt: job.createdAt, updatedAt: job.updatedAt,
  result: job.result && { ...job.result }, reason: job.reason });

export function validateGenerationLedgerDocument(doc, { workspaceId, maxTasks = 256 } = {}) {
  if (!doc) return { revision: 0, jobs: [], mediaIds: [] };
  requireValue(doc.workspaceId === workspaceId && exactKeys(doc.value, ['format', 'workspaceId', 'jobs']) && doc.value.format === format && doc.value.workspaceId === workspaceId && Array.isArray(doc.value.jobs) && doc.value.jobs.length <= maxTasks,
    'generation_ledger_invalid', '任务账本不完整，未当作空账本。', 409);
  const ids = new Set(), refs = new Set();
  for (const job of doc.value.jobs) {
    requireValue(exactKeys(job, ['id', 'productId', 'nodeId', 'binding', 'requestHash', 'state', 'applied', 'createdAt', 'updatedAt', 'result', 'reason']) &&
      jobLike(job.id) && !ids.has(job.id) && validId(job.productId) && validId(job.nodeId) && bindingLike(job.binding) && validHash(job.requestHash) && TASK_STATES.includes(job.state) && typeof job.applied === 'boolean' &&
      Number.isSafeInteger(job.createdAt) && job.createdAt >= 0 && Number.isSafeInteger(job.updatedAt) && job.updatedAt >= job.createdAt && typeof job.reason === 'string' && /^[a-z_]{0,64}$/.test(job.reason) &&
      (!job.applied || job.state === 'succeeded') && (job.result === null || exactKeys(job.result, ['id', 'status', 'contentType', 'size']) && validHash(job.result.id) &&
        Number.isInteger(job.result.status) && job.result.status >= 200 && job.result.status <= 599 && typeof job.result.contentType === 'string' && job.result.contentType.length <= 256 && !/[\r\n\0]/.test(job.result.contentType) &&
        Number.isSafeInteger(job.result.size) && job.result.size > 0 && job.result.size <= 32 * 1024 * 1024) &&
      (!['succeeded', 'failed'].includes(job.state) || job.result && (job.state === 'succeeded' ? job.result.status < 300 : job.result.status >= 400) ||
        job.state === 'failed' && job.result === null && ['upstream_result_missing', 'interrupted_before_dispatch'].includes(job.reason)), 'generation_ledger_invalid', '任务记录不完整或状态冲突。', 409);
    ids.add(job.id); if (job.result) refs.add(job.result.id);
  }
  requireValue([...refs].sort().join(',') === [...doc.mediaIds].sort().join(','), 'generation_ledger_invalid', '任务结果媒体引用不完整。', 409);
  return { revision: doc.revision, jobs: doc.value.jobs, mediaIds: doc.mediaIds };
}

// 请求正文只在进程内使用；账本只存摘要、归属、状态和已消毒响应的媒体引用。
// running提交后才允许发出请求。重启不重发，succeeded不等于画布已保存。
export async function openGenerationTasks({ workspace, gateway, coordinator, verifyApplied, maxTasks = 256, maxConcurrent = 4, now = Date.now } = {}) {
  requireValue(workspace?.workspaceId && typeof workspace.writeMedia === 'function' && typeof workspace.readMedia === 'function' &&
    typeof gateway?.validate === 'function' && typeof gateway.execute === 'function' && typeof coordinator?.runWrite === 'function' &&
    typeof verifyApplied === 'function' && Number.isInteger(maxTasks) && maxTasks > 0 && maxTasks <= 512 && Number.isInteger(maxConcurrent) && maxConcurrent > 0 && maxConcurrent <= 8 && typeof now === 'function',
  'invalid_generation_service', '生成任务必须显式接入同一工作区、网关、写入协调和画布保存核验。');
  let closed = false, tail = Promise.resolve();
  const active = new Map(), pendingResults = new Map();
  const textProgress = createTransientTextProgress();
  function clock() { const value = now(); requireValue(Number.isSafeInteger(value) && value >= 0, 'invalid_generation_clock', '任务时钟无效。'); return value; }
  function ledger() {
    return validateGenerationLedgerDocument(workspace.readDocument('extension', ledgerId), { workspaceId: workspace.workspaceId, maxTasks });
  }
  async function mutate(operation) {
    const task = tail.then(() => coordinator.runWrite(() => {
      const before = ledger(), jobs = structuredClone(before.jobs), result = operation(jobs);
      const value = { format, workspaceId: workspace.workspaceId, jobs }, operationId = randomUUID(), expectedHash = hash(JSON.stringify(value));
      try {
        const ack = workspace.writeDocument({ collection: 'extension', id: ledgerId, value, expectedRevision: before.revision, operationId, mediaIds: [...new Set(jobs.flatMap(job => job.result ? [job.result.id] : []))].sort() });
        requireValue(ack.persisted === true && ack.workspaceId === workspace.workspaceId && ack.collection === 'extension' && ack.id === ledgerId && ack.operationId === operationId && ack.revision === before.revision + 1 && ack.hash === expectedHash,
          'generation_save_unconfirmed', '任务状态保存未确认，不会重新发送上游请求。', 503);
      } catch (error) {
        // 同步SQLite已提交但调用方丢ACK时，按精确后态核对，不新增请求或覆盖别人的更新。
        const saved = workspace.readDocument('extension', ledgerId);
        if (saved?.revision !== before.revision + 1 || saved.hash !== expectedHash) throw error;
      }
      return result;
    }));
    tail = task.catch(() => {}); return task;
  }
  const find = (jobs, id) => { const job = jobs.find(item => item.id === id); requireValue(job, 'generation_not_found', '生成任务不存在。', 404); return job; };
  function read(id) { requireValue(jobLike(id), 'invalid_generation', '任务ID无效。'); return find(ledger().jobs, id); }
  // 没有收到结果的图片任务直接失败，绝不重发；保存回执未确认仍保持独立保护状态。
  const previous = ledger();
  if (previous.jobs.some(job => noResultTaskFailure(job))) await mutate(jobs => failNoResultTasks(jobs, clock()));
  async function persistResult(id) {
    const result = pendingResults.get(id);
    requireValue(result, 'generation_result_unavailable', '本进程没有可重试保存的结果；不会重新请求上游。', 409);
    const media = await coordinator.runWrite(() => workspace.writeMedia(result.bytes, 'application/octet-stream'));
    requireValue(media.id === hash(result.bytes) && media.size === result.bytes.length, 'generation_result_invalid', '任务结果落盘核验未通过。', 503);
    await mutate(jobs => {
      const job = find(jobs, id);
      requireValue(job.state === 'running' || job.state === 'uncertain' && job.reason === 'result_save_unconfirmed', 'generation_state_conflict', '任务状态已变化，没有覆盖。', 409);
      job.result = { id: media.id, status: result.status, contentType: result.contentType, size: media.size };
      job.state = result.status >= 200 && result.status < 300 ? 'succeeded' : 'failed'; job.reason = job.state === 'failed' ? 'upstream_http_error' : ''; job.updatedAt = Math.max(clock(), job.updatedAt);
    });
    pendingResults.delete(id); return publicJob(read(id));
  }
  async function run(input, controller) {
    let dispatched = false;
    try {
      await mutate(jobs => { const job = find(jobs, input.id); requireValue(job.state === 'accepted', 'generation_state_conflict', '任务不能重复执行。', 409); job.state = 'running'; job.updatedAt = Math.max(clock(), job.updatedAt); });
      requireValue(!controller.signal.aborted, 'generation_not_dispatched', '任务在发出前已取消。', 409);
      dispatched = true;
      const result = await gateway.execute(input.binding, input.request, { signal: controller.signal, taskId: input.id,
        onText: text => textProgress.update(input.id, text),
      });
      // 零长度响应也保留可校验内容，不把没有结果当作成功。
      requireValue(Buffer.isBuffer(result.bytes) && result.bytes.length > 0, 'generation_empty_response', '上游没有可保存的结果。', 502);
      pendingResults.set(input.id, result); await persistResult(input.id);
    } catch {
      try { await mutate(jobs => { const job = find(jobs, input.id); if (!terminalState(job.state)) {
        job.state = pendingResults.has(input.id) ? 'uncertain' : 'failed';
        job.reason = pendingResults.has(input.id) ? 'result_save_unconfirmed' : dispatched ? 'upstream_result_missing' : 'interrupted_before_dispatch';
        job.updatedAt = Math.max(clock(), job.updatedAt);
      } }); }
      catch { /* 保留旧running记录；冷重开必须待核实，不能伪造失败或重发。 */ }
    } finally { active.delete(input.id); textProgress.clear(input.id); }
  }
  return Object.freeze({
    retirePreparedTask: createPreparedTaskRetirement({ mutate, active, pendingResults, workspace, clock, isClosed: () => closed, maxTasks, publicJob }),
    async submit(value) {
      requireValue(!closed, 'generation_closed', '任务入口已关闭。', 503);
      const input = structuredClone(validateSubmission(value)); gateway.validate(input.binding, input.request);
      const requestHash = hash(JSON.stringify(input)), existing = ledger().jobs.find(job => job.id === input.id);
      if (existing) { requireValue(existing.requestHash === requestHash, 'generation_id_conflict', '任务ID已用于不同请求。', 409); return publicJob(existing); }
      const inflight = active.get(input.id);
      if (inflight) {
        requireValue(inflight.requestHash === requestHash, 'generation_id_conflict', '任务ID已用于不同请求。', 409);
        await inflight.admitted; return publicJob(read(input.id));
      }
      requireValue(active.size < maxConcurrent && pendingResults.size < maxConcurrent, 'generation_busy', '任务容量已满，请稍后重试相同任务ID。', 429);
      // 在第一个await前占位，避免并发submit越过容量限制或同ID重复调度。
      const controller = new AbortController(); let accepted, rejected;
      const admitted = new Promise((resolve, reject) => { accepted = resolve; rejected = reject; }); admitted.catch(() => {});
      active.set(input.id, { controller, done: null, admitted, requestHash });
      try {
        const job = await mutate(jobs => {
          requireValue(!jobs.some(job => job.id === input.id) && jobs.length < maxTasks, 'generation_capacity', '任务账本已满或ID正在提交，未发送上游请求。', 409);
          const time = clock(), job = { id: input.id, productId: input.productId, nodeId: input.nodeId, binding: input.binding, requestHash, state: 'accepted', applied: false, createdAt: time, updatedAt: time, result: null, reason: '' };
          jobs.push(job); return publicJob(job);
        });
        const entry = active.get(input.id); entry.done = run(input, controller); accepted(); return job;
      } catch (error) { active.delete(input.id); rejected(error); throw error; }
    },
    get(id) { return publicJob(read(id)); },
    textProgress(id) { return { job: publicJob(read(id)), progress: textProgress.read(id) }; },
    waitTextProgress(id, revision, signal) { read(id); return textProgress.wait(id, revision, signal, 1000); },
    list(productId) { return ledger().jobs.filter(job => job.productId === productId).map(publicJob); },
    result(id) {
      const job = read(id); requireValue(job.result && ['succeeded', 'failed'].includes(job.state), 'generation_result_unavailable', '任务结果尚未持久保存。', 409);
      const saved = workspace.readMedia(job.result.id);
      requireValue(saved.bytes.length === job.result.size && hash(saved.bytes) === job.result.id, 'generation_result_invalid', '任务结果损坏，未交付。', 409);
      return { ...publicJob(job), bytes: Buffer.from(saved.bytes) };
    },
    async confirmApplied(id, checkpoint) {
      const job = read(id);
      requireValue(job.state === 'succeeded', 'generation_not_successful', '上游尚无成功结果，不能确认画布完成。', 409);
      if (job.applied) return publicJob(job);
      const media = workspace.readMedia(job.result.id);
      requireValue(media.bytes.length === job.result.size && hash(media.bytes) === job.result.id, 'generation_result_invalid', '任务结果损坏，不能确认保存完成。', 409);
      // 此回调只能由可信装配方提供；不能接受浏览器一句saved:true。
      requireValue(await verifyApplied(Object.freeze(publicJob(job)), structuredClone(checkpoint)) === true, 'generation_canvas_unconfirmed', '原产品画布尚未核验保存，任务结果保留。', 409);
      await mutate(jobs => { const current = find(jobs, id); requireValue(current.state === 'succeeded' && current.result.id === job.result.id, 'generation_state_conflict', '任务结果已变化。', 409); current.applied = true; current.updatedAt = Math.max(clock(), current.updatedAt); });
      return publicJob(read(id));
    },
    retryResultSave: persistResult,
    updateBlockers() {
      return ledger().jobs.filter(job => !(['failed', 'cancelled'].includes(job.state) || job.state === 'succeeded' && job.applied))
        .map(job => ({ id: job.id, state: job.state, reason: job.reason, createdAt: job.createdAt,
          canConfirmNoResult: !closed && !active.has(job.id) && !pendingResults.has(job.id) && job.state === 'uncertain' && job.result === null && job.reason === 'upstream_result_unknown' }));
    },
    async confirmNoResult(id, acknowledgement) {
      requireValue(!closed && jobLike(id), 'generation_resolution_denied', '任务入口已关闭或任务ID无效。', 409);
      await mutate(jobs => {
        requireValue(!active.has(id) && !pendingResults.has(id), 'generation_resolution_denied', '任务仍在运行或存在待保存结果，不能人工收口。', 409);
        const job = find(jobs, id), receipt = recordNoResultResolution(workspace, job, acknowledgement, clock());
        job.state = 'cancelled'; job.reason = 'operator_confirmed_no_result'; job.updatedAt = Math.max(receipt.confirmedAt, job.updatedAt);
      });
      return publicJob(read(id));
    },
    async cancel(id) {
      const job = read(id), entry = active.get(id);
      if (entry) { entry.controller.abort(); await entry.admitted; await entry.done; }
      return publicJob(read(job.id)); // 已发出的取消不冒充远端已结束。
    },
    async drain() { await Promise.all([...active.values()].map(async entry => { await entry.admitted; await entry.done; })); await tail; },
    assertCanUpdate() {
      const jobs = ledger().jobs;
      requireValue(active.size === 0 && pendingResults.size === 0 && jobs.every(job => ['failed', 'cancelled'].includes(job.state) || job.state === 'succeeded' && job.applied),
        'install_tasks_pending', '存在未决生成或未核验保存的结果，不能更新。', 409);
    },
    getStatus: () => ({ closed, running: active.size, unpersistedResults: pendingResults.size }),
    async close() { requireValue(active.size === 0 && pendingResults.size === 0, 'generation_busy', '仍有生成或未确认结果，不能正常关闭。', 409); closed = true; await tail; },
    protocol: GENERATION_PROTOCOL,
  });
}
