import { markWorkbenchStartup } from './启动计时.mjs';
import { STARTUP_FADE_DURATION } from './启动画面.mjs';

// 原生启动画面在React接管root时继续保留；实际画布提交后只淡出覆盖层。
let screen = null;
export function preserveStartupScreen(root) {
  const panel = root.querySelector('[aria-label="本机工作区启动"]');
  if (!panel) return;
  screen = panel;
  const status = panel.querySelector('.guan-startup-status');
  if (status) status.textContent = '正在恢复画布…';
}

export function finishStartupScreen() {
  const panel = screen;
  if (!panel) return false;
  screen = null;
  markWorkbenchStartup('interface-revealed');
  panel.inert = true;
  panel.setAttribute('aria-hidden', 'true');
  panel.style.pointerEvents = 'none';
  const remove = () => panel.remove();
  const view = panel.ownerDocument.defaultView;
  if (view.matchMedia?.('(prefers-reduced-motion: reduce)').matches || typeof panel.animate !== 'function') { remove(); return true; }
  try {
    const options = { duration: STARTUP_FADE_DURATION, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'both' };
    const animation = panel.animate([{ opacity: 1 }, { opacity: 0 }], options);
    const content = panel.querySelector('.guan-startup-content');
    let contentAnimation;
    try {
      contentAnimation = content?.animate([{ opacity: 1 }, { opacity: 0 }], options);
      void contentAnimation?.finished.catch(() => {});
    }
    catch { /* 覆盖层的透明度交接仍然有效。 */ }
    const finish = () => { remove(); animation.cancel(); contentAnimation?.cancel(); };
    void animation.finished.then(finish, finish);
  } catch { remove(); }
  return true;
}
