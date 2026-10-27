import { StorageError, requireValue } from '../本机存储/协议.mjs';
import { GENERATION_PROTOCOL, validateSubmission, jobLike, terminalState, TASK_STATES, MAX_RESPONSE_BYTES, canonicalBase64 } from '../生成网关/生成协议.mjs';
import { readTextProgress } from './文本进度客户端.mjs';

// 只接受已授权闭包，不接收URL、密钥导出端口或浏览器持久化实现。
// 调用方必须保留同一id；传输失败不新建任务、不自动重发收费请求。
export function createGenerationClient({ command, observe } = {}) {
  requireValue(typeof command === 'function', 'invalid_generation_client', '生成客户端需要本机授权闭包。');
  async function call(value) {
    let reply;
    try { reply = await command(value); }
    catch (error) { if (error instanceof StorageError) throw error; throw new StorageError('generation_connection_unknown', '本机响应未确认；请用原任务ID查询，不要再次生成。', 503); }
    requireValue(reply?.protocol === GENERATION_PROTOCOL && !reply.error && Object.hasOwn(reply, 'result'), 'generation_ack_invalid', '生成响应协议不符。', 503);
    return reply.result;
  }
  function match(job, expected) {
    requireValue(jobLike(job?.id) && job.id === expected.id && job.productId === expected.productId && job.nodeId === expected.nodeId && TASK_STATES.includes(job.state) && typeof job.applied === 'boolean', 'generation_scope_mismatch', '任务结果与原产品或节点不匹配，未写入当前画布。', 409);
    return job;
  }
  return Object.freeze({
    ...(observe ? { async observeText(task, options) { return match(await readTextProgress(await observe({ operation: 'text-observe', id: task.id }, options?.signal), task, options), task); } } : {}),
    videoCreate: (scope, request) => call({ operation: 'video-create', scope, request }),
    videoEnsure: (scope, remoteId) => call({ operation: 'video-ensure', scope, remoteId }),
    videoFind: (productId, nodeId) => call({ operation: 'video-find', productId, nodeId }),
    videoTerminal: id => call({ operation: 'video-terminal', id }),
    videoPoll: id => call({ operation: 'video-poll', id }),
    videoDownload: id => call({ operation: 'video-download', id }),
    models: binding => call({ operation: 'models', binding }),
    fallbackCommand: value => call(value),
    createPlan: plan => call({ operation: 'route-plan', plan }),
    bind: profile => call({ operation: 'bind', profile: structuredClone(profile) }),
    resolveSaved: profile => call({ operation: 'resolve-saved', profile: structuredClone(profile) }),
    describe: binding => call({ operation: 'describe', binding }),
    previewCredential: binding => call({ operation: 'credential-preview', binding }),
    async submit(task) { const snapshot = structuredClone(validateSubmission(task)); return match(await call({ operation: 'submit', task: snapshot }), snapshot); },
    checkpoint: id => call({ operation: 'checkpoint', id }),
    get: id => call({ operation: 'get', id }),
    list: productId => call({ operation: 'list', productId }),
    cancel: id => call({ operation: 'cancel', id }),
    retryResultSave: id => call({ operation: 'retry-save', id }),
    // 独立确认已保存结果：没有result/submit/bind，也不重写图片或新建任务。
    async confirmSaved(task, { responseHash } = {}) {
      requireValue(/^[0-9a-f]{64}$/.test(responseHash), 'generation_receipt_invalid', '原任务收据摘要无效。', 409);
      const job = match(await call({ operation: 'get', id: task.id }), task);
      requireValue(job.state === 'succeeded' && job.result?.id === responseHash, 'generation_receipt_mismatch', '任务结果与原卡片收据不符，未确认完成。', 409);
      if (job.applied) return job;
      const checkpoint = await call({ operation: 'checkpoint', id: task.id });
      const applied = match(await call({ operation: 'applied', id: task.id, checkpoint }), task);
      requireValue(applied.state === 'succeeded' && applied.applied && applied.result?.id === responseHash,
        'generation_ack_invalid', '任务完成确认尚未收到有效响应，请保留原任务。', 503);
      return applied;
    },
    async deliver(task, { applyAndSave } = {}) {
      requireValue(typeof applyAndSave === 'function', 'generation_save_port_required', '需要原产品的保存确认端口。');
      const job = match(await call({ operation: 'result', id: task.id }), task);
      requireValue(job.state === 'succeeded' && terminalState(job.state) && typeof job.bytes === 'string', 'generation_not_successful', '任务没有可应用的成功结果。', 409);
      requireValue(canonicalBase64(job.bytes, MAX_RESPONSE_BYTES), 'generation_result_invalid', '任务结果编码无效。', 409);
      const bytes = Uint8Array.from(atob(job.bytes), value => value.charCodeAt(0));
      const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
      requireValue(job.result?.id === digest && job.result.size === bytes.length, 'generation_result_invalid', '任务结果大小或摘要不匹配。', 409);
      // 原产品ID/节点ID来自提交时快照，绝不根据当前激活胶囊重新选目标。
      const checkpoint = await applyAndSave(Object.freeze({ ...job }));
      return match(await call({ operation: 'applied', id: task.id, checkpoint }), task);
    },
  });
}
