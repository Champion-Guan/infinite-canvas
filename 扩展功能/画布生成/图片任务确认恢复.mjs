// 独立后继，原确认恢复 SHA256 3909de11a30448d34909323a7b911831db36f540af1cceaf9552a1d62ce94d5f；原件保留。
import { requireValue } from '../本机存储/协议.mjs';

// 只从原卡片已有的任务身份及响应收据恢复；不创建任务、不交付图片、不访问渠道。
export function imageConfirmationTargets(productId, nodes) {
  const targets = [], seen = new Set();
  for (const node of nodes) {
    if (!['image', 'text', 'guan:prompt-variables'].includes(node.type)) continue;
    for (const task of node.metadata?.gatewayGenerationTasks || []) {
      const receipts = (node.metadata?.gatewayGenerationReceipts || []).filter(item => item.taskId === task.taskId);
      if (!receipts.length) continue;
      requireValue(receipts.length === 1 && !seen.has(task.taskId), 'generation_receipt_ambiguous', '原卡片任务收据重复，请保留画布。', 409);
      seen.add(task.taskId);
      targets.push({ id: task.taskId, productId, nodeId: node.id, responseHash: receipts[0].responseHash });
    }
  }
  return targets;
}

/** @param {{host: any, targets: any[], save: Function, serialize: Function, afterConfirmed?: (target: {id: string, productId: string, nodeId: string, responseHash: string}) => Promise<void>, isCurrent?: () => boolean}} options */
export function createImageConfirmationRecovery({ host, targets, save, serialize, afterConfirmed = async () => {}, isCurrent = () => true }) {
  const confirmed = new Set();
  let flight;
  function run() {
    if (flight) return flight;
    flight = (async () => {
      const pending = [];
      const remaining = targets.filter(target => !confirmed.has(target.id));
      if (!remaining.length || !isCurrent()) return { pending, confirmed: [...confirmed] };
      let jobs;
      try {
        requireValue(typeof host?.list === 'function' && typeof host?.confirmSaved === 'function' && remaining.every(target => target.productId === remaining[0].productId),
          'generation_confirmation_unavailable', '任务确认端口尚未就绪，请保留画布并重试。', 503);
        jobs = await host.list(remaining[0].productId);
        requireValue(Array.isArray(jobs), 'generation_ack_invalid', '任务清单响应无效，原收据保留。', 503);
      } catch { return { pending: remaining.map(target => target.id), confirmed: [...confirmed] }; }
      for (const target of targets) {
        if (!isCurrent()) break;
        if (confirmed.has(target.id)) continue;
        try {
          await serialize(target.productId, async () => {
            if (!isCurrent()) return;
            // 一次清单处理整幅画布，避免重开大量历史图片时逐任务查询；确认时客户端会再次查询原ID。
            const matches = jobs.filter(job => job?.id === target.id), current = matches[0];
            requireValue(matches.length === 1 && current.productId === target.productId && current.nodeId === target.nodeId &&
              current.state === 'succeeded' && typeof current.applied === 'boolean' && current.result?.id === target.responseHash,
            'generation_scope_mismatch', '任务与原产品、卡片或收据不符，未确认完成。', 409);
            if (!current.applied) {
              if (!isCurrent()) return;
              await save(target.productId);
              if (!isCurrent()) return;
              const { responseHash, ...task } = target;
              await host.confirmSaved(task, { responseHash });
            }
            if (isCurrent()) await afterConfirmed(target);
            if (isCurrent()) confirmed.add(target.id);
          });
        } catch {
          // 保留失败项，下一次保存恢复事件或明确点击仅重试确认；不展示端口内部错误。
          pending.push(target.id);
        }
      }
      return { pending, confirmed: [...confirmed] };
    })().finally(() => { flight = undefined; });
    return flight;
  }
  return Object.freeze({ run });
}

// 仅清理已经由调用方确认成功的原任务槽位；不触碰媒体、身份或其他失败项。
export function clearConfirmedImageErrors(nodes, target) {
  let changed = false;
  const next = nodes.map(node => {
    if (!['image', 'text'].includes(node.type) || node.id !== target.nodeId) return node;
    const tasks = (node.metadata?.gatewayGenerationTasks || []).filter(task => task.taskId === target.id);
    const receipts = (node.metadata?.gatewayGenerationReceipts || []).filter(receipt => receipt.taskId === target.id);
    if (tasks.length !== 1 || receipts.length !== 1 || receipts[0].responseHash !== target.responseHash) return node;
    const slotId = tasks[0].slotId;
    if (node.type === 'text') {
      const texts = node.metadata?.texts?.map(text => {
        if (text.id !== slotId || text.status !== 'success' || !text.content || !text.errorDetails) return text;
        changed = true;
        return { ...text, errorDetails: undefined };
      });
      const rootError = node.metadata?.status === 'success' && node.metadata?.content && node.metadata?.errorDetails &&
        (slotId === node.id || slotId === node.metadata?.primaryTextId);
      if (rootError) changed = true;
      return rootError || texts?.some((text, index) => text !== node.metadata.texts[index])
        ? { ...node, metadata: { ...node.metadata, texts, ...(rootError ? { errorDetails: undefined } : {}) } } : node;
    }
    const slots = node.metadata?.images || [];
    if (slots.filter(image => image.id === slotId).length !== 1) return node;
    let slotChanged = false;
    const images = slots.map(image => {
      if (image.id !== slotId || image.status !== 'success' || !image.content || !image.storageKey || !image.errorDetails) return image;
      changed = true;
      slotChanged = true;
      return { ...image, errorDetails: undefined };
    });
    return slotChanged ? { ...node, metadata: { ...node.metadata, images } } : node;
  });
  return changed ? next : nodes;
}

// 同一收据确认后仍可能收到原保存失败回调；新错误出现时重新核对任务，不能沿用旧confirmed缓存。
export function imageConfirmationErrorKey(nodes) {
  return JSON.stringify(nodes.filter(node => ['image', 'text'].includes(node.type)).flatMap(node => [
    ...(node.type === 'image' ? node.metadata?.images || [] : node.metadata?.texts || [])
      .filter(slot => slot.status === 'success' && slot.errorDetails).map(slot => [node.id, slot.id, slot.errorDetails]),
    ...(node.type === 'text' && node.metadata?.status === 'success' && node.metadata?.errorDetails ? [[node.id, node.metadata.errorDetails]] : []),
  ]));
}
