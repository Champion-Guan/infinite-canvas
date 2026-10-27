import { createFallbackClient } from '../故障切换/切换客户端.mjs';
import { authorizeLocalStorage } from './本机授权客户端.mjs';
import { bindPageAuthorization } from './页面授权生命周期.mjs';
import { createRenewingDataClient } from './续期数据客户端.mjs';
import { createRecoverableShardedApplicationStorage as createApplicationStorage } from './可恢复分片应用存储.mjs';
import { bindAutomaticUpdateRestart } from '../软件更新/自动更新重启.mjs';

// 用户不再填码。只消费当前本机启动器交付的一次性握手材料，立即从DOM移除。
// 这不是匿名数据访问：Host/Origin、短期票据、会话及CSRF仍由既有模块核验。
export function mountAutomaticWorkbench({ root, origin = location.origin, loadApplication = () => import('../../main'), authorize = authorizeLocalStorage } = {}) {
  if (!root || root.childNodes.length || typeof loadApplication !== 'function' || typeof authorize !== 'function') throw Error('自动入口需要空应用根节点。');
  const document = root.ownerDocument, panel = document.createElement('section'), status = document.createElement('p');
  const retry = document.createElement('button');
  panel.setAttribute('aria-label', '本机工作区启动'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  status.textContent = '正在打开本机工作区…'; retry.type = 'button'; retry.textContent = '重新打开工作台'; retry.hidden = true;
  panel.style.cssText = 'box-sizing:border-box;min-height:100dvh;display:grid;place-content:center;justify-items:center;gap:14px;padding:32px;background:var(--background,#f7f7f5);color:var(--foreground,#1c1917);font:500 14px/1.5 -apple-system,BlinkMacSystemFont,"SF Pro Text","PingFang SC","Microsoft YaHei",sans-serif;';
  status.style.cssText = 'margin:0;display:inline-flex;align-items:center;gap:10px;';
  const indicator = document.createElement('span');
  indicator.setAttribute('aria-hidden', 'true');
  indicator.style.cssText = 'width:10px;height:10px;border-radius:50%;background:#0a84ff;box-shadow:0 0 0 5px color-mix(in srgb,#0a84ff 16%,transparent);animation:guan-startup-pulse 1.2s ease-in-out infinite;';
  const style = document.createElement('style');
  style.textContent = '@keyframes guan-startup-pulse{0%,100%{transform:scale(.82);opacity:.55}50%{transform:scale(1);opacity:1}}@media(prefers-reduced-motion:reduce){[aria-label="本机工作区启动"] span{animation:none!important}}';
  document.head.append(style);
  retry.addEventListener('click', () => document.defaultView.location.reload());
  panel.append(indicator, status, retry); root.append(panel);
  let started = false, busy = true;
  const ready = (async () => {
    let authorization, client, unbind;
    try {
      const markers = [...document.querySelectorAll('meta[name="guan-local-bootstrap"]')];
      const value = markers.length === 1 ? markers[0].getAttribute('content') : null;
      for (const marker of markers) { marker.removeAttribute('content'); marker.remove(); }
      if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) throw Error('没有匹配的本机启动材料。');
      status.textContent = '正在验证本机工作区…';
      authorization = await authorize({ code: value, origin, prepareSession: () => client.ensureSession() });
      unbind = bindPageAuthorization(document.defaultView, authorization.host);
      client = createRenewingDataClient({ ...authorization, origin, autoReconnect: true });
      status.textContent = '正在连接本机数据服务…';
      const app = createApplicationStorage({ client, namespaceSnapshots: true, requestLimit: 0, secretPort: authorization.secretPort, readBlobUrl: async value => {
        const url = new URL(value);
        if (url.protocol !== 'blob:' || url.origin !== origin) throw Error('只允许当前工作台的临时媒体。');
        const response = await fetch(url);
        if (!response.ok) throw Error('临时媒体读取失败。');
        return response.blob();
      } });
      // 首屏只建立并核验现有会话；整库容量扫描留到用户打开存储面板。
      await client.ensureSession();
      status.textContent = '正在读取工作台数据…';
      const view = document.defaultView;
      if (Object.getOwnPropertyDescriptor(view, '__guanSQLiteHost')) throw Error('本页面已安装存储入口。');
      // 恢复只替换client内的会话；app、React根、页内队列及编辑缓存保持同一个实例。
      if (Object.getOwnPropertyDescriptor(view, '__guanGenerationHost')) throw Error('本页面已安装生成端口。');
      if (Object.getOwnPropertyDescriptor(view, '__guanNetworkProxyHost')) throw Error('本页面已安装网络代理端口。');
      Object.defineProperty(view, '__guanNetworkProxyHost', { value: authorization.networkProxyPort, configurable: false, writable: false });
      Object.defineProperty(view, '__guanUpdateHost', { value: authorization.updatePort, configurable: false, writable: false });
      Object.defineProperty(view, '__guanMediaHost', { value: authorization.mediaPort, configurable: false, writable: false });
      if (Object.getOwnPropertyDescriptor(view, '__guanFallbackHost')) throw Error('本页面已安装Fallback端口。');
      const fallback = createFallbackClient({ command: value => authorization.generationPort.fallbackCommand(value), notify: event => view.dispatchEvent(new view.CustomEvent(event)) });
      await fallback.read();
      Object.defineProperty(view, '__guanFallbackHost', { value: fallback, configurable: false, writable: false });
      Object.defineProperty(view, '__guanGenerationHost', { value: authorization.generationPort, configurable: false, writable: false });
      Object.defineProperty(view, '__guanSQLiteHost', { value: Object.freeze({ initialize: async () => app, reconnect: () => client.reconnect() }), configurable: false, writable: false });
      started = true;
      status.textContent = '正在加载工作台界面…';
      // 保留启动面板到React真正提交首屏，避免动态模块加载期间出现空白页。
      await loadApplication();
      bindAutomaticUpdateRestart({ view, updatePort: authorization.updatePort, host: authorization.host, flush: async () => {
        if (typeof view.__guanPrepareUpdate !== 'function') throw Error('保存排空入口尚未就绪');
        await view.__guanPrepareUpdate(); await app.flush();
      } });
      return true;
    } catch {
      if (!started) { unbind?.(); try { await authorization?.host.close(); } catch { /* 服务端期限兜底，不重发或复用旧材料。 */ } }
      root.replaceChildren(panel); status.textContent = started ? '工作台未能加载。请重新打开；没有回退到浏览器存储。' : '本机工作区暂时无法连接。请重新打开；原数据未改动。';
      retry.hidden = false;
      return false;
    } finally { busy = false; }
  })();
  return Object.freeze({ ready, getStatus: () => ({ busy, started }) });
}
