// 隔离验收页面，不是已接入3100的产品界面；授权来自实际表单，不注入数据会话。
import { authorizeLocalStorage } from '/modules/本机授权客户端.mjs';
import { createRenewingDataClient } from '/modules/续期数据客户端.mjs';
import { createApplicationStorage } from '/modules/应用存储适配.mjs';

const form = document.querySelector('form'), code = document.querySelector('input'), status = document.querySelector('[role=status]');
const save = document.querySelector('#save'), retry = document.querySelector('#retry'), close = document.querySelector('#close');
let client, app, instance;
function message(value) { status.textContent = value; }
form.addEventListener('submit', async event => {
  event.preventDefault(); const value = code.value; code.value = ''; message('正在核验一次性授权码');
  try {
    const authorization = await authorizeLocalStorage({ code: value });
    // 只对隔离合成数据注入一次响应丢失，HTTP保存本身仍真实提交。
    client = createRenewingDataClient({ ...authorization, fetchImpl: async (url, init) => {
      const response = await fetch(url, init);
      if (document.querySelector('#lose-response').checked && init.method === 'PUT' && response.ok) {
        document.querySelector('#lose-response').checked = false; await response.arrayBuffer(); throw Error('隔离模拟：保存响应丢失');
      }
      return response;
    } });
    app = createApplicationStorage({ client }); instance = app.createInstance({ storeName: 'prompt_cache' });
    const existing = await instance.getItem('授权测试记录');
    await client.readUsage();
    form.hidden = true; save.disabled = false; close.disabled = false;
    message(existing === null ? '已授权：本机数据库连接正常' : '已授权：已从SQLite恢复测试记录');
  } catch { message('授权未通过：请从可信本机入口取得新码'); }
});
save.addEventListener('click', async () => {
  save.disabled = true; close.disabled = true; message('保存中，等待SQLite确认');
  try { await instance.setItem('授权测试记录', { title: '本机授权合成记录', value: 42 }); await app.flush(); message('已保存：SQLite已确认'); close.disabled = false; }
  catch { message('保存结果未确认：请重试同一笔保存，勿关闭页面'); retry.disabled = false; }
});
retry.addEventListener('click', async () => {
  retry.disabled = true; message('正在重试同一笔保存');
  try { await app.retry('prompt_cache'); await app.flush(); message('已保存：同一操作已确认，未重复提交新修订'); close.disabled = false; }
  catch { message('保存仍未确认：请保留此页面'); retry.disabled = false; }
});
close.addEventListener('click', async () => {
  try { await app.flush(); app.close(); await client.close(); close.disabled = true; save.disabled = true; message('授权已撤销，数据库记录保留'); }
  catch { message('存在未确认操作，不能关闭授权'); }
});
form.querySelector('button').disabled = false;
