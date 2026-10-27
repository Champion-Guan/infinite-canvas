import { createDataClient } from './浏览器适配.mjs';
import { PROTOCOL, StorageError, requireValue, validUUID } from './协议.mjs';

// 自动入口可在原页面授权内恢复过期连接；不重新授权，不延长授权期限。
// 恢复连接不代表保存成功；只有匹配原操作的落盘回执才清除对应错误。
export function createRenewingDataClient({ url, host, origin = globalThis.location?.origin, fetchImpl = globalThis.fetch, onStatus = () => {}, now = Date.now, renewalWindow = 30_000, autoReconnect = false } = {}) {
  let address, pageAddress;
  try { address = new URL(url); pageAddress = new URL(origin); } catch { /* 下面统一拒绝。 */ }
  requireValue(address?.origin === url && address.protocol === 'http:' && address.hostname === '127.0.0.1' && !!address.port &&
    pageAddress?.origin === origin && pageAddress.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(pageAddress.hostname) && !!pageAddress.port &&
    host && typeof host.initialize === 'function' && typeof host.renew === 'function' && typeof host.close === 'function' &&
    typeof fetchImpl === 'function' && typeof now === 'function' && typeof onStatus === 'function' && Number.isSafeInteger(renewalWindow) && renewalWindow > 0 && typeof autoReconnect === 'boolean',
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
  function install(session, previous) {
    valid(session, previous?.session);
    requireValue(!closed && current === previous, 'session_mismatch', '恢复期间本机会话改变，未替换当前连接。', 401);
    const holder = { session: { ...session }, active: 0, retired: false, client: createDataClient({ url, session, fetchImpl }) };
    holders.add(holder); current = holder;
    if (previous) { previous.retired = true; release(previous); }
    return holder;
  }
  function reconnectSession(previous) {
    requireValue(typeof host.reconnect === 'function', 'reconnect_unavailable', '当前本机服务不支持保留页面重新连接。', 503);
    return host.reconnect({ ...previous.session });
  }
  const expired = holder => holder.session.expiresAt <= clock();
  async function acquire() {
    requireValue(!closed, 'client_closed', '续期数据客户端已关闭。');
    if (reconnectFlight) await reconnectFlight;
    if (!flight && (!current || current.session.expiresAt - clock() <= renewalWindow)) {
      flight = (async () => {
        const previous = current;
        let session;
        if (!previous) session = await host.initialize();
        else if (expired(previous)) {
          requireValue(autoReconnect, 'session_expired', '本机数据会话已过期，需要恢复原连接。', 401);
          session = await reconnectSession(previous);
        } else {
          try {
            try { session = await host.renew({ ...previous.session }); }
            catch (error) {
              // 仅重试无业务副作用的幂等续期；保存/生成请求仍不因未知响应自动重放。
              if (!autoReconnect || !['authorization_connection_failed', 'connection_failed'].includes(error?.code)) throw error;
              session = await host.renew({ ...previous.session });
            }
          }
          catch (error) {
            // 续期请求恰好跨过期限时，服务已明确拒绝，尚未发出业务请求。
            if (!autoReconnect || error?.code !== 'session_expired' || !expired(previous)) throw error;
            session = await reconnectSession(previous);
          }
        }
        return install(session, previous);
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
      let result;
      try { result = await holder.client[method](...values); }
      catch (error) {
        // 本地过期或服务端明确拒绝过期令牌才可再发一次；未知网络/丢回执/冲突不可自动重放。
        if (!autoReconnect || !(error instanceof StorageError) || error.status !== 401 ||
          !['session_expired', 'session_denied'].includes(error.code) || !expired(holder)) throw error;
        holder.active--; release(holder); holder = null;
        holder = await acquire();
        result = await holder.client[method](...values);
      }
      if (method === 'writeDocument') lastAck = Object.freeze({ ...result });
      errors.delete(key); return result;
    } catch (error) {
      errors.set(key, { key, code: error instanceof StorageError ? error.code : 'connection_failed', message: error instanceof StorageError ? error.message : '本机连接或续期失败；保存结果未确认，没有自动重发。' });
      throw error instanceof StorageError ? error : new StorageError('connection_failed', '本机连接或续期失败；保存结果未确认，没有自动重发。', 503);
    } finally { if (holder) { holder.active--; release(holder); } pending--; notify(); }
  }
  return Object.freeze({
    getStatus: status,
    async ensureSession() {
      const holder = await acquire();
      holder.active--; release(holder);
    },
    reconnect() {
      requireValue(!closed, 'client_closed', '续期数据客户端已关闭。');
      if (reconnectFlight) return reconnectFlight;
      requireValue(current && !pending && !flight, 'reconnect_busy', '请等待当前保存请求结束后再重新连接。', 409);
      const previous = current;
      reconnectFlight = Promise.resolve().then(async () => {
        install(await reconnectSession(previous), previous);
      });
      reconnectFlight.then(() => { reconnectFlight = null; notify(); }, () => { reconnectFlight = null; notify(); });
      return reconnectFlight;
    },
    readUsage: () => run('read:usage', 'readUsage', []),
    readNamespace: namespace => run(`namespace:${namespace}`, 'readNamespace', [namespace]),
    readDocument: (collection, id, options) => run(`read:${collection}:${id}`, 'readDocument', [collection, id, options]),
    writeDocument: input => run(`write:${input?.collection}:${input?.id}`, 'writeDocument', () => {
      try { return [structuredClone(input)]; } catch { throw new StorageError('invalid_document', '保存内容不可快照，没有发送保存请求。'); }
    }),
    writeMedia: blob => run('media:upload', 'writeMedia', [blob]),
    readMedia: id => run(`media:${id}`, 'readMedia', [id]),
    purgeMedia: ids => run('media:cleanup', 'purgeMedia', [ids]),
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
