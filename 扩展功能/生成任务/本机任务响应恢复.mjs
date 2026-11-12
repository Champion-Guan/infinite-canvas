const connectionErrors = new Set(['request_timeout', 'generation_connection_unknown']);

export const isGenerationConnectionError = error => connectionErrors.has(error?.code);
const aborted = () => new DOMException('已取消', 'AbortError');
export function assertGenerationActive(signal) {
  if (signal?.aborted) throw aborted();
}
function untilAborted(operation, signal) {
  assertGenerationActive(signal);
  if (!signal) return Promise.resolve().then(operation);
  return new Promise((resolve, reject) => {
    const abort = () => reject(aborted());
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve().then(() => { assertGenerationActive(signal); return operation(); })
      .then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
function pause(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(aborted()); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, milliseconds);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

// 仅用于查询、取回响应及幂等确认；收费 submit 不得放入此重试循环。
/**
 * @template T
 * @param {() => Promise<T> | T} operation
 * @param {{signal?: AbortSignal, wait?: (milliseconds: number, signal?: AbortSignal) => Promise<unknown>}} [options]
 * @returns {Promise<T>}
 */
export async function recoverGenerationResponse(operation, { signal, wait = pause } = {}) {
  let attempts = 0;
  for (;;) {
    try {
      const result = await untilAborted(operation, signal);
      assertGenerationActive(signal);
      return result;
    } catch (error) {
      assertGenerationActive(signal);
      if (!isGenerationConnectionError(error)) throw error;
      await untilAborted(() => wait(Math.min(1000 * 2 ** Math.min(attempts++, 4), 10000), signal), signal);
    }
  }
}
