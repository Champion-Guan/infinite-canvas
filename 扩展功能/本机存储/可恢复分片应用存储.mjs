import { createShardedApplicationStorage as createApplicationStorage } from './分片应用存储.mjs';
import { APP_NAMESPACES } from './应用存储适配.mjs';
import { StorageError, requireValue } from './协议.mjs';

// 在旧适配器外记录尚未确认的不可变操作；原适配器、协议和历史批准来源不改。
// 仅页内内存，不是崩溃后可恢复的离线队列，错误期间不能刷新/关闭页面。
export function createRecoverableShardedApplicationStorage(options) {
  const spaces = new Map(), listeners = new Set();
  let base, flight = null, closed = false, everSaved = false, reads = 0;
  function state(name) {
    requireValue(!closed && APP_NAMESPACES.includes(name), 'namespace_denied', '未声明的应用存储命名空间。');
    if (!spaces.has(name)) spaces.set(name, { name, queue: [], running: null, error: null });
    return spaces.get(name);
  }
  function status() {
    const active = [...spaces.values()], failed = active.filter(space => space.error);
    const pending = active.reduce((sum, space) => sum + space.queue.length, 0) + reads;
    const baseStatus = base?.getStatus();
    return { state: failed.length || baseStatus?.state === 'error' ? 'error' : pending ? 'saving' : everSaved ? 'saved' : 'idle', pending,
      errors: [...new Set([...failed.map(space => space.name), ...(baseStatus?.errors ?? [])])], retrying: !!flight,
      failures: [...(baseStatus?.failures ?? []), ...failed.filter(space => !baseStatus?.failures?.some(item => item.namespace === space.name))
        .map(space => ({ namespace: space.name, code: /^[a-z_]{3,64}$/.test(space.error?.code) ? space.error.code : 'save_unconfirmed', stage: 'prepare', status: null }))] };
  }
  function notify() {
    const value = status();
    for (const callback of [options.onStatus, ...listeners]) { try { callback?.(value); } catch { /* UI异常不能决定保存结果。 */ } }
  }
  base = createApplicationStorage({ ...options, onStatus: notify });
  function rejectPending(space, error) {
    for (const item of space.queue) if (!item.settled) { item.settled = true; item.reject(error); }
  }
  function finish(space, item) {
    requireValue(space.queue[0] === item, 'queue_changed', '保存队列顺序异常，停止提交。');
    space.queue.shift(); space.error = null; everSaved = true;
    if (!item.settled) { item.settled = true; item.resolve(item.result); }
    notify();
  }
  function pump(space, recover = false) {
    if (space.running) return space.running;
    const run = (async () => {
      // 先让running被赋值，避免同步订阅器重入导致并行提交。
      await Promise.resolve();
      while (space.queue.length) {
        if (space.error && !recover) break;
        const item = space.queue[0];
        try {
          if (space.error) {
            // 已发送却无ACK时，旧适配器保留原operationId及原请求；绝不生成新ID覆盖。
            try { await base.retry(space.name); }
            catch (error) { if (error.code !== 'nothing_to_retry') throw error; await item.invoke(); }
          } else await item.invoke();
          recover = false; finish(space, item);
        } catch (error) {
          space.error = error; rejectPending(space, error); notify(); break;
        }
      }
    })();
    space.running = run;
    run.finally(() => {
      space.running = null; notify();
      // finish先唤醒调用方，调用方可能在finally清理前立即追加操作；不能搁置该队尾。
      if (space.queue.length && !space.error) void pump(space);
    });
    return run;
  }
  function enqueue(space, prepare, result) {
    let invoke;
    try { invoke = prepare(); } catch (error) { invoke = async () => { throw error; }; }
    let resolve, reject;
    const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
    // 持久化调用方可能不await，但失败仍保留在队列及可见状态中。
    promise.catch(() => {});
    space.queue.push({ invoke, resolve, reject, result, settled: false });
    if (space.error) rejectPending(space, new StorageError('pending_write_unresolved', '编辑已保留在本页内存；请先重试未确认保存，不要刷新或关闭。', 409));
    else void pump(space);
    notify(); return promise;
  }
  function createInstance(options = {}) {
    const instance = base.createInstance(options), space = state(options.storeName ?? 'app_state');
    async function read(method, args) {
      requireValue(!space.queue.length, 'pending_write_unresolved', '仍有未确认编辑，不读取旧值覆盖当前内容。', 409);
      reads++; notify();
      try { return await instance[method](...args); } finally { reads--; notify(); }
    }
    return {
      getItem: key => read('getItem', [key]), keys: () => read('keys', []), length: () => read('length', []), iterate: callback => read('iterate', [callback]),
      setItem(key, value) {
        return enqueue(space, () => { const snapshot = structuredClone(value); return () => instance.setItem(key, snapshot); }, value);
      },
      removeItem: key => enqueue(space, () => () => instance.removeItem(key)),
      clear: () => enqueue(space, () => () => instance.clear()),
    };
  }
  async function settle() {
    while ([...spaces.values()].some(space => space.running)) await Promise.all([...spaces.values()].map(space => space.running));
  }
  return Object.freeze({
    createInstance, getStatus: status, readUsage: () => base.readUsage(),
    subscribe(callback) {
      requireValue(typeof callback === 'function', 'invalid_listener', '保存状态订阅器无效。');
      listeners.add(callback); try { callback(status()); } catch { /* 同其他状态通知一致。 */ }
      return () => listeners.delete(callback);
    },
    retryPending() {
      requireValue(!closed, 'client_closed', '应用存储已关闭。');
      if (!flight) {
        flight = (async () => {
          await settle();
          await Promise.all([...spaces.values()].map(space => pump(space, true)));
          requireValue(![...spaces.values()].some(space => space.queue.length || space.error), 'save_not_confirmed', '仍有保存未确认，编辑保留在本页，请勿刷新或关闭。', 409);
          await base.flush(); return status();
        })();
        flight.then(() => { flight = null; notify(); }, () => { flight = null; notify(); });
        notify();
      }
      return flight;
    },
    async flush() {
      await settle();
      requireValue(![...spaces.values()].some(space => space.queue.length || space.error), 'save_not_confirmed', '仍有未确认编辑，不能报告已保存。', 409);
      await base.flush(); return status();
    },
    close() {
      requireValue(!flight && !reads && ![...spaces.values()].some(space => space.running || space.queue.length || space.error), 'save_not_confirmed', '尚有未确认编辑，不能关闭应用存储。', 409);
      base.close(); closed = true; listeners.clear();
    },
  });
}
