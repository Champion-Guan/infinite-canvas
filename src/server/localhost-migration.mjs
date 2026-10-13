import { randomUUID, createHash } from 'node:crypto';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { privateDirectory, writePrivateFile } from './runtime-paths.mjs';

export const localhostMigrationGuard = `<script>if(location.hostname==='localhost'&&localStorage.getItem('guan-localhost-copy-v1')!=='verified')location.replace('/local-app/localhost-migration');</script>`;

// Browser alias migration is separate from updater service identity. The
// internal supervisor continues checking its exact 127.0.0.1 listener.
export function createLocalhostMigration({ port, backupRoot, gate }) {
  const source = `http://127.0.0.1:${port}`, target = `http://localhost:${port}`;
  const prefix = '/local-app/localhost-migration';
  const sessions = new Map();
  const page = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>迁移工作台地址</title><style>body{font:16px system-ui;max-width:780px;margin:80px auto;padding:24px;color:#222;background:#fafafa}button{padding:12px 20px}pre{white-space:pre-wrap}iframe{display:none}</style><h1>工作台迁移到 localhost</h1><p>请先保存并关闭旧地址的工作台页面、结束生成任务。只复制同一浏览器配置的数据，原地址数据保留，完整备份保存到本机私人目录。目标已有数据时停止，不覆盖。</p><button id="start">已保存并关闭，开始备份与迁移</button><pre id="status" role="status"></pre><a href="${source}">返回旧地址</a><script type="module" src="${prefix}/client.js"></script></html>`;
  const client = `import {restoreBrowserStorage} from '/data-contract/port-migration.mjs';
const source=${JSON.stringify(source)},prefix=${JSON.stringify(prefix)},button=document.querySelector('#start'),status=document.querySelector('#status');
button.onclick=async()=>{button.disabled=true;let frame,timer;try{
 const r=await fetch(prefix+'/session',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});if(!r.ok)throw Error('迁移会话未建立');const {nonce}=await r.json();
 status.textContent='正在读取旧地址完整数据…';
 const snapshot=await new Promise((resolve,reject)=>{const receive=e=>{if(e.origin!==source||e.source!==frame.contentWindow||e.data?.nonce!==nonce)return;window.removeEventListener('message',receive);clearTimeout(timer);if(e.data.error)reject(Error(e.data.error));else resolve(e.data.snapshot)};window.addEventListener('message',receive);timer=setTimeout(()=>{window.removeEventListener('message',receive);reject(Error('旧地址备份超时，未切换地址'))},120000);frame=document.createElement('iframe');frame.src=source+prefix+'/source?nonce='+nonce;document.body.append(frame)});
 status.textContent='正在保存完整备份…';
 const backup=await fetch(prefix+'/backup?nonce='+nonce,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(snapshot)});if(!backup.ok)throw Error('备份校验未通过');const evidence=await backup.json();
 status.textContent='完整备份已保存，正在复制并逐项验证…';await restoreBrowserStorage(snapshot);
 const verified=await fetch(prefix+'/verified?nonce='+nonce,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sha256:evidence.sha256,verified:true})});if(!verified.ok)throw Error('迁移结果未保存');
 localStorage.setItem('guan-localhost-copy-v1','verified');status.textContent='复制及逐项校验通过，正在打开工作台…';location.replace('/');
}catch(e){status.textContent=e.message+'。旧地址数据与备份保留，请勿清空目标数据或反复覆盖。';}finally{clearTimeout(timer);frame?.remove();button.disabled=false}};`;
  const reply = (res, code, value, type = 'application/json') => {
    res.writeHead(code, { 'content-type': type + '; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
      'content-security-policy': `default-src 'none'; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-src ${source}; frame-ancestors ${target}; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'` });
    res.end(typeof value === 'string' ? value : JSON.stringify(value));
  };
  const read = async (req, limit) => {
    if (req.headers['content-type']?.split(';')[0] !== 'application/json') throw Error();
    let size = 0; const chunks = [];
    for await (const c of req) { size += c.length; if (size > limit) throw Error(); chunks.push(c); }
    return Buffer.concat(chunks);
  };
  return async (req, res) => {
    const url = new URL(req.url || '/', target);
    if (!url.pathname.startsWith(prefix)) return false;
    let release;
    try {
      if (![new URL(source).host, new URL(target).host].includes(req.headers.host)) throw Error();
      for (const [id, s] of sessions) if (Date.now() - s.created > 15 * 60 * 1000) sessions.delete(id);
      if (url.pathname === prefix && req.method === 'GET' && req.headers.host === new URL(target).host) { reply(res, 200, page, 'text/html'); return true; }
      if (url.pathname === prefix + '/client.js' && req.method === 'GET' && req.headers.host === new URL(target).host) { reply(res, 200, client, 'text/javascript'); return true; }
      if (url.pathname === prefix + '/session' && req.method === 'POST' && req.headers.origin === target && req.headers.host === new URL(target).host) {
        if ((await read(req, 16)).toString() !== '{}' || sessions.size >= 8) throw Error();
        const nonce = randomUUID(); sessions.set(nonce, { created: Date.now() }); reply(res, 200, { nonce }); return true;
      }
      const nonce = url.searchParams.get('nonce'), session = sessions.get(nonce);
      if (!session) throw Error();
      if (url.pathname === prefix + '/source' && req.method === 'GET' && req.headers.host === new URL(source).host) {
        const script = `import {exportBrowserStorage} from '/data-contract/port-migration.mjs';const target=${JSON.stringify(target)},nonce=${JSON.stringify(nonce)};if(parent!==window)try{parent.postMessage({nonce,snapshot:await exportBrowserStorage()},target)}catch{parent.postMessage({nonce,error:'旧地址数据仍在变化或读取失败'},target)}`;
        reply(res, 200, `<!doctype html><meta charset="utf-8"><script type="module">${script}</script>`, 'text/html'); return true;
      }
      if (req.method !== 'POST' || req.headers.host !== new URL(target).host || req.headers.origin !== target) throw Error();
      release = gate.acquire('storage');
      if (url.pathname === prefix + '/backup' && !session.backup && !session.writing) {
        session.writing = true;
        const bytes = await read(req, 1024 ** 3), snapshot = JSON.parse(bytes);
        if (snapshot.app !== 'guan-ai-workbench' || snapshot.kind !== 'full-browser-backup' || snapshot.format !== 1
          || snapshot.origin !== source || !Array.isArray(snapshot.databases) || !snapshot.localStorage || !snapshot.sessionStorage) throw Error();
        const directory = join(backupRoot, 'localhost-' + nonce); await privateDirectory(directory);
        await writePrivateFile(join(directory, 'browser-127.json'), bytes, { exclusive: true });
        session.sha256 = createHash('sha256').update(bytes).digest('hex');
        if (createHash('sha256').update(await readFile(join(directory, 'browser-127.json'))).digest('hex') !== session.sha256) throw Error();
        await writePrivateFile(join(directory, 'MIGRATION.json'), JSON.stringify({ format: 1, source, target, sha256: session.sha256, phase: 'backed-up' }));
        session.backup = directory;
        reply(res, 200, { sha256: session.sha256, backedUp: true }); return true;
      }
      if (url.pathname === prefix + '/verified' && session.backup && !session.verified) {
        const value = JSON.parse(await read(req, 256));
        if (value.verified !== true || value.sha256 !== session.sha256 || Object.keys(value).sort().join(',') !== 'sha256,verified') throw Error();
        await writePrivateFile(join(session.backup, 'MIGRATION.json'), JSON.stringify({ format: 1, source, target, sha256: session.sha256, phase: 'browser-verified' }));
        session.verified = true; reply(res, 200, { verified: true }); return true;
      }
      throw Error();
    } catch { reply(res, 409, { error: '迁移已停止，旧数据与备份保留' }); }
    finally { release?.(); }
    return true;
  };
}
