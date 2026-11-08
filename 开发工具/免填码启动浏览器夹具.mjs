import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { 加载免填码预审启动器 } from './预审SQLite免填码启动.mjs';
import { 建立SQLite写入协调隔离服务, 加载SQLite写入协调隔离服务 } from './接入SQLite写入协调隔离服务.mjs';

// 自有模块的隔离预审，不应用待审3文件到原React画布；不注入授权或存储host。
export async function createAutomaticEntryFixture() {
  const root = mkdtempSync(join(tmpdir(), 'guan-automatic-ui-')), webRoot = join(root, '静态包'), dataRoot = join(root, '数据');
  mkdirSync(webRoot); mkdirSync(join(webRoot, 'modules'));
  for (const name of ['协议.mjs', '浏览器适配.mjs', '续期数据客户端.mjs', '应用值编码.mjs', '应用存储适配.mjs', '本机授权客户端.mjs', '工作台自动入口.mjs']) {
    writeFileSync(join(webRoot, 'modules', name), readFileSync(new URL('../扩展功能/本机存储/' + name, import.meta.url)));
  }
  writeFileSync(join(webRoot, 'index.html'), '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>免填码启动隔离验收</title><link rel="icon" href="data:,"></head><body><main id="root"></main><script type="module" src="/入口.mjs"></script></body></html>');
  writeFileSync(join(webRoot, '入口.mjs'), `import {mountAutomaticWorkbench} from '/modules/工作台自动入口.mjs';
mountAutomaticWorkbench({root:document.getElementById('root'),loadApplication:async()=>{
if(location.pathname==='/canvas/module-failure')throw Error('合成模块加载故障');await import('/合成应用.mjs');}});`);
  writeFileSync(join(webRoot, '合成应用.mjs'), `const app=await window.__guanSQLiteHost.initialize(),store=app.createInstance({storeName:'prompt_cache'}),old=await store.getItem('免填码合成记录');
const root=document.getElementById('root'),heading=document.createElement('h1'),label=document.createElement('label'),input=document.createElement('input'),save=document.createElement('button'),status=document.createElement('p');
heading.textContent='工作区自动打开（隔离合成应用，非原画布）';label.textContent='测试标题';input.value=old?.title??'';label.append(input);save.textContent='保存测试记录';status.setAttribute('role','status');status.textContent=old?'已从SQLite恢复':'尚未保存';
root.append(heading,label,save,status);save.addEventListener('click',async()=>{save.disabled=true;try{await store.setItem('免填码合成记录',{title:input.value});await app.flush();status.textContent='已收到SQLite保存确认';}catch{status.textContent='保存失败，不可关闭';}finally{save.disabled=false;}});`);
  const approved = await 加载SQLite写入协调隔离服务(建立SQLite写入协调隔离服务());
  const { startIsolatedAuthorizedWorkbench } = await 加载免填码预审启动器();
  let workspace, dataURL;
  const storage = { ...approved, openWorkspace(options) { workspace = approved.openWorkspace(options); return workspace; },
    async startDataService(options) { const service = await approved.startDataService(options); dataURL = service.url; return service; } };
  return { ...await startIsolatedAuthorizedWorkbench({ webRoot, dataRoot, initialize: true, storage }), root, workspace, dataURL, dataRoot };
}
