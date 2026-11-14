// 取消单个等待不取消共用恢复，也不轮询或重发业务请求。
export async function waitForProxyStartup(startup, signal) {
  signal?.throwIfAborted();
  if (!signal) return startup;
  let abort;
  try {
    return await Promise.race([startup, new Promise((_, reject) => {
      abort = () => reject(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    })]);
  } finally { signal.removeEventListener('abort', abort); }
}
