export const STARTUP_FADE_DURATION = 220;

// 启动样式随原节点保留到交接结束，不受稍后加载的全局reset与主题变量影响。
export function createStartupScreen(document) {
  const panel = document.createElement('section');
  panel.className = 'guan-startup';
  panel.setAttribute('aria-label', '本机工作区启动');
  const style = document.createElement('style');
  style.textContent = `
.guan-startup{box-sizing:border-box;position:fixed;inset:0;z-index:10000;display:grid;place-items:center;overflow:hidden;padding:24px;background:#f7f7f5;color:#242424;font:400 13px/1.6 -apple-system,BlinkMacSystemFont,"SF Pro Text","PingFang SC","Microsoft YaHei",sans-serif;transition:background-color ${STARTUP_FADE_DURATION}ms ease,color ${STARTUP_FADE_DURATION}ms ease}
.dark .guan-startup{background:#18181b;color:#f4f4f5}
.guan-startup-content{position:absolute;left:50%;top:50%;top:round(nearest,50%,1px);translate:-50% -50%;display:flex;flex-direction:column;align-items:center;max-width:calc(100% - 48px);width:320px;text-align:center;animation:guan-startup-enter 240ms cubic-bezier(.22,1,.36,1) both}
.guan-startup-brand{display:flex;align-items:center;justify-content:center;gap:14px;max-width:100%}
.guan-startup-logo{display:block;flex:none;width:52px;height:52px;object-fit:contain}
.guan-startup-title{margin:0;font-size:24px;font-weight:600;line-height:34px;letter-spacing:0;white-space:nowrap}
.guan-startup-status{box-sizing:border-box;min-height:36px;margin:20px 0 0;max-width:100%;font-size:13px;font-weight:400;line-height:20px;color:#848480;overflow-wrap:anywhere}
.dark .guan-startup-status{color:#a1a1aa}
.guan-startup-track{position:relative;width:88px;height:2px;overflow:hidden;border-radius:2px;background:#dededb}
.dark .guan-startup-track{background:#3f3f46}
.guan-startup-runner{display:block;width:32px;height:100%;border-radius:2px;background:#1685f8;animation:guan-startup-travel 1.45s ease-in-out infinite}
.dark .guan-startup-runner{background:#65adff}
.guan-startup-retry{margin-top:20px;padding:8px 16px;border:1px solid #a1a1aa;border-radius:6px;background:transparent;color:inherit;font:inherit;cursor:pointer}
.guan-startup-retry[hidden]{display:none}
.guan-startup-retry:focus-visible{outline:2px solid #0a84ff;outline-offset:4px}
.guan-startup[data-state="error"] .guan-startup-logo,.guan-startup[data-state="error"] .guan-startup-runner{animation:none}
.guan-startup[data-state="error"] .guan-startup-track{visibility:hidden}
@keyframes guan-startup-enter{from{opacity:0}to{opacity:1}}
@keyframes guan-startup-travel{0%{transform:translateX(-32px)}100%{transform:translateX(88px)}}
@media(max-width:360px){.guan-startup-logo{width:40px;height:40px}.guan-startup-title{font-size:18px;line-height:28px}.guan-startup-brand{gap:10px}}
@media(prefers-reduced-motion:reduce){.guan-startup{transition:none}.guan-startup-content,.guan-startup-logo,.guan-startup-runner{animation:none}.guan-startup-runner{transform:translateX(28px)}}`;
  const content = document.createElement('div');
  content.className = 'guan-startup-content';
  const brand = document.createElement('div');
  brand.className = 'guan-startup-brand';
  const logo = document.createElement('img');
  logo.className = 'guan-startup-logo'; logo.src = '/guan/首页原样资源/工作台Logo.png'; logo.alt = ''; logo.width = 52; logo.height = 52;
  const title = document.createElement('h1');
  title.className = 'guan-startup-title'; title.textContent = 'AI-Workbench';
  const status = document.createElement('p');
  status.className = 'guan-startup-status';
  status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  status.textContent = '正在打开本机工作区…';
  const track = document.createElement('div'), runner = document.createElement('span');
  track.className = 'guan-startup-track'; track.setAttribute('aria-hidden', 'true');
  runner.className = 'guan-startup-runner'; track.append(runner);
  const retry = document.createElement('button');
  retry.className = 'guan-startup-retry'; retry.type = 'button'; retry.textContent = '重新打开工作台'; retry.hidden = true;
  retry.addEventListener('click', () => document.defaultView.location.reload());
  brand.append(logo, title);
  content.append(brand, status, track, retry); panel.append(style, content);
  return { panel, status, retry };
}
