import { createHash } from 'node:crypto';
import { requireValue } from '../本机存储/协议.mjs';
import { createSavedCanvasVerifier } from '../生成任务/画布保存核验.mjs';

// 只返回非敏感的根版本与摘要，不返回配置、凭据或画布内容。
export function createCanvasCheckpointReader({ workspace, tasks }) {
  const id = 'app-' + createHash('sha256').update('app_state').digest('hex');
  const verify = createSavedCanvasVerifier({ workspace });
  return async taskId => {
    const job = tasks.get(taskId), root = workspace.readDocument('extension', id);
    requireValue(job.state === 'succeeded' && root, 'generation_canvas_unsaved', '结果还没有保存到原产品，不能确认完成。', 409);
    const checkpoint = { rootRevision: root.revision, rootHash: root.hash };
    requireValue(await verify(job, checkpoint), 'generation_canvas_unsaved', '原产品卡片或任务收据尚未保存，保留结果供重试。', 409);
    return checkpoint;
  };
}
