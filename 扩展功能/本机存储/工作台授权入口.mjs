import { authorizeLocalStorage } from './本机授权客户端.mjs';
import { createRenewingDataClient } from './续期数据客户端.mjs';
import { createApplicationStorage } from './应用存储适配.mjs';

// 这是自有启动入口，不查找/修改原页面控件。须通过具体批准的HTML入口接入。
// 业务React模块只在授权后加载；刷新不恢复旧浏览器数据，也不静默重新授权。
export function mountWorkbenchAuthorization({ root, origin = location.origin, loadApplication = () => import('../../main'), authorize = authorizeLocalStorage } = {}) {
  if (!root || root.childNodes.length || typeof loadApplication !== 'function' || typeof authorize !== 'function') throw Error('授权入口需要独立且空的应用根节点。');
  const document = root.ownerDocument;
  const panel = document.createElement('section'), heading = document.createElement('h1'), description = document.createElement('p');
  const form = document.createElement('form'), label = document.createElement('label'), input = document.createElement('input'), submit = document.createElement('button');
  const status = document.createElement('p');
  panel.setAttribute('aria-label', '本机工作区授权');
  heading.textContent = '连接本机工作区'; description.textContent = '输入本机启动入口刚签发的一次性授权码。工作台不会读取旧浏览器数据。刷新后需重新授权。';
  label.textContent = '本机一次性授权码'; input.type = 'password'; input.autocomplete = 'off'; input.spellcheck = false; input.required = true;
  input.maxLength = 64; input.minLength = 64; input.pattern = '[0-9a-f]{64}';
  submit.type = 'submit'; submit.textContent = '授权并打开工作台'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  label.append(input); form.append(label, submit); panel.append(heading, description, form, status); root.append(panel);
  let busy = false, started = false;
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || started) return;
    busy = true; panel.setAttribute('aria-busy', 'true'); submit.disabled = true; input.disabled = true; status.textContent = '正在核验授权，尚未加载工作台…';
    const code = input.value; input.value = '';
    let authorization;
    try {
      authorization = await authorize({ code, origin });
      const client = createRenewingDataClient({ ...authorization, origin });
      const app = createApplicationStorage({ client, readBlobUrl: async value => {
        const url = new URL(value);
        if (url.protocol !== 'blob:' || url.origin !== origin) throw Error('只允许当前工作台的临时媒体。');
        const response = await fetch(url);
        if (!response.ok) throw Error('临时媒体读取失败。');
        return response.blob();
      } });
      // 先做只读健康验证。连接失败时不能发布可用host或渲染默认空画布。
      await client.readUsage();
      if (Object.getOwnPropertyDescriptor(window, '__guanSQLiteHost')) throw Error('本页面已经安装存储入口，拒绝覆盖。');
      Object.defineProperty(window, '__guanSQLiteHost', { value: Object.freeze({ initialize: async () => app }), configurable: false, writable: false });
      started = true;
      // main保留既有初始化→预读→原React入口顺序。授权表单不重绘原首页或画布。
      root.replaceChildren();
      await loadApplication();
    } catch {
      if (!started) {
        try { await authorization?.host.close(); } catch { /* 请求未确认时由服务端期限撤销，不再次兑换旧码。 */ }
        status.textContent = '本机授权或连接未通过。请从可信本机入口取得新码；旧数据未改动。';
        submit.disabled = false; input.disabled = false; input.focus();
      } else {
        // 已发布host后不得重新开一个空应用或复用失败的模块缓存。
        root.replaceChildren(panel); form.hidden = true;
        status.textContent = '工作台模块未能加载。请保留本机服务并重新打开授权入口；没有改用浏览器存储。';
      }
    } finally { busy = false; panel.setAttribute('aria-busy', 'false'); }
  });
  return Object.freeze({ getStatus: () => ({ busy, started }) });
}
