import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openWorkspace } from '../扩展功能/本机存储/SQLite工作区.mjs';
import { startDataService } from '../扩展功能/本机服务/数据服务.mjs';

const modules = new Map(['协议.mjs', '浏览器适配.mjs'].map(name => [`/${name}`, readFileSync(new URL(`../扩展功能/本机存储/${name}`, import.meta.url))]));
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>阶段6 SQLite隔离验收</title>
<style>body{font:16px system-ui;max-width:780px;margin:70px auto;color:#21242d;background:#f7f7fb}main{padding:32px;border:1px solid #dedee8;border-radius:20px;background:white}button,input{padding:10px;margin:8px 4px;border:1px solid #bdb9cd;border-radius:8px}button{cursor:pointer}output{display:block;white-space:pre-wrap;background:#f0edf8;padding:20px;border-radius:12px}small{color:#646078}</style>
<main><h1>本机数据存储验收</h1><p>只使用合成数据；不是客户首页，不接管3100。</p><label>画布标题<input aria-label="画布标题" value="SQLite测试产品"></label><p><button id="save">保存到SQLite</button><button id="read">从SQLite读取</button><button id="media">保存合成媒体</button></p><output role="status" id="status">等待测试授权</output><p id="result"></p><small>保存成功必须收到数据库提交确认；接口失败不回退浏览器存储。</small></main>
<script type="module">
import {createDataClient} from '/浏览器适配.mjs';
const authorization=window.__guanStage6Test; delete window.__guanStage6Test;
const status=document.querySelector('#status'),result=document.querySelector('#result');
let revision=0,mediaIds=[];
const state={revision,mediaIds,error:null,ack:null};
if(!authorization){status.textContent='未授权，禁止读写';}else{
 const client=createDataClient({...authorization,onStatus:s=>{status.textContent=JSON.stringify({state:s.state,pending:s.pending,revision:s.lastAck?.revision??null,error:s.errors[0]?.code??null},null,2)}});
 const run=fn=>async()=>{try{state.error=null;await fn()}catch(e){state.error=e.code??'connection_failed';result.textContent='操作停止：'+state.error}};
 document.querySelector('#save').onclick=run(async()=>{const value={id:'browser-demo',title:document.querySelector('input').value,nodes:[],connections:[],viewport:{x:0,y:0,k:1}};state.ack=await client.writeDocument({collection:'canvas',id:value.id,value,expectedRevision:revision,operationId:crypto.randomUUID(),mediaIds});revision=state.ack.revision;state.revision=revision;result.textContent='已落盘：'+value.title+'，版本'+revision;});
 document.querySelector('#read').onclick=run(async()=>{const doc=await client.readDocument('canvas','browser-demo');revision=doc.revision;mediaIds=doc.mediaIds;state.revision=revision;state.mediaIds=mediaIds;document.querySelector('input').value=doc.value.title;result.textContent='读取成功：'+doc.value.title+'，版本'+revision;if(mediaIds.length){const blob=await client.readMedia(mediaIds[0]);state.mediaText=await blob.text()}});
 document.querySelector('#media').onclick=run(async()=>{const media=await client.writeMedia(new Blob(['stage6-browser-media'],{type:'application/octet-stream'}));mediaIds=[media.id];state.mediaIds=mediaIds;result.textContent='媒体已落盘，待画布提交引用';});
 window.__stage6={state,client};status.textContent='已授权，尚未保存';
}
</script></html>`;

export async function createStorageBrowserFixture() {
  const root = mkdtempSync(join(tmpdir(), 'guan-stage6-browser-'));
  const fronts = [], bootstrapPaths = [], requests = [];
  let workspace, service;
  for (let i = 0; i < 2; i++) {
    const server = createServer((req, res) => {
      res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ${service?.url ?? ''}; frame-ancestors 'none'`);
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
    workspace = openWorkspace({ dataRoot: join(root, '数据'), initialize: !workspace });
    service = await startDataService({ workspace, allowedOrigins, port });
    for (let index = 0; index < fronts.length; index++) {
      const session = service.issueSession(fronts[index].origin), path = join(root, `测试授权-${index}.js`);
      const source = `if(location.origin===${JSON.stringify(fronts[index].origin)})Object.defineProperty(window,'__guanStage6Test',{configurable:true,value:${JSON.stringify({ url: service.url, session })}});`;
      writeFileSync(path, source, { mode: 0o600 }); bootstrapPaths[index] = path;
    }
  }
  await start();
  return {
    root, fronts: fronts.map(({ origin }) => origin), bootstrapPaths, requests,
    get workspace() { return workspace; }, get service() { return service; },
    async restart() { const port = Number(new URL(service.url).port); await service.close(); workspace.close(); await start(port); },
    async close() {
      await service.close(); workspace.close();
      await Promise.all(fronts.map(({ server }) => new Promise(resolve => server.close(resolve))));
      for (const path of bootstrapPaths) unlinkSync(path); // 只清除自建临时授权脚本，不删除测试数据库。
    },
  };
}
