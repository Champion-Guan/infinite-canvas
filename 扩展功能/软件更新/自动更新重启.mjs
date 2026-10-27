const progressURL = value => typeof value === 'string' && /^http:\/\/127\.0\.0\.1:\d+\/[a-f0-9]{48}\/$/.test(value) && Number(new URL(value).port) <= 65535;

// 每个已授权页面排空自己的编辑队列，再离开到只读进度页。后台服务仍核实全部页面与任务。
export function bindAutomaticUpdateRestart({ view, updatePort, host, flush }) {
  let stopped = false, busy = false, failed = false, timer;
  const channel = typeof view.BroadcastChannel === 'function' ? new view.BroadcastChannel('guan-workbench-update') : null;
  const prepare = async url => {
    if (stopped || busy || failed || !progressURL(url)) return false;
    busy = true;
    const document = view.document, panel = document.createElement('dialog'), text = document.createElement('p');
    panel.setAttribute('aria-label', '正在准备更新'); text.setAttribute('role', 'status');
    text.textContent = '正在保存画布并准备更新，请稍候…'; panel.append(text); document.body.append(panel); panel.showModal();
    const cancel = event => event.preventDefault(); panel.addEventListener('cancel', cancel);
    try {
      await flush();
      await host.close();
      view.location.replace(url); return true;
    } catch {
      failed = true;
      text.textContent = '更新前保存尚未确认，已保留当前画布。请返回画布处理保存提示后重试。';
      const button = document.createElement('button'); button.type = 'button'; button.textContent = '返回画布'; panel.append(button);
      button.addEventListener('click', () => { panel.close(); panel.remove(); }, { once: true });
      return false;
    } finally { busy = false; }
  };
  const check = async supplied => {
    if (stopped || busy || failed) return false;
    try {
      const status = await updatePort.request('status');
      if (status.install?.state === 'source-development') { view.clearInterval(timer); return false; }
      if (status.install?.state !== 'awaiting-browser-exit') return false;
      const { url } = supplied && progressURL(supplied) ? { url: supplied } : await updatePort.request('progress-window');
      return await prepare(url);
    } catch { return false; }
  };
  const notify = async url => { if (!progressURL(url)) return false; channel?.postMessage('confirmed'); failed = false; return check(url); };
  Object.defineProperty(view, '__guanAutomaticUpdateRestart', { value: notify });
  if (channel) channel.onmessage = message => { if (message.data === 'confirmed') void check(); };
  timer = view.setInterval(() => { void check(); }, 30000);
  const cleanup = () => { stopped = true; view.clearInterval(timer); channel?.close(); };
  view.addEventListener('pagehide', cleanup, { once: true });
  return cleanup;
}
