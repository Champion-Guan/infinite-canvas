import { MAX_TEXT_BYTES } from '../生成网关/文本流式协议.mjs';
import { requireValue } from '../本机存储/协议.mjs';

// 仅活跃任务占用内存；无轮询写盘、无逐字SQLite记录，冷启动仍以原账本为准。
export function createTransientTextProgress() {
  const entries = new Map(), listeners = new Map();
  const notify = id => { for (const wake of [...(listeners.get(id) || [])]) wake(); };
  return Object.freeze({
    update(id, text) {
      requireValue(typeof text === 'string' && Buffer.byteLength(text) <= MAX_TEXT_BYTES, 'generation_text_too_large', '文本响应超过限制。', 502);
      const previous = entries.get(id);
      if (previous?.text === text) return;
      entries.set(id, { text, revision: (previous?.revision || 0) + 1 }); notify(id);
    },
    read: id => entries.get(id) || null,
    clear(id) { entries.delete(id); notify(id); },
    wake: notify,
    wait(id, revision, signal, timeout = 10_000) {
      signal?.throwIfAborted();
      if ((entries.get(id)?.revision || 0) !== revision) return Promise.resolve();
      return new Promise(resolve => {
        let timer;
        const wake = () => { clearTimeout(timer); signal?.removeEventListener('abort', wake); const set = listeners.get(id); set?.delete(wake); if (!set?.size) listeners.delete(id); resolve(); };
        if (!listeners.has(id)) listeners.set(id, new Set());
        listeners.get(id).add(wake); signal?.addEventListener('abort', wake, { once: true });
        timer = setTimeout(wake, timeout); timer.unref?.();
        if (signal?.aborted) wake();
      });
    },
  });
}
