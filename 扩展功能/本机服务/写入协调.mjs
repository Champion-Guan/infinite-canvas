import { StorageError, requireValue } from '../本机存储/协议.mjs';

// 只串行化进程内已经接收的写入和备份，不代表所有页面已保存。
// 读取不经过本队列；运行中的操作不强行超时，以免把已经提交的结果说成取消。
export function createWriteCoordinator({ maxQueued = 8, maxWait = 5_000, schedule = setTimeout, cancel = clearTimeout, onStatus = () => {} } = {}) {
  requireValue(Number.isSafeInteger(maxQueued) && maxQueued >= 1 && maxQueued <= 32 && Number.isSafeInteger(maxWait) && maxWait >= 1 && maxWait <= 10_000 &&
    typeof schedule === 'function' && typeof cancel === 'function' && typeof onStatus === 'function', 'invalid_write_coordinator', '写入协调配置无效。');
  const queue = [];
  let active = null, closing = false, closed = false, closePromise = null, finishClose;
  function status() {
    return { state: closed ? 'closed' : closing ? 'closing' : active?.kind === 'backup' ? 'backing-up' : active ? 'writing' : 'idle',
      queuedWrites: queue.filter(entry => entry.kind === 'write').length, queuedBackups: queue.filter(entry => entry.kind === 'backup').length, activeKind: active?.kind ?? null, maxQueued };
  }
  function notify() { try { onStatus(status()); } catch { /* 观察者不能改变提交结果。 */ } }
  function cleanup(entry) {
    if (entry.timer !== null) { try { cancel(entry.timer); } catch { /* 延迟回调仍会核验条目是否在队列中。 */ } }
    entry.timer = null;
    if (entry.abort) entry.signal.removeEventListener('abort', entry.abort);
    entry.abort = null;
  }
  function rejectQueued(entry, error) {
    const index = queue.indexOf(entry);
    if (index < 0) return;
    queue.splice(index, 1); cleanup(entry); entry.reject(error); notify();
  }
  function drain() {
    if (active) return;
    if (closing) { closed = true; finishClose?.(); notify(); return; }
    const entry = queue.shift();
    if (!entry) { notify(); return; }
    active = entry; cleanup(entry); notify();
    Promise.resolve().then(() => {
      requireValue(!entry.signal?.aborted, 'write_cancelled', '尚未开始的本机操作已取消，没有提交。', 409);
      return entry.operation();
    }).then(entry.resolve, entry.reject).finally(() => { active = null; drain(); });
  }
  function submit(kind, operation, { signal } = {}) {
    if (closing || closed) return Promise.reject(new StorageError('write_gate_closed', '本机写入协调正在关闭，没有接收新操作。', 503));
    if (typeof operation !== 'function' || signal !== undefined && !(signal instanceof AbortSignal)) return Promise.reject(new StorageError('invalid_write_operation', '本机操作或取消信号无效。'));
    if (signal?.aborted) return Promise.reject(new StorageError('write_cancelled', '尚未开始的本机操作已取消，没有提交。', 409));
    if (active && queue.length >= maxQueued) return Promise.reject(new StorageError('write_queue_full', '等待保存的操作已满，没有接收本次提交；请稍后用相同操作ID重试。', 503));
    return new Promise((resolve, reject) => {
      const entry = { kind, operation, resolve, reject, signal, abort: null, timer: null };
      queue.push(entry);
      if (active) {
        try {
          entry.timer = schedule(() => rejectQueued(entry, new StorageError('write_wait_timeout', '等待本机操作超时，本次排队操作尚未提交；请用相同操作ID重试。', 503)), maxWait);
          if (signal) { entry.abort = () => rejectQueued(entry, new StorageError('write_cancelled', '尚未开始的本机操作已取消，没有提交。', 409)); signal.addEventListener('abort', entry.abort, { once: true }); }
        } catch {
          rejectQueued(entry, new StorageError('write_queue_unavailable', '本机写入等待机制不可用，没有接收本次提交。', 503)); return;
        }
      }
      drain(); notify();
    });
  }
  return Object.freeze({
    getStatus: status,
    runWrite: (operation, options) => submit('write', operation, options),
    runBackup: (operation, options) => submit('backup', operation, options),
    close() {
      if (closePromise) return closePromise;
      closing = true;
      closePromise = new Promise(resolve => { finishClose = resolve; });
      for (const entry of [...queue]) rejectQueued(entry, new StorageError('write_gate_closed', '服务正在关闭，排队操作尚未提交；请使用相同操作ID重试。', 503));
      drain(); notify(); return closePromise;
    },
  });
}
