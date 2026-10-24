import { createHash, randomUUID } from 'node:crypto';
import { requireValue } from '../本机存储/协议.mjs';

export const NO_RESULT_ACK = 'upstream-ended-without-result';
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
// 先保存原任务与人工核实依据，再收口账本。中途失败只允许按同一原记录重试。
export function recordNoResultResolution(workspace, job, acknowledgement, confirmedAt) {
  requireValue(acknowledgement === NO_RESULT_ACK, 'generation_confirmation_required', '必须先在渠道端核实请求已结束且没有结果。', 409);
  const id = 'guan-generation-resolution:' + job.id;
  const saved = workspace.readDocument('extension', id);
  if (saved) {
    const receipt = saved.value;
    requireValue(receipt?.format === 'guan-generation-resolution.v1' && receipt.workspaceId === workspace.workspaceId &&
      receipt.basis === NO_RESULT_ACK && receipt.taskId === job.id && receipt.originalHash === digest(receipt.original) &&
      receipt.original?.id === job.id && receipt.original.requestHash === job.requestHash &&
      (job.state === 'cancelled' && job.reason === 'operator_confirmed_no_result' || receipt.originalHash === digest(job)),
    'generation_resolution_conflict', '核实凭据与原任务不符，记录已保留。', 409);
    return receipt;
  }
  requireValue(job.state === 'uncertain' && job.result === null && job.reason === 'upstream_result_unknown',
    'generation_resolution_denied', '只能核实没有已知结果的待核实任务。', 409);
  const value = { format: 'guan-generation-resolution.v1', workspaceId: workspace.workspaceId, taskId: job.id,
    basis: NO_RESULT_ACK, confirmedAt, originalHash: digest(job), original: structuredClone(job) };
  try {
    const ack = workspace.writeDocument({ collection: 'extension', id, value, expectedRevision: 0, operationId: randomUUID(), mediaIds: [] });
    requireValue(ack.persisted === true && ack.workspaceId === workspace.workspaceId && ack.id === id && ack.revision === 1 && ack.hash === digest(value),
      'generation_save_unconfirmed', '核实凭据尚未确认保存。', 503);
  } catch (error) {
    const committed = workspace.readDocument('extension', id);
    if (committed?.revision !== 1 || committed.hash !== digest(value)) throw error;
  }
  return value;
}
