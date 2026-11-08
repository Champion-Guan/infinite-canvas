import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startIsolatedAuthorizedWorkbench } from '../扩展功能/本机服务/受限工作台启动器.mjs';
import { 建立SQLite写入协调隔离服务, 加载SQLite写入协调隔离服务 } from './接入SQLite写入协调隔离服务.mjs';

// 只测试自有入口，不执行或装入待批准的上游HTML差异。
// 授权后加载的合成应用用真实host契约保存，不能把它称为原工作台验收。
export async function createWorkbenchAuthorizationFixture() {
  const integration = 建立SQLite写入协调隔离服务(), approved = await 加载SQLite写入协调隔离服务(integration);
  const root = mkdtempSync(join(tmpdir(), 'guan-stage6-entry-ui-')), webRoot = join(root, '静态包'), dataRoot = join(root, '数据');
  mkdirSync(webRoot); mkdirSync(join(webRoot, 'modules'));
  for (const name of ['协议.mjs', '浏览器适配.mjs', '续期数据客户端.mjs', '应用值编码.mjs', '应用存储适配.mjs', '本机授权客户端.mjs', '工作台授权入口.mjs']) {
    writeFileSync(join(webRoot, 'modules', name), readFileSync(new URL('../扩展功能/本机存储/' + name, import.meta.url)));
  }
  writeFileSync(join(webRoot, 'index.html'), `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>工作台授权入口隔离验收</title><link rel="icon" href="data:,"><script>document.documentElement.dataset.trustedInline='loaded';</script></head><body><main id="root"></main><script type="module" src="/验收入口.mjs"></script></body></html>`);
  writeFileSync(join(webRoot, '验收入口.mjs'), `import {mountWorkbenchAuthorization} from '/modules/工作台授权入口.mjs';
mountWorkbenchAuthorization({root:document.getElementById('root'),loadApplication:async()=>{
  if(location.pathname==='/canvas/module-failure')throw Error('合成模块加载故障');
  await import('/合成应用.mjs');
}});`);
  writeFileSync(join(webRoot, '合成应用.mjs'), `const app=await window.__guanSQLiteHost.initialize();
const store=app.createInstance({storeName:'prompt_cache'}), previous=await store.getItem('启动入口合成记录');
const root=document.getElementById('root'), heading=document.createElement('h1'), label=document.createElement('label');
const input=document.createElement('input'), save=document.createElement('button'), status=document.createElement('p');
heading.textContent='隔离应用已加载（非原工作台）';label.textContent='合成记录标题';input.value=previous?.title??'';label.append(input);
save.textContent='保存到本机SQLite';status.setAttribute('role','status');status.textContent=previous?'已从SQLite恢复':'尚未保存';
save.addEventListener('click',async()=>{save.disabled=true;try{await store.setItem('启动入口合成记录',{title:input.value});await app.flush();status.textContent='已保存：收到SQLite确认';}catch{status.textContent='保存未确认，不可关闭';}finally{save.disabled=false;}});
root.append(heading,label,save,status);`);
  let dataURL, workspace;
  const storage = { ...approved, openWorkspace(options) { workspace = approved.openWorkspace(options); return workspace; },
    async startDataService(options) { const value = await approved.startDataService(options); dataURL = value.url; return value; } };
  const launcher = await startIsolatedAuthorizedWorkbench({ webRoot, dataRoot, initialize: true, storage });
  return { root, dataRoot, dataURL, workspace, integration, ...launcher };
}
