import { requireValue } from './协议.mjs';

const windows = new WeakMap();
const WINDOW_MS = 10_050, TOTAL_LIMIT = 96, READ_LIMIT = 64;

// 总请求仍低于服务端120次/10秒。快照入口为实际保存预留32个位置，
// 避免缩略图/历史读取填满窗口后，连保存新分片所需的读取也被拖住。
export function createPacedDataClient(client, { reserveWrites = false, now = () => performance.now(), wait = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  requireValue(client && typeof client.readDocument === 'function', 'invalid_client', '分片客户端缺少读取端口。');
  if (windows.has(client)) {
    const shared = windows.get(client);
    if (reserveWrites) shared.readLimit = READ_LIMIT;
    return shared.port;
  }
  const starts = [], reads = [], shared = { readLimit: reserveWrites ? READ_LIMIT : TOTAL_LIMIT, port: null };
  async function request(method, args, foreground = method === 'writeDocument' || method === 'writeMedia') {
    requireValue(typeof client[method] === 'function', 'storage_port_denied', '当前存储端口未开放此操作。');
    while (true) {
      const time = now();
      while (starts.length && time - starts[0] >= WINDOW_MS) starts.shift();
      while (reads.length && time - reads[0] >= WINDOW_MS) reads.shift();
      if (starts.length < TOTAL_LIMIT && (foreground || reads.length < shared.readLimit)) {
        starts.push(time); if (!foreground) reads.push(time);
        return client[method](...args);
      }
      const oldest = starts.length >= TOTAL_LIMIT ? starts[0] : reads[0];
      const waitMs = Math.max(1, Math.ceil(WINDOW_MS - (time - oldest)));
      if (waitMs > 500) console.debug('[存储性能] 请求窗口等待 ' + JSON.stringify({ method, foreground, waitMs }));
      await wait(waitMs);
    }
  }
  const port = Object.fromEntries(['readDocument', 'writeDocument', 'readMedia', 'writeMedia', 'readUsage'].map(method => [method, (...args) => request(method, args)]));
  // 仅存储内部使用；请求仍经过原客户端鉴权、完整校验及同一总窗口。
  port.readForWrite = (...args) => request('readDocument', args, true);
  if (typeof client.readNamespace === 'function') port.readNamespace = namespace => request('readNamespace', [namespace]);
  shared.port = port; windows.set(client, shared);
  return port;
}
