// 仅记录阶段与耗时，留在当前DOM中；不含产品内容、凭据或持久化写入。
export function markWorkbenchStartup(stage) {
  if (typeof document === 'undefined' || typeof performance === 'undefined') return;
  const root = document.getElementById('root');
  if (!root) return;
  const attribute = `data-startup-${stage}`;
  if (!root.hasAttribute(attribute)) root.setAttribute(attribute, performance.now().toFixed(1));
}
