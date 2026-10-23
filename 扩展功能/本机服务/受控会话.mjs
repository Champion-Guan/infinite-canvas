import { StorageError, requireValue, PROTOCOL, validUUID } from '../本机存储/协议.mjs';

const same = (a, b) => ['protocol', 'workspaceId', 'origin', 'token', 'csrf', 'expiresAt'].every(key => a?.[key] === b?.[key]);

// 受控会话的独立后继。重新连接仅由已授权页面的明确操作调用，绝不延长页面租期。
export function createSessionController({ service, origin, now = Date.now, lifetime = 8 * 60 * 60_000, renewalWindow = 30_000, overlap = 20_000, maxLeases = 16, schedule = setTimeout, cancel = clearTimeout } = {}) {
  let address;
  try { address = new URL(origin); } catch { /* 下面统一拒绝。 */ }
  requireValue(service && typeof service.issueSession === 'function' && typeof service.revokeSession === 'function' &&
    address?.origin === origin && address.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(address.hostname) && !!address.port &&
    Number.isSafeInteger(lifetime) && lifetime > 0 && lifetime <= 8 * 60 * 60_000 && Number.isSafeInteger(renewalWindow) && renewalWindow > 0 &&
    Number.isSafeInteger(overlap) && overlap >= 0 && overlap <= 30_000 && Number.isSafeInteger(maxLeases) && maxLeases > 0 && maxLeases <= 16 &&
    typeof now === 'function' && typeof schedule === 'function' && typeof cancel === 'function', 'invalid_session_controller', '受控会话配置无效。');
  const leases = new Set();
  let closed = false;
  function clock() { const value = now(); requireValue(Number.isSafeInteger(value) && value >= 0, 'invalid_clock', '会话时钟无效。'); return value; }
  function timer(fn, delay) { const handle = schedule(fn, delay); handle?.unref?.(); return handle; }
  function finish(lease, reason) {
    if (lease.closed) return;
    lease.closed = reason;
    cancel(lease.timer);
    if (lease.current) service.revokeSession(lease.current.token);
    if (lease.retired) { cancel(lease.retired.timer); service.revokeSession(lease.retired.token); }
    lease.current = null; lease.retired = null; lease.reconnectedFrom = null; lease.renewedFrom = null; leases.delete(lease);
  }
  function requireLive(lease) {
    if (!lease.closed && clock() >= lease.deadline) finish(lease, 'lease_expired');
    requireValue(!closed && !lease.closed, lease.closed === 'lease_expired' ? 'lease_expired' : 'session_host_closed', '本次本机会话授权已结束，需要由可信入口重新授权。', 401);
  }
  function issue(lease) {
    const raw = service.issueSession(origin);
    // 来源服务的异常也不允许遗留一个已签发但不受控的令牌。
    try {
      requireValue(raw?.protocol === PROTOCOL && validUUID(raw.workspaceId) && raw.origin === origin &&
        /^[0-9a-f]{64}$/.test(raw.token) && /^[0-9a-f]{64}$/.test(raw.csrf) && Number.isSafeInteger(raw.expiresAt) &&
        raw.expiresAt > clock() && raw.expiresAt - clock() <= 15 * 60_000 &&
        (!lease.current || raw.workspaceId === lease.current.workspaceId && raw.token !== lease.current.token && raw.csrf !== lease.current.csrf),
      'invalid_session', '本机服务未返回匹配的会话。', 401);
      return Object.freeze({ protocol: raw.protocol, workspaceId: raw.workspaceId, origin, token: raw.token, csrf: raw.csrf, expiresAt: Math.min(raw.expiresAt, lease.deadline) });
    } catch (error) { if (typeof raw?.token === 'string') service.revokeSession(raw.token); throw error; }
  }
  return Object.freeze({
    open() {
      requireValue(!closed, 'session_host_closed', '会话管理器已关闭。', 401);
      for (const lease of leases) if (clock() >= lease.deadline) finish(lease, 'lease_expired');
      requireValue(leases.size < maxLeases, 'too_many_leases', '已授权页面数量达到上限。', 429);
      const lease = { deadline: clock() + lifetime, current: null, retired: null, reconnectedFrom: null, renewedFrom: null, closed: null, timer: null };
      leases.add(lease); lease.timer = timer(() => finish(lease, 'lease_expired'), lifetime);
      return Object.freeze({
        initialize() {
          requireLive(lease);
          if (!lease.current) lease.current = issue(lease);
          requireValue(lease.current.expiresAt > clock(), 'session_expired', '本机数据会话已过期，不能自动重新授权。', 401);
          return { ...lease.current };
        },
        renew(previous) {
          requireLive(lease);
          // 响应丢失后重试相同请求，返回原续期结果，不再签发或延长授权。
          if (lease.renewedFrom && same(previous, lease.renewedFrom)) {
            requireValue(lease.current?.expiresAt > clock(), 'session_expired', '本机数据会话已过期，需要恢复原连接。', 401);
            return { ...lease.current };
          }
          requireValue(lease.current && same(previous, lease.current), 'session_mismatch', '续期请求与当前授权不匹配。', 401);
          requireValue(lease.current.expiresAt > clock(), 'session_expired', '已过期会话不能续期。', 401);
          requireValue(lease.current.expiresAt - clock() <= renewalWindow, 'renewal_not_due', '会话尚未进入续期窗口。', 409);
          // 先成功签发再替换；容量/服务错误保留当前授权，不丢失已有保存能力。
          const next = issue(lease), previousToken = lease.current.token;
          lease.renewedFrom = { ...previous };
          if (lease.retired) { cancel(lease.retired.timer); service.revokeSession(lease.retired.token); }
          const delay = Math.min(overlap, lease.current.expiresAt - clock());
          lease.current = next;
          lease.reconnectedFrom = null;
          lease.retired = { token: previousToken, timer: timer(() => {
            service.revokeSession(previousToken);
            if (lease.retired?.token === previousToken) lease.retired = null;
          }, delay) };
          return { ...next };
        },
        reconnect(previous) {
          requireLive(lease);
          requireValue(lease.current && (same(previous, lease.current) || lease.reconnectedFrom && same(previous, lease.reconnectedFrom) || lease.renewedFrom && same(previous, lease.renewedFrom)),
            'session_mismatch', '重新连接必须匹配本页面原会话。', 401);
          // 丢失响应后，明确重试原请求返回同一会话；不再签发、不更换工作区。
          if (lease.reconnectedFrom && same(previous, lease.reconnectedFrom) && lease.current.expiresAt > clock()) return { ...lease.current };
          requireValue(lease.current.expiresAt <= clock(), 'reconnect_not_due', '当前数据会话未过期，不需要重新连接。', 409);
          const next = issue(lease), old = lease.current;
          if (lease.retired) { cancel(lease.retired.timer); service.revokeSession(lease.retired.token); }
          lease.current = next; lease.retired = null; lease.reconnectedFrom = { ...previous }; lease.renewedFrom = null;
          service.revokeSession(old.token);
          return { ...next };
        },
        close() { finish(lease, 'session_host_closed'); },
      });
    },
    close() { closed = true; for (const lease of leases) finish(lease, 'session_host_closed'); },
  });
}

// 保留稳定错误类型供进程内调用方识别；不泄露令牌、路径或底层错误。
export function sessionFailure(error) {
  return error instanceof StorageError ? error : new StorageError('session_unavailable', '受控会话暂时不可用，没有重新授权或重发保存。', 503);
}
