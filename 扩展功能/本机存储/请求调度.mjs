import { requireValue } from './协议.mjs';

const windows = new WeakMap();
const WINDOW_MS = 10_050, TOTAL_LIMIT = 96, READ_LIMIT = 64;

// 旧接入使用96次/10秒的固定窗口。生产授权入口传requestLimit=0，取消会让
// 正常刷新等待10秒的频率阈值；仍用并发整形保护本机服务和SQLite写入。
export function createPacedDataClient(client, { reserveWrites = false, requestLimit = TOTAL_LIMIT, maxConcurrent = 6, now = () => performance.now(), wait = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  requireValue(client && typeof client.readDocument === 'function', 'invalid_client', '分片客户端缺少读取端口。');
  requireValue(Number.isInteger(requestLimit) && requestLimit >= 0 && requestLimit <= TOTAL_LIMIT, 'invalid_client', '存储请求窗口配置无效。');
  requireValue(Number.isInteger(maxConcurrent) && maxConcurrent > 0 && maxConcurrent <= 32, 'invalid_client', '存储并发配置无效。');
  if (windows.has(client)) {
    const shared = windows.get(client);
    if (reserveWrites) shared.readLimit = READ_LIMIT;
    return shared.port;
  }
  const starts = [], reads = [], waiters = [], shared = { requestLimit, readLimit: reserveWrites ? READ_LIMIT : TOTAL_LIMIT, maxConcurrent, active: 0, port: null };
  async function acquire() {
    if (shared.active < shared.maxConcurrent) { shared.active++; return; }
    await new Promise(resolve => waiters.push(resolve));
  }
  function release() {
    // 直接移交已占用的名额，避免新请求在旧等待者醒来前抢占同一个名额。
    const next = waiters.shift();
    if (next) next();
    else shared.active--;
  }
  async function request(method, args, foreground = method === 'writeDocument' || method === 'writeMedia') {
    requireValue(typeof client[method] === 'function', 'storage_port_denied', '当前存储端口未开放此操作。');
    let acquired = false;
    try {
      while (true) {
        await acquire();
        acquired = true;
        const time = now();
        while (starts.length && time - starts[0] >= WINDOW_MS) starts.shift();
        while (reads.length && time - reads[0] >= WINDOW_MS) reads.shift();
        if (shared.requestLimit === 0 || starts.length < shared.requestLimit && (foreground || reads.length < shared.readLimit)) {
          if (shared.requestLimit > 0) { starts.push(time); if (!foreground) reads.push(time); }
          break;
        }
        const oldest = starts.length >= shared.requestLimit ? starts[0] : reads[0];
        const waitMs = Math.max(1, Math.ceil(WINDOW_MS - (time - oldest)));
        if (waitMs > 500) console.debug('[存储性能] 请求窗口等待 ' + JSON.stringify({ method, foreground, waitMs }));
        // 等待时间窗口时让出并发名额，实际发送时再计数；前台保存不会被等候读取占满。
        release(); acquired = false;
        await wait(waitMs);
      }
      return await client[method](...args);
    } finally {
      if (acquired) release();
    }
  }
  const port = Object.fromEntries(['readDocument', 'writeDocument', 'readMedia', 'writeMedia', 'readUsage'].map(method => [method, (...args) => request(method, args)]));
  // 仅存储内部使用；请求仍经过原客户端鉴权、完整校验及同一总窗口。
  port.readForWrite = (...args) => request('readDocument', args, true);
  if (typeof client.readNamespace === 'function') port.readNamespace = namespace => request('readNamespace', [namespace]);
  if (typeof client.purgeMedia === 'function') port.purgeMedia = ids => request('purgeMedia', [ids], true);
  shared.port = port; windows.set(client, shared);
  return port;
}
