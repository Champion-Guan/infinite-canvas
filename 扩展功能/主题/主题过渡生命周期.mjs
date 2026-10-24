// 只管理主题切换的浏览器过渡；形状、起点和主题状态由原组件提供。
let active = null;
let latest = null;
export function runThemeTransition({ apply, clipPath, duration = 400, easing = 'ease-in-out', document = globalThis.document, window = globalThis.window }) {
  const request = {};
  latest = request;
  active?.skipTransition?.();
  const root = document.documentElement;
  const clear = () => {
    delete root.dataset.magicuiThemeVt;
    root.style.removeProperty('--magicui-theme-toggle-vt-duration');
    root.style.removeProperty('--magicui-theme-vt-clip-from');
  };
  clear();
  if (typeof document.startViewTransition !== 'function' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    active = null; apply(); return Promise.resolve(false);
  }
  root.dataset.magicuiThemeVt = 'active';
  root.style.setProperty('--magicui-theme-toggle-vt-duration', `${duration}ms`);
  root.style.setProperty('--magicui-theme-vt-clip-from', clipPath[0]);
  let applied = false;
  const update = () => { if (!applied && latest === request) { applied = true; apply(); } };
  let transition;
  try { transition = document.startViewTransition(update); }
  catch { clear(); update(); return Promise.resolve(false); }
  active = transition;
  const cleanup = () => { if (active === transition) { active = null; clear(); } };
  // 两个promise均消费拒绝，快速重复点击或浏览器跳过动画时不会产生未处理错误。
  void Promise.resolve(transition.finished).then(cleanup, cleanup);
  return Promise.resolve(transition.ready).then(() => {
    if (active !== transition) return false;
    root.animate({ clipPath }, { duration, easing, fill: 'forwards', pseudoElement: '::view-transition-new(root)' });
    return true;
  }).catch((error) => {
    if (active === transition && error?.name !== 'AbortError') console.warn('[主题过渡] 浏览器跳过动画', error);
    update(); cleanup(); return false;
  });
}
