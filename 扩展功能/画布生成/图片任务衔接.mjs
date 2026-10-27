import { requireValue } from '../本机存储/协议.mjs';
import { bindingLike, jobLike, terminalState, TASK_STATES } from '../生成网关/生成协议.mjs';

// 仅把原图片协议与本机任务端口连接起来，不知道当前路由，不读取浏览器数据库。
// 保存/应用按产品串行；上游生成仍可并行，避免多张结果互相使React提交票据失效。
const productWrites = new Map();
export async function serializeProductResult(productId, operation) {
  const previous = productWrites.get(productId) || Promise.resolve();
  const flight = previous.catch(() => {}).then(operation);
  productWrites.set(productId, flight);
  try { return await flight; }
  finally { if (productWrites.get(productId) === flight) productWrites.delete(productId); }
}
export async function imageRequestHash(request) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(request))))]
    .map(value => value.toString(16).padStart(2, '0')).join('');
}
function scoped(job, scope, id) {
  requireValue(job?.id === id && job.productId === scope.productId && job.nodeId === scope.nodeId && TASK_STATES.includes(job.state),
    'generation_scope_mismatch', '任务不属于原产品或卡片，没有写入当前产品。', 409);
  return job;
}
// 四个并行任务最多约80次查询/分钟，给既有120次入口限流留出保存和控制余量。
const delay = () => new Promise(resolve => setTimeout(resolve, 3000));

const slots = new Set();
/** @param {{host: any, scope: {productId: string, nodeId: string, slotId: string}, prepare: Function, bind: Function, previous?: any, recordTask: Function, applyAndSave: Function, onProgress?: Function, signal?: AbortSignal, retry?: boolean, wait?: Function, makeId?: Function}} options */
export async function runCanvasImageTask(options) {
  const key = JSON.stringify([options.scope?.productId, options.scope?.nodeId, options.scope?.slotId]);
  requireValue(!slots.has(key), 'generation_slot_busy', '该生成任务正在处理，请勿重复点击。', 409);
  slots.add(key);
  try { return await run(options); } finally { slots.delete(key); }
}
async function run({ host, scope, prepare, bind, previous, recordTask, applyAndSave,
  signal, onProgress, retry = false, wait = delay, makeId = () => crypto.randomUUID() } = {}) {
  requireValue(host?.submit && host?.get && host?.deliver && host?.checkpoint && typeof prepare === 'function' &&
    typeof bind === 'function' && typeof recordTask === 'function' && typeof applyAndSave === 'function' &&
    typeof scope?.productId === 'string' && typeof scope.nodeId === 'string' && typeof scope.slotId === 'string',
  'invalid_canvas_generation', '原画布生成接入不完整，没有改用直连接口。');
  const target = Object.freeze({ ...scope });
  let descriptor = previous ? structuredClone(previous) : null, job, replacementId;
  if (descriptor) {
    requireValue(jobLike(descriptor.taskId) && descriptor.slotId === target.slotId && bindingLike(descriptor.binding) &&
      /^[0-9a-f]{64}$/.test(descriptor.requestHash), 'invalid_canvas_task', '原卡片任务记录无效，没有重新生成。');
    try { job = scoped(await host.get(descriptor.taskId), target, descriptor.taskId); }
    catch (error) {
      if (error?.code !== 'generation_not_found') throw error;
      if (retry && typeof host.retirePreparedTask === 'function') {
        if (signal?.aborted) throw new DOMException('已取消', 'AbortError');
        job = scoped(await host.retirePreparedTask({ id: descriptor.taskId, productId: target.productId,
          nodeId: target.nodeId, binding: descriptor.binding, requestHash: descriptor.requestHash }), target, descriptor.taskId);
      }
    }
    if (job && (['failed', 'cancelled'].includes(job.state) || job.state === 'succeeded' && job.applied && retry)) {
      requireValue(retry, 'generation_explicit_retry_required', '原任务已结束，请明确点击重试后再生成。', 409);
      if (job.state === 'cancelled' && job.reason === 'replaced_before_dispatch') {
        // 多页面恢复同一旧身份时共用后继ID；旧页面迟到重试不会再生成另一笔。
        const hash = await imageRequestHash({ retiredTaskId: descriptor.taskId, ...target });
        replacementId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
      }
      descriptor = null; job = undefined;
    }
  }
  let request;
  if (!descriptor || !job) {
    if (signal?.aborted) throw new DOMException('已取消', 'AbortError');
    request = await prepare();
    const requestHash = await imageRequestHash(request);
    if (descriptor) {
      // 页面可能在保存任务身份后、提交前断线。只能以同ID、同绑定、同请求补交。
      requireValue(descriptor.requestHash === requestHash, 'generation_request_changed', '原任务请求已改变，不能用新提示词覆盖未决任务。', 409);
    } else {
      const binding = await bind();
      requireValue(bindingLike(binding), 'invalid_provider_binding', '渠道未得到有效的本机绑定。');
      descriptor = { taskId: replacementId || makeId(), slotId: target.slotId, binding, requestHash };
      requireValue(jobLike(descriptor.taskId), 'invalid_canvas_task', '任务ID无效。');
      await serializeProductResult(target.productId, () => recordTask(Object.freeze({ ...descriptor })));
    }
  }
  const task = { id: descriptor.taskId, productId: target.productId, nodeId: target.nodeId };
  let cancelled = false;
  const cancel = () => { cancelled = true; void host.cancel(task.id).catch(() => {}); };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    if (!job) {
      // 记录已落盘后才允许收费提交。Abort发生在保存期间时不发送。
      if (signal?.aborted) throw new DOMException('已取消', 'AbortError');
      job = scoped(await host.submit({ ...task, binding: descriptor.binding, request }), target, task.id);
      if (cancelled) cancel();
    }
    if (onProgress && host.observeText && !terminalState(job.state)) {
      try { job = scoped(await host.observeText(task, { signal, onProgress: text => onProgress(text, task.id) }), target, task.id); }
      catch {
        if (signal?.aborted) throw new DOMException('已取消', 'AbortError');
        // 观察失败只查询原任务，不重提submit，不将部分文字当作最终成功。
        job = scoped(await host.get(task.id), target, task.id);
      }
    }
    while (!terminalState(job.state)) {
      if (signal?.aborted) { cancel(); throw new DOMException('已取消', 'AbortError'); }
      await wait();
      job = scoped(await host.get(task.id), target, task.id);
    }
    // 结果落盘失败可以重试同一份响应，不重新调用上游。
    if (job.state === 'uncertain' && job.reason === 'result_save_unconfirmed')
      job = scoped(await host.retryResultSave(task.id), target, task.id);
    requireValue(job.state === 'succeeded', job.state === 'uncertain' ? 'generation_result_unknown' : 'generation_failed',
      job.state === 'uncertain' ? '上游是否完成尚未确认，不能自动重试或重复计费。' : '原生成任务未成功；可明确重试，不会自动切换渠道。', 409);
    if (signal?.aborted) throw new DOMException('已取消', 'AbortError');
    return await serializeProductResult(target.productId, () => host.deliver(task, { applyAndSave: async saved => {
      scoped(saved, target, task.id);
      await applyAndSave(saved, Object.freeze({ taskId: task.id, responseHash: saved.result.id }));
      // 后端再次核对已落盘的原产品、节点和收据；不能以setNodes或saved:true代替。
      return host.checkpoint(task.id);
    } }));
  } finally { signal?.removeEventListener('abort', cancel); }
}
