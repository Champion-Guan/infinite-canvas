import { requireValue } from '../本机存储/协议.mjs';
import { GENERATION_PROTOCOL, terminalState, TASK_STATES } from '../生成网关/生成协议.mjs';

const maxLine = 2 * 1024 * 1024;
// 只消费原授权闭包取得的响应；完整终态仍回到deliver/检查点/画布保存，不直接认定完成。
export async function readTextProgress(response, task, { onProgress, signal } = {}) {
  requireValue(response.ok && /^application\/x-ndjson(?:;|$)/i.test(response.headers.get('content-type') || '') && response.body,
    'generation_observation_invalid', '文本观察连接未确认，请查询原任务。', 503);
  const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true });
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  let pending = '', lastRevision = 0;
  try {
    while (true) {
      signal?.throwIfAborted();
      const next = await reader.read();
      signal?.throwIfAborted();
      pending += decoder.decode(next.value, { stream: !next.done });
      requireValue(pending.length <= maxLine, 'generation_observation_invalid', '文本观察响应过大。', 502);
      let end;
      while ((end = pending.indexOf('\n')) !== -1) {
        const line = pending.slice(0, end); pending = pending.slice(end + 1);
        let value; try { value = JSON.parse(line); } catch { requireValue(false, 'generation_observation_invalid', '文本观察响应无效。', 502); }
        requireValue(value?.protocol === GENERATION_PROTOCOL && !value.error, 'generation_observation_unknown', '文本观察中断，原任务保留。', 503);
        if (value.heartbeat === true) continue;
        const job = value.job;
        requireValue(job?.id === task.id && job.productId === task.productId && job.nodeId === task.nodeId && TASK_STATES.includes(job.state) && typeof value.done === 'boolean' && value.done === terminalState(job.state),
          'generation_scope_mismatch', '文本观察不属于原画布，未显示。', 409);
        if (value.progress) {
          requireValue(typeof value.progress.text === 'string' && new TextEncoder().encode(value.progress.text).length <= 1024 * 1024 && Number.isSafeInteger(value.progress.revision) && value.progress.revision >= lastRevision && value.progress.revision > 0,
            'generation_observation_invalid', '文本观察序号或内容无效。', 502);
          if (value.progress.revision !== lastRevision) { lastRevision = value.progress.revision; signal?.throwIfAborted(); onProgress?.(value.progress.text); }
        }
        if (value.done) { signal?.throwIfAborted(); return job; }
      }
      if (next.done) break;
    }
    requireValue(false, 'generation_observation_unknown', '文本观察未收到终态，原任务保留。', 503);
  } finally { signal?.removeEventListener('abort', abort); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
