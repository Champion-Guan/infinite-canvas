import { createRequire } from 'node:module';
import { createServer as createHTTPServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { 建立SQLite启动存储隔离副本 } from './接入SQLite启动存储隔离副本.mjs';
import { openWorkspace } from '../扩展功能/本机存储/SQLite工作区.mjs';
import { startDataService } from '../扩展功能/本机服务/数据服务.mjs';
import { createSessionController } from '../扩展功能/本机服务/受控会话.mjs';
import { createBackupCoordinator } from '../扩展功能/本机服务/自动备份.mjs';
import { 建立SQLite写入协调隔离服务, 加载SQLite写入协调隔离服务 } from './接入SQLite写入协调隔离服务.mjs';

// 完整上游React界面，仅在隔离资料注入测试host；不是生产授权交付机制。
export async function createSQLiteUIFixture({ testSessionRenewal = false, testWriteCoordination = false } = {}) {
  const integration = 建立SQLite启动存储隔离副本();
  const serviceIntegration = testWriteCoordination ? 建立SQLite写入协调隔离服务() : null;
  const root = mkdtempSync(join(tmpdir(), 'guan-stage6-real-ui-'));
  const web = join(integration.副本, 'web'), require = createRequire(join(web, 'package.json'));
  const { build } = await import(pathToFileURL(require.resolve('vite')).href);
  const modules = new Map(['协议.mjs', '浏览器适配.mjs', '续期数据客户端.mjs', '应用存储适配.mjs', '应用值编码.mjs'].map(name => ['/__sqlite-test/' + name, readFileSync(new URL('../扩展功能/本机存储/' + name, import.meta.url))]));
  const requests = [];
  // 测试桥能力仅写0600注入文件，不在URL、HTTP静态脚本、CLI源码或日志中交付。
  const testBridgeCapability = testSessionRenewal ? randomBytes(32).toString('hex') : null;
  // 构建后验收，避免冷依赖优化/HMR重载令两个React实例干扰存储测试。
  const dist = join(root, 'dist');
  await build({
    root: web, configFile: join(web, 'vite.config.ts'), cacheDir: join(root, 'node_modules/.vite'), logLevel: 'warn',
    build: { outDir: dist, emptyOutDir: false },
    css: { postcss: { plugins: [require('@tailwindcss/postcss')({ base: join(web, 'src') })] } },
  });
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
  const server = createHTTPServer(async (req, res) => {
    requests.push(req.url?.split('?')[0]);
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    let path;
    try { path = decodeURIComponent(req.url); } catch { res.writeHead(400); res.end(); return; }
    if (testSessionRenewal && path === '/__sqlite-test/session') {
      const candidate = req.headers['x-guan-test-bridge'];
      if (req.method !== 'POST' || req.headers.host !== `127.0.0.1:${server.address().port}` ||
          req.headers.origin !== `http://127.0.0.1:${server.address().port}` || req.headers['content-type'] !== 'application/json' ||
          typeof candidate !== 'string' || candidate.length !== testBridgeCapability.length || !timingSafeEqual(Buffer.from(candidate), Buffer.from(testBridgeCapability))) {
        res.writeHead(403); res.end(); req.resume(); return;
      }
      try {
        const chunks = []; let size = 0;
        for await (const bytes of req) { size += bytes.length; if (size > 16 * 1024) throw Error('测试桥请求超限'); chunks.push(bytes); }
        const value = sessionCommand(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ value }));
      } catch (error) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { code: error.code ?? 'test_bridge_denied', message: '测试端口拒绝或会话已失效。' } })); }
      return;
    }
    if (modules.has(path)) { res.setHeader('Content-Type', 'text/javascript; charset=utf-8'); res.end(modules.get(path)); return; }
    if (!['GET', 'HEAD'].includes(req.method) || path.includes('..') || path.includes('?')) { res.writeHead(404); res.end(); return; }
    const file = path === '/' || path.startsWith('/canvas') ? join(dist, 'index.html') : resolve(dist, '.' + path);
    if (!file.startsWith(dist + sep) || !existsSync(file) || !extname(file)) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', mime[extname(file)] ?? 'application/octet-stream'); res.end(readFileSync(file));
  });
  const closeHTTP = () => new Promise((success, failure) => server.close(error => error ? failure(error) : success()));
  let workspace, service, controller, port, automatic, scheduledBackup, backupHold, lastBackupReceipt, lastBackupBoundary;
  let timeOffset = 0, initializes = 0, renewals = 0;
  const bootstrap = join(root, '隔离授权.js');
  function sessionCommand(command) {
    if (!testSessionRenewal || !port) throw Error('未启用会话隔离夹具');
    if (command?.operation === 'initialize') { initializes++; return port.initialize(); }
    if (command?.operation === 'renew') { renewals++; return port.renew(command.session); }
    if (command?.operation === 'close') return port.close();
    throw Error('未知测试会话操作');
  }
  async function releaseBackup() {
    const held = backupHold; backupHold = null; held?.release();
    const deadline = Date.now() + 3_000;
    while (automatic?.getStatus().pending) {
      if (Date.now() > deadline) throw Error('等待隔离备份完成超时');
      await new Promise(done => setTimeout(done, 5));
    }
  }
  try {
    await new Promise((success, failure) => { server.once('error', failure); server.listen(0, '127.0.0.1', success); });
    const origin = `http://127.0.0.1:${server.address().port}`;
    const storage = testWriteCoordination ? await 加载SQLite写入协调隔离服务(serviceIntegration) : { openWorkspace, startDataService };
    workspace = storage.openWorkspace({ dataRoot: join(root, '数据'), initialize: true });
    // 仅隔离夹具故障注入：真实快照完成后延迟完成回执，确定性复现备份仍占队列的窗口。
    // 不改工作区实现，不向页面或HTTP暴露备份/放行能力。
    const serviceWorkspace = testWriteCoordination ? { ...workspace, async createBackup() {
      const documents = ['canvas', 'extension'].flatMap(collection => workspace.listDocuments(collection).map(row => {
        const doc = workspace.readDocument(collection, row.id); return { collection, id: doc.id, revision: doc.revision, hash: doc.hash };
      })).sort((a, b) => (a.collection + '/' + a.id).localeCompare(b.collection + '/' + b.id));
      const receipt = await workspace.createBackup(); lastBackupReceipt = receipt;
      lastBackupBoundary = { path: receipt.path, documents };
      if (backupHold) { backupHold.entered(receipt); await backupHold.promise; }
      return receipt;
    } } : workspace;
    service = await storage.startDataService({ workspace: serviceWorkspace, allowedOrigins: [origin], rateLimit: 1000,
      ...(testWriteCoordination ? { writeOptions: { maxWait: 10_000 } } : {}),
      ...(testSessionRenewal ? { now: () => Date.now() + timeOffset, sessionTTL: 5 * 60_000 } : {}) });
    if (testWriteCoordination) {
      automatic = createBackupCoordinator({ workspaceId: workspace.workspaceId, createBackup: () => service.createBackup(),
        schedule(callback, delay) { scheduledBackup = { callback, delay }; return scheduledBackup; },
        cancel(timer) { if (timer === scheduledBackup) scheduledBackup = null; },
      });
      await automatic.start();
    }
    if (testSessionRenewal) {
      controller = createSessionController({ service, origin, now: () => Date.now() + timeOffset }); port = controller.open();
    }
    const clientSource = testSessionRenewal ? `
        const {createRenewingDataClient}=await import('/__sqlite-test/续期数据客户端.mjs');
        const command=async value=>{
          const response=await fetch('/__sqlite-test/session',{method:'POST',headers:{'Content-Type':'application/json','X-Guan-Test-Bridge':${JSON.stringify(testBridgeCapability)}},body:JSON.stringify(value),credentials:'omit',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(3000)});
          const result=await response.json();if(!response.ok||result.error){const error=Error('测试会话端口拒绝');error.code=result.error?.code;throw error}return result.value;
        };
        const host={initialize:()=>command({operation:'initialize'}),renew:session=>command({operation:'renew',session}),close:()=>command({operation:'close'})};
        const client=createRenewingDataClient({url:${JSON.stringify(service.url)},origin:location.origin,host,now:()=>Date.now()+(window.__guanTestTimeOffset??0)});
    ` : `const {createDataClient}=await import('/__sqlite-test/浏览器适配.mjs'); const client=createDataClient(${JSON.stringify({ url: service.url, session: service.issueSession(origin) })});`;
    // 授权文件仅0600，关闭时移除；不输出令牌，不写浏览器数据库或URL。
    writeFileSync(bootstrap, `if(location.origin===${JSON.stringify(origin)}){
      window.__browserPersistenceCalls=[];
      window.__guanSQLitePageIdentity=crypto.randomUUID();
      window.__guanSQLiteStorageStatus=null;
      window.addEventListener('guan:storage-status',event=>{window.__guanSQLiteStorageStatus=event.detail});
      for(const name of ['getItem','setItem','removeItem','clear'])Storage.prototype[name]=function(){window.__browserPersistenceCalls.push({storage:this===window.localStorage?'localStorage':'sessionStorage',method:name,stack:new Error().stack});throw Error('禁止浏览器持久化：'+name)};
      IDBFactory.prototype.open=function(){window.__browserPersistenceCalls.push({storage:'indexedDB',method:'open',stack:new Error().stack});throw Error('禁止IndexedDB')};
      window.__guanSQLiteHost={initialize:async()=>{
        const {createApplicationStorage}=await import('/__sqlite-test/应用存储适配.mjs');
        ${clientSource}
        const app=createApplicationStorage({client,readBlobUrl:async value=>{
          const url=new URL(value);
          if(url.protocol!=='blob:'||url.origin!==location.origin)throw Error('测试host只读取当前Origin的临时媒体');
          const response=await fetch(url);
          if(!response.ok)throw Error('测试host无法读取临时媒体');
          return response.blob();
        }});
        window.__guanSQLiteTest={app,client};return app;
      }};
    }`, { mode: 0o600 });
    return {
      origin, root, bootstrap, integration, serviceIntegration, workspace, dataURL: service.url, requests,
      // 仅夹具调用；HTTP测试桥额外检查随机能力、精确Host/Origin及受限请求体。
      sessionCommand,
      advanceSessionClock(ms) { if (!testSessionRenewal || !Number.isSafeInteger(ms) || ms < 0) throw Error('无效测试时钟'); timeOffset += ms; return timeOffset; },
      get sessionCounts() { return { initializes, renewals }; },
      get writeStatus() { return testWriteCoordination ? service.getWriteStatus() : null; },
      get backupStatus() { return automatic?.getStatus() ?? null; },
      get lastBackupReceipt() { return lastBackupReceipt ?? null; },
      get lastBackupBoundary() { return lastBackupBoundary ?? null; },
      async beginPeriodicBackup() {
        if (!automatic || backupHold || !scheduledBackup) throw Error('隔离周期备份未就绪');
        let entered, release;
        const ready = new Promise(done => { entered = done; }), promise = new Promise(done => { release = done; });
        backupHold = { entered, release, promise }; scheduledBackup.callback();
        let deadline;
        try { return await Promise.race([ready, new Promise((_done, reject) => { deadline = setTimeout(() => reject(Error('隔离周期备份未进入测试窗口')), 3_000); })]); }
        finally { clearTimeout(deadline); }
      },
      releaseBackup,
      requestBackup() { if (!automatic) throw Error('未启用隔离自动备份'); return automatic.request('manual'); },
      async close() { await releaseBackup(); await automatic?.stop(); await closeHTTP(); controller?.close(); await service.close(); workspace.close(); unlinkSync(bootstrap); },
    };
  } catch (error) {
    await releaseBackup(); await automatic?.stop();
    if (server.listening) await closeHTTP(); controller?.close(); if (service) await service.close(); if (workspace) workspace.close();
    try { unlinkSync(bootstrap); } catch (cleanup) { if (cleanup.code !== 'ENOENT') throw cleanup; }
    throw error;
  }
}
