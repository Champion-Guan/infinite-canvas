import { StorageError, requireValue } from '../本机存储/协议.mjs';

export const proxyQueueErrors = Object.freeze({
  proxy_queue_full: '本地转发等待队列已满，本次请求尚未发送，请稍后再试。',
  proxy_queue_timeout: '本地转发排队超时，本次请求尚未发送。',
  proxy_queue_cancelled: '本地转发等待已取消，本次请求尚未发送。',
  proxy_ingress_busy: '代理请求正文接收繁忙，本次请求尚未执行，请稍后再试。',
});

// 名额直接移交给队首；取消和超时只移除尚未执行的请求，不重新发送操作。
export function createProxyRequestQueue({ concurrent = 4, maxQueued = 16, maxBytes = Infinity,
  maxQueuedBytes = Infinity, timeoutMs = 30_000 } = {}) {
  requireValue(Number.isInteger(concurrent) && concurrent > 0 && Number.isInteger(maxQueued) && maxQueued >= 0
    && maxBytes > 0 && maxQueuedBytes > 0 && timeoutMs > 0, 'proxy_queue_invalid', '代理队列配置无效。');
  const queue = [];
  let active = 0, bytes = 0, queuedBytes = 0;
  const available = weight => active < concurrent && bytes + weight <= maxBytes;
  const error = code => new StorageError(code, proxyQueueErrors[code], 503);
  function admit(entry) {
    active++; bytes += entry.weight;
    let released = false;
    entry.resolve(() => {
      if (released) return;
      released = true; active--; bytes -= entry.weight; drain();
    });
  }
  function clean(entry) { clearTimeout(entry.timer); entry.signal?.removeEventListener('abort', entry.abort); }
  function drain() {
    while (queue.length && available(queue[0].weight)) {
      const entry = queue.shift(); queuedBytes -= entry.retained;
      clean(entry); admit(entry);
    }
  }
  return {
    status: () => ({ active, queued: queue.length, reservedBytes: bytes, queuedBytes }),
    acquire({ signal, weight = 1, retained = 1 } = {}) {
      if (signal?.aborted) return Promise.reject(error('proxy_queue_cancelled'));
      if (!Number.isSafeInteger(weight) || weight < 1 || weight > maxBytes
        || !Number.isSafeInteger(retained) || retained < 1) return Promise.reject(error('proxy_queue_full'));
      return new Promise((resolve, reject) => {
        const entry = { signal, weight, retained, resolve, reject };
        if (!queue.length && available(weight)) { admit(entry); return; }
        if (queue.length >= maxQueued || queuedBytes + retained > maxQueuedBytes) { reject(error('proxy_queue_full')); return; }
        const remove = code => {
          const index = queue.indexOf(entry);
          if (index < 0) return;
          queue.splice(index, 1); queuedBytes -= retained; clean(entry); reject(error(code)); drain();
        };
        entry.abort = () => remove('proxy_queue_cancelled');
        entry.timer = setTimeout(() => remove('proxy_queue_timeout'), timeoutMs);
        signal?.addEventListener('abort', entry.abort, { once: true });
        queue.push(entry); queuedBytes += retained;
      });
    },
  };
}
