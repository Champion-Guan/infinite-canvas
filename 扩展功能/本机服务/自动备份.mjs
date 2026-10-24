import { basename, isAbsolute } from 'node:path';
import { StorageError, requireValue, validUUID } from '../本机存储/协议.mjs';

const reasons = new Set(['startup', 'periodic', 'manual', 'before-maintenance']);
const failureCodes = new Set(['insufficient_space', 'workspace_busy', 'workspace_closed', 'media_corrupt', 'media_not_found', 'unsafe_path', 'invalid_backup_receipt', 'invalid_clock']);

// 仅接受可信进程内的备份能力。不开放HTTP接口、不自动恢复/清锁/删旧备份。
// start成功后才可由未来启动器开放工作区；本模块本身不启动或关闭业务服务。
export function createBackupCoordinator({ workspaceId, createBackup, interval = 15 * 60_000, now = Date.now, schedule = setTimeout, cancel = clearTimeout, onStatus = () => {} } = {}) {
  requireValue(validUUID(workspaceId) && typeof createBackup === 'function' && Number.isSafeInteger(interval) && interval >= 60_000 && interval <= 24 * 60 * 60_000 &&
    typeof now === 'function' && typeof schedule === 'function' && typeof cancel === 'function' && typeof onStatus === 'function', 'invalid_backup_config', '自动备份配置无效。');
  let running = false, stopping = false, flight = null, timer = null, nextAttemptAt = null, lastBackup = null, lastError = null, attempts = 0;
  function clock() { const value = now(); requireValue(Number.isSafeInteger(value) && value >= 0, 'invalid_clock', '自动备份时钟无效。'); return value; }
  clock();
  function status() {
    return { state: lastError ? 'error' : flight ? 'backing-up' : running ? 'ready' : 'stopped', running, stopping, pending: !!flight, attempts, nextAttemptAt,
      lastBackup: lastBackup ? { ...lastBackup } : null, error: lastError ? { ...lastError } : null };
  }
  function notify() { try { onStatus(status()); } catch { /* 订阅者不决定备份结果。 */ } }
  function unschedule() { if (timer !== null) cancel(timer); timer = null; nextAttemptAt = null; }
  function arm() {
    if (!running || stopping || lastError) return;
    nextAttemptAt = clock() + interval;
    timer = schedule(() => {
      timer = null; nextAttemptAt = null;
      if (running && !stopping) request('periodic').catch(() => {}); // 错误留在状态，暂停自动重试。
    }, interval);
    timer?.unref?.();
  }
  function failure(error) {
    const code = failureCodes.has(error?.code) ? error.code : 'backup_failed';
    return new StorageError(code, '本机备份未完成；此前备份和工作区均保留，请检查后手动重试。', 503);
  }
  function request(reason = 'manual') {
    requireValue(reasons.has(reason), 'invalid_backup_reason', '备份原因无效。');
    requireValue(running && !stopping, 'backup_not_running', '备份调度未启动或正在停止。', 409);
    if (flight) return flight;
    unschedule(); attempts++;
    // 先发布single-flight，再调用可能同步抛错的备份能力。
    const task = Promise.resolve().then(async () => {
      try {
        const receipt = await createBackup();
        requireValue(receipt?.workspaceId === workspaceId && typeof receipt.path === 'string' && isAbsolute(receipt.path) && validUUID(basename(receipt.path)) &&
          Number.isSafeInteger(receipt.documentCount) && receipt.documentCount >= 0 && Number.isSafeInteger(receipt.mediaCount) && receipt.mediaCount >= 0,
        'invalid_backup_receipt', '备份没有返回匹配工作区的完成回执。');
        // 仅发布不含本机路径的摘要，不能将开始时间当作完成时间。
        lastBackup = Object.freeze({ workspaceId, backupId: basename(receipt.path), documentCount: receipt.documentCount, mediaCount: receipt.mediaCount, completedAt: clock(), reason });
        lastError = null;
        arm();
        return { ...lastBackup };
      } catch (error) {
        unschedule();
        const safe = failure(error); lastError = { code: safe.code, message: safe.message };
        if (reason === 'startup') running = false;
        throw safe;
      } finally {
        flight = null;
        notify();
      }
    });
    flight = task; notify();
    return task;
  }
  return Object.freeze({
    getStatus: status,
    start() {
      requireValue(!stopping, 'backup_stopping', '正在停止备份调度。', 409);
      if (running) return flight ?? (lastError ? request('manual') : Promise.resolve(lastBackup ? { ...lastBackup } : null));
      running = true;
      return request('startup');
    },
    request,
    async stop() {
      requireValue(!stopping, 'backup_stopping', '正在停止备份调度。', 409);
      stopping = true; running = false; unschedule(); notify();
      try { if (flight) await flight; }
      finally { stopping = false; notify(); }
      return status();
    },
  });
}
