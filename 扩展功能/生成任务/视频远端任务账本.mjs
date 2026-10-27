import { createHash, randomUUID } from 'node:crypto';
import { requireValue, validId, validUUID } from '../本机存储/协议.mjs';
import { bindingLike, exactKeys, validateSubmission } from '../生成网关/生成协议.mjs';
import { NO_RESULT_ACK } from './未决任务核实.mjs';
import { readRemoteVideoState, downloadRemoteVideo } from './视频渠道读取.mjs';

const ledgerId = 'guan-video-remote-tasks', format = 'guan-video-remote-tasks.v1';
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const terminal = job => ['succeeded', 'failed', 'cancelled'].includes(job.state);
export const validRemoteVideoId = (provider, id) => typeof id === 'string' && id.length <= 512 && (provider === 'openai'
  ? /^[\w-]+$/.test(id) : /^(?:models\/[\w.:-]+\/)?operations\/[\w.-]+$/.test(id));
const scopeLike = value => exactKeys(value, ['id', 'productId', 'nodeId', 'binding', 'provider', 'model']) && validUUID(value.id) &&
  validId(value.productId) && validId(value.nodeId) && bindingLike(value.binding) && ['openai', 'gemini'].includes(value.provider) &&
  typeof value.model === 'string' && value.model.length > 0 && value.model.length <= 512 && !/[\r\n\0]/.test(value.model);
const sameScope = (a, b) => ['productId', 'nodeId', 'binding', 'provider', 'model'].every(key => a[key] === b[key]);

