import { randomUUID } from 'node:crypto';
import { requireValue } from '../本机存储/协议.mjs';
import { RETENTION_DAY } from '../本机存储/存储保留策略.mjs';

export function createStorageMaintenance({ workspace, runWrite, now = Date.now }) {
  const plans = new Map();
  let generation, flight = null;
  const retention = workspace.storageRetention;
  const emptyTasks = () => ({ signature: '', ids: [], bytes: 0 });
  function taskPreview(cutoff) { return generation?.retentionPreview(cutoff) || emptyTasks(); }
  async function preview({ mode = 'expired', automatic = false } = {}) {
    const status = retention.status(), time = now();
    requireValue(mode === 'expired' || mode === 'organize' && !automatic, 'invalid_cleanup_mode', '自动整理只处理到期内容。');
    const cutoff = mode === 'organize' ? time : time - status.policy.days * RETENTION_DAY;
    const storage = await runWrite(async () => {
      await workspace.readDetailedUsage();
      return retention.preview({ mode, days: status.policy.days });
    });
    const tasks = taskPreview(cutoff);
    const id = randomUUID(), expiresAt = time + 10 * 60_000;
    for (const [key, plan] of plans) if (plan.expiresAt < time) plans.delete(key);
    const plan = { id, mode, automatic, cutoff, storage, tasks, expiresAt, days: status.policy.days };
    if (plans.size >= 8) plans.delete(plans.keys().next().value);
    plans.set(id, plan);
    const protectedTasks = await generation?.updateBlockers?.() || [];
    return { id, mode, expiresAt, bytes: storage.bytes + tasks.bytes,
      fragmentBytes: storage.fragmentBytes, mediaBytes: storage.mediaBytes, taskBytes: tasks.bytes,
      fragments: storage.fragments, media: storage.media,
      tasks: tasks.ids.length, waiting: storage.waiting, protectedTasks: protectedTasks.length,
      protectedOwners: protectedTasks.map(task => task.productId), retentionDays: status.policy.days };
  }
  async function execute(id) {
    requireValue(!flight, 'cleanup_busy', '存储整理正在执行，请等待完成。', 409);
    const plan = plans.get(id);
    requireValue(plan && plan.expiresAt >= now(), 'cleanup_preview_expired', '整理预览已过期，请重新扫描。', 409);
    const operation = (async () => {
      if (plan.automatic) requireValue(retention.status().policy.enabled, 'cleanup_disabled', '自动整理已关闭。', 409);
      requireValue(retention.status().policy.days === plan.days, 'cleanup_preview_changed', '保留期限已改变，请重新扫描。', 409);
      requireValue(taskPreview(plan.cutoff).signature === plan.tasks.signature, 'cleanup_preview_changed', '任务状态已变化，请重新扫描。', 409);
      // 在任何删除前复核扫描后的业务版本；任务释放引用后再扫描一次物理候选。
      await runWrite(async () => { await workspace.readDetailedUsage(); return retention.verify(plan.storage.id); });
      if (plan.tasks.ids.length) await runWrite(() => retention.retireMedia(plan.tasks.mediaIds));
      const expired = plan.tasks.ids.length ? await generation.expireAppliedResults({ cutoff: plan.cutoff, signature: plan.tasks.signature }) : { tasks: 0, mediaIds: [] };
      const storage = await runWrite(() => {
        const result = retention.execute(plan.storage.id, { recheck: true });
        // 原始响应的期限已经过任务核验，不重新等待一轮“无引用90天”。
        let retiredMedia = 0;
        const retiredBytes = retention.unreferencedBytes(expired.mediaIds);
        for (let start = 0; start < expired.mediaIds.length; start += 512)
          retiredMedia += workspace.purgeMedia(expired.mediaIds.slice(start, start + 512)).deleted.length;
        return { ...result, retiredMedia, retiredBytes };
      });
      const result = { completedAt: now(), automatic: plan.automatic, mode: plan.mode, tasks: expired.tasks,
        media: storage.media + storage.retiredMedia, fragments: storage.fragments,
        bytes: storage.bytes + storage.retiredBytes };
      await runWrite(() => retention.record(result));
      plans.delete(id);
      return result;
    })();
    flight = operation;
    try { return await operation; } finally { flight = null; }
  }
  return {
    connectGeneration(value) { generation = value; },
    async command(input) {
      requireValue(retention, 'cleanup_unavailable', '当前服务尚未支持存储整理，请重启服务。', 503);
      requireValue(input && typeof input === 'object' && !Array.isArray(input), 'invalid_cleanup_command', '整理操作无效。');
      switch (input.operation) {
        case 'status': return { ...retention.status(), running: !!flight, generationRunning: generation?.getStatus?.().running || 0,
          protectedOwners: (await generation?.updateBlockers?.() || []).map(task => task.productId) };
        case 'compact':
          requireValue(!flight && !generation?.getStatus?.().running, 'cleanup_busy', '整理或生成进行中，请稍后释放空间。', 409);
          return runWrite(() => retention.compact());
        case 'configure':
          requireValue(!flight, 'cleanup_busy', '整理期间请等待完成后再修改策略。', 409);
          return runWrite(() => retention.configure(input.policy));
        case 'preview': return preview(input);
        case 'execute': return execute(input.id);
        default: requireValue(false, 'invalid_cleanup_command', '整理操作不存在。');
      }
    },
  };
}
