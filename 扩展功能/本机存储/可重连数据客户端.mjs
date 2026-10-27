import { createDataClient } from './浏览器适配.mjs';
import { PROTOCOL, StorageError, requireValue, validUUID } from './协议.mjs';

// 活动请求仅续期；过期后只能由用户明确调用reconnect恢复同工作区连接。
// 恢复连接本身不重发业务请求、不清错误、不生成新的保存operationId。
export function createRenewingDataClient({ url, host, origin = globalThis.location?.origin, fetchImpl = globalThis.fetch, onStatus = () => {}, now = Date.now, renewalWindow = 30_000 } = {}) {
  let address, pageAddress;
  try { address = new URL(url); pageAddress = new URL(origin); } catch { /* 下面统一拒绝。 */ }
  requireValue(address?.origin === url && address.protocol === 'http:' && address.hostname === '127.0.0.1' && !!address.port &&
    pageAddress?.origin === origin && pageAddress.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(pageAddress.hostname) && !!pageAddress.port &&
    host && typeof host.initialize === 'function' && typeof host.renew === 'function' && typeof host.close === 'function' &&
    typeof fetchImpl === 'function' && typeof now === 'function' && typeof onStatus === 'function' && Number.isSafeInteger(renewalWindow) && renewalWindow > 0,
  'invalid_session_client', '续期客户端配置无效。');
  let current = null, flight = null, reconnectFlight = null, closed = false, pending = 0, lastAck = null;
  const holders = new Set(), errors = new Map();
  function clock() { const value = now(); requireValue(Number.isSafeInteger(value) && value >= 0, 'invalid_clock', '会话时钟无效。'); return value; }
  const status = () => ({ state: errors.size ? 'error' : pending ? 'saving' : lastAck ? 'saved' : 'idle', pending, lastAck, errors: [...errors.values()] });
  function notify() { try { onStatus(status()); } catch { /* 订阅器不能改变保存结果。 */ } }
  function valid(session, previous) {
    requireValue(session?.protocol === PROTOCOL && session.origin === origin && validUUID(session.workspaceId) &&
      /^[0-9a-f]{64}$/.test(session.token) && /^[0-9a-f]{64}$/.test(session.csrf) && Number.isSafeInteger(session.expiresAt) &&
      session.expiresAt > clock() && session.expiresAt - clock() <= 15 * 60_000 &&
      (!previous || session.workspaceId === previous.workspaceId && session.token !== previous.token && session.csrf !== previous.csrf && session.expiresAt >= previous.expiresAt),
    'invalid_session', '续期返回的工作区、Origin、有效期或令牌不匹配。', 401);
  }
  function release(holder) {
    if (holder.retired && holder.active === 0) { holder.client.close(); holders.delete(holder); }
  }
  async function acquire() {
    requireValue(!closed, 'client_closed', '续期数据客户端已关闭。');
    if (reconnectFlight) await reconnectFlight;
    if (!flight && (!current || current.session.expiresAt - clock() <= renewalWindow)) {
      flight = (async () => {
        if (current) requireValue(current.session.expiresAt > clock(), 'session_expired', '本机数据会话已过期，未自动重新授权。', 401);
        const previous = current, session = previous ? await host.renew({ ...previous.session }) : await host.initialize();
        valid(session, previous?.session);
        requireValue(!closed, 'client_closed', '续期数据客户端已关闭。');
        const holder = { session: { ...session }, active: 0, retired: false, client: createDataClient({ url, session, fetchImpl }) };
        holders.add(holder); current = holder;
        if (previous) { previous.retired = true; release(previous); }
        return holder;
      })();
      flight.then(() => { flight = null; }, () => { flight = null; });
    }
    const holder = flight ? await flight : current;
    holder.active++;
    return holder;
  }
  async function run(key, method, args) {
    pending++; notify();
    let holder;
    try {
      // 先快照再等待初始化/续期，调用者随后修改原对象不能改变本笔保存。
      const values = typeof args === 'function' ? args() : args;
      holder = await acquire();
      const result = await holder.client[method](...values);
      if (method === 'writeDocument') lastAck = Object.freeze({ ...result });
      errors.delete(key); return result;
    } catch (error) {
      errors.set(key, { key, code: error instanceof StorageError ? error.code : 'connection_failed', message: error instanceof StorageError ? error.message : '本机连接或续期失败；保存结果未确认，没有自动重发。' });
      throw error instanceof StorageError ? error : new StorageError('connection_failed', '本机连接或续期失败；保存结果未确认，没有自动重发。', 503);
    } finally { if (holder) { holder.active--; release(holder); } pending--; notify(); }
  }
  return Object.freeze({
    getStatus: status,
    reconnect() {
      requireValue(!closed, 'client_closed', '续期数据客户端已关闭。');
      if (reconnectFlight) return reconnectFlight;
      requireValue(current && !pending && !flight, 'reconnect_busy', '请等待当前保存请求结束后再重新连接。', 409);
      requireValue(typeof host.reconnect === 'function', 'reconnect_unavailable', '当前本机服务不支持保留页面重新连接。', 503);
      const previous = current;
      reconnectFlight = Promise.resolve().then(async () => {
        const session = await host.reconnect({ ...previous.session });
        valid(session, previous.session);
        requireValue(!closed && current === previous, 'session_mismatch', '恢复期间本机会话改变，未替换当前连接。', 401);
        const holder = { session: { ...session }, active: 0, retired: false, client: createDataClient({ url, session, fetchImpl }) };
        holders.add(holder); current = holder; previous.retired = true; release(previous);
      });
      reconnectFlight.then(() => { reconnectFlight = null; notify(); }, () => { reconnectFlight = null; notify(); });
      return reconnectFlight;
    },
    readUsage: () => run('read:usage', 'readUsage', []),
    readDocument: (collection, id, options) => run(`read:${collection}:${id}`, 'readDocument', [collection, id, options]),
    writeDocument: input => run(`write:${input?.collection}:${input?.id}`, 'writeDocument', () => {
      try { return [structuredClone(input)]; } catch { throw new StorageError('invalid_document', '保存内容不可快照，没有发送保存请求。'); }
    }),
    writeMedia: blob => run('media:upload', 'writeMedia', [blob]),
    readMedia: id => run(`media:${id}`, 'readMedia', [id]),
    async close() {
      requireValue(!pending && !errors.size && !reconnectFlight, 'save_not_confirmed', '仍有未确认或失败操作，不能关闭数据客户端。', 409);
      if (closed) return;
      closed = true;
      for (const holder of holders) holder.client.close();
      holders.clear(); current = null;
      await host.close();
    },
  });
}
