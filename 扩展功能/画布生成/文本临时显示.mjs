// 展示层专用。不会进入节点事务、撤销历史、导出或SQLite；原任务ID决定显示归属。
const nodes = new Map(), listeners = new Map();
const notify = nodeId => { for (const fn of [...(listeners.get(nodeId) || [])]) fn(); };
export function publishTextPreview({ nodeId, taskId, slotId, text }) {
  const previous = nodes.get(nodeId);
  if (previous?.get(taskId)?.text === text) return;
  const next = new Map(previous); next.set(taskId, Object.freeze({ taskId, slotId, text })); nodes.set(nodeId, next); notify(nodeId);
}
export function clearTextPreview(nodeId, taskId) {
  const previous = nodes.get(nodeId);
  if (!previous?.has(taskId)) return;
  const next = new Map(previous); next.delete(taskId);
  if (next.size) nodes.set(nodeId, next); else nodes.delete(nodeId);
  notify(nodeId);
}
export const textPreviewSnapshot = nodeId => nodes.get(nodeId) || null;
export function subscribeTextPreview(nodeId, listener) {
  if (!listeners.has(nodeId)) listeners.set(nodeId, new Set());
  listeners.get(nodeId).add(listener);
  return () => { const set = listeners.get(nodeId); set?.delete(listener); if (!set?.size) listeners.delete(nodeId); };
}
