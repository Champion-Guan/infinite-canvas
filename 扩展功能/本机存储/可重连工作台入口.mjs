import { authorizeLocalStorage } from './可重连授权客户端.mjs';
import { createRenewingDataClient } from './可重连数据客户端.mjs';
import { createRecoverableApplicationStorage as createApplicationStorage } from './可恢复应用存储.mjs';

// 用户不再填码。只消费当前本机启动器交付的一次性握手材料，立即从DOM移除。
// 这不是匿名数据访问：Host/Origin、短期票据、会话及CSRF仍由既有模块核验。
export function mountAutomaticWorkbench({ root, origin = location.origin, loadApplication = () => import('../../main'), authorize = authorizeLocalStorage } = {}) {
  if (!root || root.childNodes.length || typeof loadApplication !== 'function' || typeof authorize !== 'function') throw Error('自动入口需要空应用根节点。');
  const document = root.ownerDocument, panel = document.createElement('section'), status = document.createElement('p');
  const retry = document.createElement('button');
  panel.setAttribute('aria-label', '本机工作区启动'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  status.textContent = '正在打开本机工作区…'; retry.type = 'button'; retry.textContent = '重新打开工作台'; retry.hidden = true;
  retry.addEventListener('click', () => document.defaultView.location.reload());
  panel.append(status, retry); root.append(panel);
  let started = false, busy = true;
  const ready = (async () => {
    let authorization;
    try {
      const markers = [...document.querySelectorAll('meta[name="guan-local-bootstrap"]')];
      const value = markers.length === 1 ? markers[0].getAttribute('content') : null;
      for (const marker of markers) { marker.removeAttribute('content'); marker.remove(); }
      if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) throw Error('没有匹配的本机启动材料。');
      authorization = await authorize({ code: value, origin });
      const client = createRenewingDataClient({ ...authorization, origin });
      const app = createApplicationStorage({ client, requestLimit: 0, secretPort: authorization.secretPort, readBlobUrl: async value => {
        const url = new URL(value);
        if (url.protocol !== 'blob:' || url.origin !== origin) throw Error('只允许当前工作台的临时媒体。');
        const response = await fetch(url);
        if (!response.ok) throw Error('临时媒体读取失败。');
        return response.blob();
      } });
      await client.readUsage();
      const view = document.defaultView;
      if (Object.getOwnPropertyDescriptor(view, '__guanSQLiteHost')) throw Error('本页面已安装存储入口。');
      // 恢复只替换client内的会话；app、React根、页内队列及编辑缓存保持同一个实例。
      Object.defineProperty(view, '__guanSQLiteHost', { value: Object.freeze({ initialize: async () => app, reconnect: () => client.reconnect() }), configurable: false, writable: false });
      started = true; root.replaceChildren();
      await loadApplication();
      return true;
    } catch {
      if (!started) { try { await authorization?.host.close(); } catch { /* 服务端期限兜底，不重发或复用旧材料。 */ } }
      root.replaceChildren(panel); status.textContent = started ? '工作台未能加载。请重新打开；没有回退到浏览器存储。' : '本机工作区暂时无法连接。请重新打开；原数据未改动。';
      retry.hidden = false;
      return false;
    } finally { busy = false; }
  })();
  return Object.freeze({ ready, getStatus: () => ({ busy, started }) });
}
