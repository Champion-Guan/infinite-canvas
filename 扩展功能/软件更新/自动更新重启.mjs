const progressURL = value => typeof value === 'string' && /^http:\/\/127\.0\.0\.1:\d+\/[a-f0-9]{48}\/$/.test(value) && Number(new URL(value).port) <= 65535;

// 每个已授权页面排空自己的编辑队列，再离开到只读进度页。后台服务仍核实全部页面与任务。
export function bindAutomaticUpdateRestart({ view, updatePort, host, flush, now = Date.now, idleMs = 60_000 }) {
  let stopped = false, busy = false, failed = false, leaving = false, timer, checking = null, preparation = null, pressed = false, epoch = 0;
  let exitPanel = null, retryExit = null, retryAt = 0, exitFailures = 0, retryButton = null;
  let lastActivity = now(), nextCheck = 0;
  const channel = typeof view.BroadcastChannel === 'function' ? new view.BroadcastChannel('guan-workbench-update') : null;
  const removePreparation = () => { preparation?.panel.close(); preparation?.panel.remove(); preparation = null; };
  const panelFor = () => {
    const document = view.document, panel = document.createElement('dialog'), text = document.createElement('p');
    panel.setAttribute('aria-label', '正在准备更新'); text.setAttribute('role', 'status');
    panel.addEventListener('cancel', event => event.preventDefault());
    text.textContent = '正在保存画布并准备更新，请稍候…'; panel.append(text); document.body.append(panel); panel.showModal();
    return { panel, text, prepared: false };
  };
  const prepare = async url => {
    if (stopped || busy || failed || preparation?.cancelled || !progressURL(url)) return false;
    busy = true;
    const started = epoch;
    const { panel, text } = exitPanel ||= preparation || panelFor();
    retryButton?.remove(); retryButton = null;
    try {
      if (!leaving && !preparation?.prepared) await flush();
      if (stopped || started !== epoch) return false;
      leaving = true;
      try { await host.close(); }
      catch (error) {
        if (error?.code !== 'authorization_connection_failed') throw error;
        await host.close();
      }
      retryExit = null;
      view.location.replace(url); return true;
    } catch {
      failed = !leaving;
      if (leaving) {
        retryExit = url;
        retryAt = now() + Math.min(2000 * 2 ** Math.min(exitFailures++, 3), 15_000);
      }
      text.textContent = leaving ? '画布已保存，正在自动重试退出并继续安装…'
        : '更新前保存尚未确认，已保留当前画布。请返回画布处理保存提示后重试。';
      const button = view.document.createElement('button'); button.type = 'button'; button.textContent = leaving ? '重试继续安装' : '返回画布'; panel.append(button);
      retryButton = button;
      button.addEventListener('click', () => {
        if (leaving) { retryAt = 0; void check(); }
        else { panel.close(); panel.remove(); exitPanel = null; }
      }, { once: true });
      return false;
    } finally { busy = false; }
  };
  const pageState = () => {
    const active = view.document.activeElement;
    const editing = active?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(active?.tagName);
    const ready = !preparation?.cancelled && view.__guanReadUpdateState?.()?.ready === true && Boolean(preparation?.prepared || !pressed && !editing);
    return { ready, idle: Boolean(preparation || now() - lastActivity >= idleMs),
      prepared: Boolean(preparation?.prepared && ready), error: false, version: preparation?.version ?? null };
  };
  const runCheck = async supplied => {
    if (stopped || busy || failed) return false;
    // close 已封住业务端口，不能再查询授权状态；只用原关闭能力重试释放。
    if (retryExit) return now() >= retryAt ? prepare(retryExit) : false;
    try {
      let status = await updatePort.request('status');
      if (status.install?.state === 'source-development') { view.clearInterval(timer); return false; }
      if (status.install?.coordination && status.install.state !== 'awaiting-browser-exit') {
        status = await updatePort.request('activity', pageState());
        const coordination = status.install?.coordination;
        if (preparation && preparation.version !== coordination?.targetVersion) removePreparation();
        nextCheck = now() + (coordination?.mode ? 2000 : 30_000);
        if (coordination?.state === 'preparing' && pageState().ready && (coordination.mode === 'manual' || pageState().idle)) {
          if (!preparation) {
            preparation = { ...panelFor(), version: coordination.targetVersion };
            const cancel = event => {
              event.preventDefault(); epoch++; preparation.cancelled = true; preparation.prepared = false;
              void updatePort.request('defer').then(removePreparation).catch(() => {
                if (preparation) preparation.text.textContent = '暂缓安装尚未确认，请重试。当前画布仍保留。';
              });
            };
            preparation.panel.addEventListener('cancel', cancel);
            const button = view.document.createElement('button'); button.type = 'button'; button.textContent = '稍后安装';
            button.addEventListener('click', cancel); preparation.panel.append(button);
            try {
              const started = epoch;
              await flush();
              if (stopped || started !== epoch || !preparation) return false;
              preparation.prepared = true;
              status = await updatePort.request('activity', pageState());
            } catch {
              await updatePort.request('activity', { ...pageState(), prepared: false, error: true }).catch(() => {});
              removePreparation(); return false;
            }
          }
        } else if (status.install?.state !== 'awaiting-browser-exit') removePreparation();
      }
      if (status.install?.state !== 'awaiting-browser-exit') return false;
      if (status.install.coordination && !pageState().ready) return false;
      const { url } = supplied && progressURL(supplied) ? { url: supplied } : await updatePort.request('progress-window');
      return await prepare(url);
    } catch { return false; }
  };
  const check = supplied => {
    if (checking) return checking;
    checking = runCheck(supplied).finally(() => { checking = null; });
    return checking;
  };
  const activity = event => {
    if (preparation) return;
    lastActivity = now();
    if (event?.type === 'pointerdown') pressed = true;
    if (['pointerup', 'pointercancel', 'blur'].includes(event?.type)) pressed = false;
  };
  const events = ['pointerdown', 'pointerup', 'pointercancel', 'keydown', 'input', 'wheel', 'blur'];
  for (const event of events) view.addEventListener(event, activity, { passive: true, capture: true });
  const wake = () => { nextCheck = 0; void check(); };
  const notify = async url => { if (!progressURL(url)) return false; channel?.postMessage('confirmed'); failed = false; return check(url); };
  Object.defineProperty(view, '__guanAutomaticUpdateRestart', { value: notify });
  view.addEventListener('guan:update-requested', wake);
  if (channel) channel.onmessage = message => { if (message.data === 'confirmed') wake(); };
  timer = view.setInterval(() => { if (retryExit || now() >= nextCheck) void check(); }, 2000);
  const cleanup = () => {
    stopped = true; epoch++; view.clearInterval(timer); channel?.close(); removePreparation();
    for (const event of events) view.removeEventListener?.(event, activity, { capture: true });
    view.removeEventListener?.('guan:update-requested', wake);
  };
  view.addEventListener('pagehide', cleanup, { once: true });
  return cleanup;
}