// 只保存身份与状态，不保存提示词、媒体副本或密钥。取消、超时、刷新均不等于渠道已结束。
export function openRemoteVideoLedger({ workspace, coordinator, gateway, verifySaved, maxTasks = 256, now = Date.now }) {
  requireValue(workspace?.workspaceId && coordinator?.runWrite && gateway?.execute && typeof verifySaved === 'function' &&
    Number.isInteger(maxTasks) && maxTasks > 0 && maxTasks <= 512, 'invalid_video_ledger', '视频保护需要原工作区与保存核验。');
  let tail = Promise.resolve(), closed = false;
  const checking = new Set(), dispatching = new Set();
  const clock = () => { const value = now(); requireValue(Number.isSafeInteger(value) && value >= 0, 'invalid_video_clock', '视频时钟无效。'); return value; };
  function ledger() {
    const doc = workspace.readDocument('extension', ledgerId);
    if (!doc) return { revision: 0, jobs: [] };
    requireValue(doc.workspaceId === workspace.workspaceId && doc.value?.format === format && doc.value.workspaceId === workspace.workspaceId &&
      Array.isArray(doc.value.jobs) && doc.value.jobs.length <= maxTasks && doc.mediaIds.length === 0, 'video_ledger_invalid', '视频记录不完整，未按空记录处理。', 409);
    const ids = new Set(), scopes = new Set();
    for (const job of doc.value.jobs) {
      const scope = Object.fromEntries(['id', 'productId', 'nodeId', 'binding', 'provider', 'model'].map(key => [key, job[key]]));
      requireValue(exactKeys(job, [...Object.keys(scope), 'remoteId', 'state', 'reason', 'createdAt', 'updatedAt']) && scopeLike(scope) && !ids.has(job.id) &&
        ['uncertain', 'succeeded', 'failed', 'cancelled'].includes(job.state) && ['upstream_result_unknown', 'remote_task_pending', 'remote_completed', 'remote_failed', 'operator_confirmed_no_result'].includes(job.reason) &&
        (job.remoteId === null || validRemoteVideoId(job.provider, job.remoteId)) && Number.isSafeInteger(job.createdAt) && job.createdAt >= 0 && Number.isSafeInteger(job.updatedAt) && job.updatedAt >= job.createdAt &&
        (job.state === 'uncertain' ? job.reason === (job.remoteId ? 'remote_task_pending' : 'upstream_result_unknown') : job.state === 'succeeded' ? job.remoteId && job.reason === 'remote_completed' : job.state === 'failed' ? job.remoteId && job.reason === 'remote_failed' : job.reason === 'operator_confirmed_no_result'),
      'video_ledger_invalid', '视频记录身份或状态冲突。', 409);
      const scopeKey = JSON.stringify([job.productId, job.nodeId]);
      requireValue(terminal(job) || !scopes.has(scopeKey), 'video_ledger_invalid', '视频节点存在重复未决记录。', 409);
      ids.add(job.id); if (!terminal(job)) scopes.add(scopeKey);
    }
    return { revision: doc.revision, jobs: doc.value.jobs };
  }
  async function mutate(change) {
    requireValue(!closed, 'video_ledger_closed', '视频入口已关闭。', 503);
    const operation = tail.then(() => coordinator.runWrite(() => {
      const before = ledger(), jobs = structuredClone(before.jobs), result = change(jobs);
      // 轮询/重复确认不增加版本或写盘。
      if (JSON.stringify(jobs) === JSON.stringify(before.jobs)) return result;
      const value = { format, workspaceId: workspace.workspaceId, jobs }, hash = digest(value), operationId = randomUUID();
      try {
        const ack = workspace.writeDocument({ collection: 'extension', id: ledgerId, value, expectedRevision: before.revision, operationId, mediaIds: [] });
        requireValue(ack.persisted === true && ack.workspaceId === workspace.workspaceId && ack.id === ledgerId && ack.operationId === operationId && ack.revision === before.revision + 1 && ack.hash === hash,
          'video_save_unconfirmed', '视频保护未确认保存，未发送新请求。', 503);
      } catch (error) {
        const saved = workspace.readDocument('extension', ledgerId);
        if (saved?.revision !== before.revision + 1 || saved.hash !== hash) throw error;
      }
      return structuredClone(result);
    }));
    tail = operation.catch(() => {}); return operation;
  }
  const find = (jobs, id) => { requireValue(validUUID(id), 'invalid_video_task', '视频记录ID无效。'); const job = jobs.find(job => job.id === id); requireValue(job, 'video_task_missing', '原视频保护记录不存在。', 404); return job; };
  function validateScope(scope) {
    requireValue(scopeLike(scope), 'invalid_video_scope', '视频任务归属无效。');
    requireValue(gateway.describe(scope.binding).kind === scope.provider, 'video_binding_mismatch', '视频渠道类型与原绑定不一致。', 409);
  }
  async function admit(scope, remoteId = null) {
    validateScope(scope);
    requireValue(remoteId === null || validRemoteVideoId(scope.provider, remoteId), 'invalid_video_remote_id', '视频任务ID无效。');
    return mutate(jobs => {
      const old = jobs.find(job => job.id === scope.id) || jobs.find(job => !terminal(job) && job.productId === scope.productId && job.nodeId === scope.nodeId);
      if (old) {
        requireValue(sameScope(old, scope) && (!remoteId || old.remoteId === remoteId), 'video_scope_conflict', '原视频任务未决，不能覆盖或重新创建。', 409);
        return { job: old, created: false };
      }
      while (jobs.length >= maxTasks) { const index = jobs.findIndex(terminal); requireValue(index >= 0, 'video_ledger_full', '未决视频记录已满，请先核实原任务。', 409); jobs.splice(index, 1); }
      const time = clock(), job = { ...scope, remoteId, state: 'uncertain', reason: remoteId ? 'remote_task_pending' : 'upstream_result_unknown', createdAt: time, updatedAt: time };
      jobs.push(job); return { job, created: true };
    });
  }
  ledger(); // 启动时校验，损坏不能绕过升级保护。
  async function inspect(id, download = false) {
    requireValue(!closed && !checking.has(id), 'video_check_busy', '原视频正在查询，请稍后重试。', 409);
    const job = structuredClone(find(ledger().jobs, id));
    requireValue(job.remoteId && !['failed', 'cancelled'].includes(job.state), 'video_remote_unknown', '原视频没有可查询的任务ID或已经失败，未重新生成。', 409);
    checking.add(id);
    try {
      const result = await readRemoteVideoState(gateway, job);
      const scope = { id: job.id, productId: job.productId, nodeId: job.nodeId, remoteId: job.remoteId };
      if (!download) return { ...scope, status: result.status };
      requireValue(result.status === 'completed', 'video_remote_pending', '渠道视频尚未完成，未下载或重新生成。', 409);
      return { ...scope, status: 'completed', media: await downloadRemoteVideo(gateway, job, result.state) };
    } finally { checking.delete(id); }
  }
  return Object.freeze({
    poll: id => inspect(id),
    download: id => inspect(id, true),
    async create(scope, request) {
      validateScope(scope);
      validateSubmission({ id: scope.id, productId: scope.productId, nodeId: scope.nodeId, binding: scope.binding, request });
      requireValue(request.method === 'POST' && (scope.provider === 'openai' ? request.path === '/v1/videos' : /^\/v1(?:beta)?\/models\/[\w.:-]+:predictLongRunning$/.test(request.path)), 'invalid_video_request', '只能创建对应渠道的视频任务。');
      gateway.validate(scope.binding, request);
      requireValue(!dispatching.has(scope.id), 'video_create_busy', '原视频创建请求仍在发送，不能重发。', 409);
      dispatching.add(scope.id);
      try {
        const { job, created } = await admit(scope);
        if (!created) {
          requireValue(job.remoteId && job.state === 'uncertain', 'video_remote_unknown', '原视频创建响应未确认，不能重新发送。', 409);
          return job;
        }
        const response = await gateway.execute(scope.binding, request);
        requireValue(response.status >= 200 && response.status < 300 && /json/i.test(response.contentType), 'video_create_unconfirmed', '渠道创建响应未确认，请核实原请求。', 409);
        let state; try { state = JSON.parse(response.bytes.toString('utf8')); } catch { requireValue(false, 'video_create_unconfirmed', '渠道创建响应格式无效。', 409); }
        if (state?.data && typeof state.data === 'object') { requireValue(state.code === undefined || [0, 200, '0', '200'].includes(state.code), 'video_create_unconfirmed', '渠道创建响应未确认。', 409); state = state.data; }
        const remoteId = scope.provider === 'gemini' ? state?.name : state?.id;
        requireValue(validRemoteVideoId(scope.provider, remoteId), 'invalid_video_remote_id', '未收到有效视频任务ID，原请求保留待核实。', 409);
        return await mutate(jobs => {
          const current = find(jobs, scope.id);
          requireValue(!terminal(current) && current.remoteId === null, 'video_task_conflict', '原视频状态已变化。', 409);
          current.remoteId = remoteId; current.reason = 'remote_task_pending'; current.updatedAt = Math.max(clock(), current.updatedAt); return current;
        });
      } finally { dispatching.delete(scope.id); }
    },
    ensure: async (scope, remoteId) => (await admit(scope, remoteId)).job,
    find(productId, nodeId) {
      requireValue(validId(productId) && validId(nodeId), 'invalid_video_scope', '视频归属无效。');
      return structuredClone(ledger().jobs.find(job => !terminal(job) && job.productId === productId && job.nodeId === nodeId) || null);
    },
    isTracked: (productId, nodeId, remoteId) => ledger().jobs.some(job => job.productId === productId && job.nodeId === nodeId && job.remoteId === remoteId),
    has: id => ledger().jobs.some(job => job.id === id),
    async confirmTerminal(id) {
      requireValue(!closed && !checking.has(id), 'video_check_busy', '原视频正在核实，请稍后查询。', 409);
      const job = structuredClone(find(ledger().jobs, id));
      if (terminal(job)) return job;
      requireValue(job.remoteId, 'video_remote_unknown', '视频是否已被渠道接受尚未确认，请核实原请求。', 409);
      checking.add(id);
      try {
        const result = await readRemoteVideoState(gateway, job);
        const failed = result.status === 'failed', succeeded = result.status === 'completed';
        requireValue(failed || succeeded, 'video_remote_pending', '渠道视频尚未结束，保留原任务。', 409);
        if (succeeded) requireValue(await verifySaved(job) === true, 'video_result_unsaved', '原视频尚未确认保存到原画布，不能解除保护。', 409);
        return await mutate(jobs => {
          const current = find(jobs, id);
          requireValue(sameScope(current, job) && current.remoteId === job.remoteId && !terminal(current), 'video_task_conflict', '视频状态已改变。', 409);
          current.state = failed ? 'failed' : 'succeeded'; current.reason = failed ? 'remote_failed' : 'remote_completed'; current.updatedAt = Math.max(clock(), current.updatedAt); return current;
        });
      } finally { checking.delete(id); }
    },
    async confirmNoResult(id, acknowledgement) {
      requireValue(acknowledgement === NO_RESULT_ACK && !checking.has(id) && !dispatching.has(id), 'video_confirmation_required', '必须在渠道确认结束且没有结果，才能收口。', 409);
      return mutate(jobs => {
        const job = find(jobs, id);
        requireValue(job.state === 'uncertain' && job.remoteId === null || job.state === 'cancelled' && job.reason === 'operator_confirmed_no_result', 'video_resolution_denied', '已知任务ID必须先查询渠道终态。', 409);
        if (job.state !== 'cancelled') { job.state = 'cancelled'; job.reason = 'operator_confirmed_no_result'; job.updatedAt = Math.max(clock(), job.updatedAt); }
        return job;
      });
    },
    updateBlockers: () => ledger().jobs.filter(job => !terminal(job)).map(job => ({ id: job.id, state: job.state, reason: job.remoteId ? 'video_remote_pending' : 'video_remote_unknown', createdAt: job.createdAt, productId: job.productId, nodeId: job.nodeId, canConfirmNoResult: !closed && !checking.has(job.id) && !dispatching.has(job.id) && job.remoteId === null })),
    assertCanUpdate() { requireValue(ledger().jobs.every(terminal) && checking.size === 0 && dispatching.size === 0, 'install_tasks_pending', '存在未决视频或未核验保存的视频结果，不能更新。', 409); },
    assertCanClose() { requireValue(checking.size === 0 && dispatching.size === 0, 'video_check_busy', '视频正在核实渠道终态，暂不能关闭。', 409); },
    async close() { requireValue(checking.size === 0 && dispatching.size === 0, 'video_check_busy', '视频正在核实。', 409); closed = true; await tail; },
  });
}
