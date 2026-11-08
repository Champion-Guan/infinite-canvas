import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openWorkspace } from '../扩展功能/本机存储/SQLite工作区.mjs';
import { startDataService } from '../扩展功能/本机服务/数据服务.mjs';
import { 根目录, 基线 } from './公共.mjs';

const modules = new Map(['协议.mjs', '浏览器适配.mjs', '应用存储适配.mjs', '应用值编码.mjs'].map(name => ['/' + name, readFileSync(new URL('../扩展功能/本机存储/' + name, import.meta.url))]));
const ts = createRequire(join(根目录, '.运行', 基线.提交, 'web/package.json'))('typescript');
modules.set('/上游浏览器存储桥.js', ts.transpileModule(readFileSync(new URL('../扩展功能/本机存储/上游浏览器存储桥.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText);
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>SQLite全面替换隔离验收</title>
<style>body{font:16px system-ui;background:#f7f7fb;color:#21242d;margin:60px auto;max-width:800px}main{padding:30px;border:1px solid #ddd;border-radius:16px;background:white}button,input{margin:8px;padding:10px}output{display:block;white-space:pre-wrap;padding:16px;background:#efedf6;border-radius:10px}img{width:60px;height:60px;object-fit:contain}</style>
<main><h1>应用存储隔离验收</h1><p>合成数据，不连接日常3100，不迁移私人数据。</p><label>产品名称<input aria-label="产品名称" value="SQLite合成产品"></label><p><button id="save">保存产品与媒体</button><button id="read">读取产品与媒体</button><button id="clear">清空合成产品</button></p><img alt="SQLite合成媒体"><output role="status">等待测试授权</output></main>
<script type="module">
import {createDataClient} from '/浏览器适配.mjs';
import {createApplicationStorage} from '/应用存储适配.mjs';
import {initializeSQLiteApplication,sqliteStateStorage,sqlitePreferences,flushSQLiteStorage,storageStatus} from '/上游浏览器存储桥.js';
const authorization=window.__guanStage6Application;delete window.__guanStage6Application;
const output=document.querySelector('output'),state={error:null,saved:false,read:false,cleared:false};
const client=createDataClient(authorization),app=createApplicationStorage({client});
window.__guanSQLiteHost={initialize:async()=>app};await initializeSQLiteApplication();delete window.__guanSQLiteHost;
const images=app.createInstance({storeName:'image_files'}),key='infinite-canvas:canvas_store';
const run=fn=>async()=>{try{state.error=null;await fn();output.textContent=JSON.stringify({status:storageStatus(),...state},null,2)}catch(error){state.error=error.code??error.message;output.textContent='安全停止：'+state.error}};
document.querySelector('#save').onclick=run(async()=>{const title=document.querySelector('input').value;await images.setItem('image:demo',new Blob([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2nJ6kAAAAASUVORK5CYII='),x=>x.charCodeAt(0))],{type:'image/png'}));await sqliteStateStorage.setItem(key,JSON.stringify({state:{projects:[{id:'demo',title,nodes:[{id:'image-node',type:'image',metadata:{storageKey:'image:demo'},position:{x:1,y:2}}],connections:[]}],deletedProjects:[]},version:0}));sqlitePreferences.setItem('infinite-canvas:locale','en-US');await flushSQLiteStorage();state.saved=true;});
document.querySelector('#read').onclick=run(async()=>{const data=JSON.parse(sqliteStateStorage.getItem(key));document.querySelector('input').value=data.state.projects[0].title;const blob=await images.getItem('image:demo');state.mediaType=blob.type;state.mediaBytes=blob.size;state.locale=sqlitePreferences.getItem('infinite-canvas:locale');document.querySelector('img').src=URL.createObjectURL(blob);state.read=true;});
document.querySelector('#clear').onclick=run(async()=>{await sqliteStateStorage.removeItem(key);await flushSQLiteStorage();state.cleared=true;});
window.__stage6Application={state,app,client};output.textContent='本机SQLite已就绪，未使用浏览器数据库';
</script></html>`;

export async function createApplicationBrowserFixture() {
  const root = mkdtempSync(join(tmpdir(), 'guan-stage6-app-browser-')), fronts = [], bootstrapPaths = [];
  let workspace, service, initialized = false;
  for (let index = 0; index < 2; index++) {
    const server = createServer((req, res) => {
      res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; connect-src 'self' ${service?.url ?? ''}; frame-ancestors 'none'`);
      let path; try { path = decodeURIComponent(req.url); } catch { res.writeHead(400); res.end(); return; }
      if (path === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); }
      else if (modules.has(path)) { res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' }); res.end(modules.get(path)); }
      else if (path === '/favicon.ico') { res.writeHead(204); res.end(); }
      else { res.writeHead(404); res.end(); }
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    fronts.push({ server, origin: `http://127.0.0.1:${server.address().port}` });
  }
  const allowedOrigins = fronts.map(front => front.origin);
  async function start(port = 0) {
    workspace = openWorkspace({ dataRoot: join(root, '数据'), initialize: !initialized }); initialized = true;
    service = await startDataService({ workspace, allowedOrigins, port });
    fronts.forEach((front, index) => {
      const path = join(root, `测试授权-${index}.js`), session = service.issueSession(front.origin);
      // 仅给自己创建的空资料注入测试授权，非生产会话交付方案。
      writeFileSync(path, `if(location.origin===${JSON.stringify(front.origin)})window.__guanStage6Application=${JSON.stringify({ url: service.url, session })};`, { mode: 0o600 });
      bootstrapPaths[index] = path;
    });
  }
  await start();
  return {
    root, fronts: fronts.map(front => front.origin), bootstrapPaths,
    get workspace() { return workspace; },
    async restart() { const port = Number(new URL(service.url).port); await service.close(); workspace.close(); await start(port); },
    async close() { await service.close(); workspace.close(); await Promise.all(fronts.map(({ server }) => new Promise(resolve => server.close(resolve)))); for (const path of bootstrapPaths) unlinkSync(path); },
  };
}
