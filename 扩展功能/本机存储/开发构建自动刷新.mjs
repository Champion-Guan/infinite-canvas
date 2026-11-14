// 构建版本来自启动器交付的HTML；客户安装版没有标记，也不会建立连接。
export function bindDevelopmentReload({ view, flush }) {
  const current = view.document.querySelector('meta[name="guan-development-version"]')?.getAttribute('content');
  if (!/^[a-f0-9]{64}$/.test(current || '') || typeof view.EventSource !== 'function') return () => {};
  let stopped = false, pending = false, saving = false, leaving = false, pressed = false, composing = false, timer, failure = null;
  const stream = new view.EventSource('/__guan_dev/events');
  const schedule = () => {
    if (!stopped && pending && !leaving && timer === undefined) timer = view.setTimeout(check, 200);
  };
  const ready = () => {
    const active = view.document.activeElement;
    return !pressed && !composing && !active?.isContentEditable && !['INPUT', 'TEXTAREA', 'SELECT'].includes(active?.tagName)
      && ![...view.document.querySelectorAll('dialog[open], [role="dialog"], [aria-modal="true"]')]
        .some(panel => panel.getClientRects().length > 0)
      && !view.document.querySelector('[data-canvas-selection-toolbar][aria-busy="true"]')
      && view.__guanReadUpdateState?.()?.ready === true;
  };
  const showFailure = () => {
    if (failure) return;
    failure = view.document.createElement('div'); failure.setAttribute('role', 'status');
    failure.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483647;background:var(--background,#fff);color:var(--foreground,#222);padding:12px 18px;border:1px solid #aaa;border-radius:8px;box-shadow:0 4px 16px #0002;font:14px/1.5 sans-serif;';
    failure.textContent = '新版已就绪，当前编辑保存未完成，正在自动重试…'; view.document.body.append(failure);
  };
  async function check() {
    timer = undefined;
    if (stopped || !pending || saving || leaving) return;
    if (!ready()) { schedule(); return; }
    saving = true;
    const root = view.document.getElementById('root');
    const wasInert = root?.inert;
    try {
      // 排空期间禁止新编辑；页面队列和SQLite均确认后才重新获取最新HTML。
      if (root) root.inert = true;
      await flush();
      if (stopped) return;
      if (view.__guanReadUpdateState?.()?.ready !== true) return;
      leaving = true; failure?.remove(); failure = null;
      view.location.reload();
    } catch { showFailure(); }
    finally {
      if (root && !leaving) root.inert = wasInert;
      saving = false;
      if (!leaving && !stopped) {
        // 保存失败间隔重试；仍使用原保存队列，不重新发起业务任务。
        timer = view.setTimeout(check, failure ? 2000 : 200);
      }
    }
  }
  stream.onmessage = event => {
    try {
      const { version } = JSON.parse(event.data);
      if (!/^[a-f0-9]{64}$/.test(version) || version === current) return;
      pending = true; schedule();
    } catch { /* 连接中断由EventSource重连，握手总是返回当前成功构建。 */ }
  };
  const activity = event => {
    if (event.type === 'pointerdown') pressed = true;
    if (['pointerup', 'pointercancel', 'blur'].includes(event.type)) pressed = false;
    if (event.type === 'compositionstart') composing = true;
    if (event.type === 'compositionend') composing = false;
    schedule();
  };
  const events = ['pointerdown', 'pointerup', 'pointercancel', 'blur', 'focusout', 'compositionstart', 'compositionend'];
  for (const event of events) view.addEventListener(event, activity, { capture: true, passive: true });
  const cleanup = () => {
    stopped = true; stream.close(); view.clearTimeout(timer); failure?.remove();
    for (const event of events) view.removeEventListener(event, activity, { capture: true });
    view.removeEventListener('pagehide', cleanup);
  };
  view.addEventListener('pagehide', cleanup, { once: true });
  return cleanup;
}
