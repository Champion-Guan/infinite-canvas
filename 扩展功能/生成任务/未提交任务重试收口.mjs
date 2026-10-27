import { createHash } from 'node:crypto';
import { requireValue, validId, validHash } from '../本机存储/协议.mjs';
import { exactKeys, jobLike, bindingLike } from '../生成网关/生成协议.mjs';

// 仅显式重试调用。串行核对账本后封存未提交身份，阻止旧页面迟到提交。
// 不删除账本，不把已发送、待核实或待保存的任务改成失败。
export function createPreparedTaskRetirement({ mutate, active, pendingResults, workspace, clock, isClosed, maxTasks, publicJob }) {
  return async function retirePreparedTask(value) {
    requireValue(!isClosed(), 'generation_closed', '任务入口已关闭。', 503);
    requireValue(exactKeys(value, ['id', 'productId', 'nodeId', 'binding', 'requestHash']) && jobLike(value.id) &&
      validId(value.productId) && validId(value.nodeId) && bindingLike(value.binding) && validHash(value.requestHash),
    'invalid_canvas_task', '原卡片任务记录无效，没有重新生成。');
    const target = structuredClone(value);
    return mutate(jobs => {
      requireValue(!isClosed(), 'generation_closed', '任务入口已关闭。', 503);
      const existing = jobs.find(job => job.id === target.id);
      if (existing) {
        requireValue(existing.productId === target.productId && existing.nodeId === target.nodeId && existing.binding === target.binding,
          'generation_scope_mismatch', '任务不属于原产品或卡片，没有重新生成。', 409);
        return publicJob(existing);
      }
      requireValue(!active.has(target.id) && !pendingResults.has(target.id) &&
        !workspace.readDocument('extension', 'guan-fallback-attempt:' + target.id),
      'generation_admission_pending', '原任务仍在提交或存在执行记录，请稍后恢复原任务。', 409);
      // 留出下一次显式提交的位置，沿用原有有界账本，不增加无限日志。
      requireValue(jobs.length + 1 < maxTasks, 'generation_capacity', '任务记录空间已满，未发送新的生成请求。', 409);
      const time = clock();
      const job = { id: target.id, productId: target.productId, nodeId: target.nodeId, binding: target.binding,
        requestHash: createHash('sha256').update(JSON.stringify({ retiredPreparedTask: target })).digest('hex'),
        state: 'cancelled', applied: false, createdAt: time, updatedAt: time, result: null, reason: 'replaced_before_dispatch' };
      jobs.push(job);
      return publicJob(job);
    });
  };
}
