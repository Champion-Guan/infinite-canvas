import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { assembleNetworkProxyService } from '../网络代理/代理服务装配.mjs';
import { assembleGenerationService } from '../生成网关/生成服务装配.mjs';
import { assembleSoftwareUpdates } from '../软件更新/更新服务装配.mjs';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { extname, isAbsolute, join } from 'node:path';
import { requireValue } from '../本机存储/协议.mjs';
import { createSessionController } from './受控会话.mjs';
import { createLocalAuthorizationGateway } from './本机授权网关.mjs';
import { createBackupCoordinator } from './自动备份.mjs';
import { createDeferredCredentialVault } from '../本机凭据/延迟凭据保管.mjs';
import { DEFAULT_WORKBENCH_PORT, listenWorkbench } from './工作台端口.mjs';

const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.gif': 'image/gif', '.mp4': 'video/mp4', '.mp3': 'audio/mpeg', '.txt': 'text/plain' };
function readStaticBundle(directory) {
  requireValue(isAbsolute(directory) && !lstatSync(directory).isSymbolicLink() && lstatSync(directory).isDirectory(), 'invalid_web_root', '工作台静态产物目录无效。');
  const root = realpathSync(directory), files = new Map(); let total = 0;
  function walk(path, segments = []) {
    requireValue(segments.length <= 16, 'invalid_web_bundle', '静态产物目录层级超限。');
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      requireValue(!entry.name.startsWith('.') && !/[\\%?#]/.test(entry.name), 'invalid_web_bundle', '静态产物含未允许的文件名。');
      const file = join(path, entry.name), stat = lstatSync(file), next = [...segments, entry.name];
      requireValue(!stat.isSymbolicLink(), 'invalid_web_bundle', '静态产物不能包含链接。');
      if (stat.isDirectory()) { walk(file, next); continue; }
      requireValue(stat.isFile() && stat.nlink === 1 && mime[extname(file)] && stat.size <= 128 * 1024 * 1024, 'invalid_web_bundle', '静态产物文件类型、链接或大小不匹配。');
      total += stat.size;
      requireValue(files.size < 2048 && total <= 512 * 1024 * 1024, 'invalid_web_bundle', '静态产物数量或总体积超限。');
      const bytes = readFileSync(file); requireValue(bytes.length === stat.size, 'invalid_web_bundle', '静态产物读取期间发生变化。');
      files.set('/' + next.join('/'), { bytes, type: mime[extname(file)] });
    }
  }
  walk(root); requireValue(files.has('/index.html'), 'invalid_web_bundle', '静态产物缺少入口。');
  // 静态包必须来自可信构建方，不是任意用户上传目录；读取后只服务内存快照。
  // 为可信HTML中的首屏主题脚本生成精确哈希，不放开unsafe-inline脚本或eval。
  const hashes = new Set();
  for (const { bytes, type } of files.values()) if (type === 'text/html') {
    for (const match of bytes.toString('utf8').matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
      if (!/\bsrc\s*=/i.test(match[1]) && match[2].trim()) hashes.add("'sha256-" + createHash('sha256').update(match[2]).digest('base64') + "'");
    }
  }
  return { files, scriptHashes: [...hashes].join(' ') };
}

// 日常入口从3000顺延；保留旧客户管理器要求的固定3100兼容入口。
// storage由可信启动工具装配同一个已批准的四文件包，避免跨模块StorageError身份漂移。
export async function startIsolatedAuthorizedWorkbench({ webRoot, dataRoot, initialize = false, storage, credentialKeyProvider, endpoint = { hostname: '127.0.0.1', port: 0 }, networkProxyOptions = {}, initialProxyConfiguration, softwareUpdateOptions = {}, deferActivation = false, onWorkspaceReady } = {}) {
  requireValue(typeof webRoot === 'string' && typeof dataRoot === 'string' && isAbsolute(dataRoot) && typeof initialize === 'boolean' &&
    typeof storage?.openWorkspace === 'function' && typeof storage?.startDataService === 'function' && typeof credentialKeyProvider?.read === 'function' && typeof credentialKeyProvider?.create === 'function', 'invalid_launcher_config', '必须明确传入静态产物、独立数据根及完整存储装配。');
  requireValue(endpoint && typeof endpoint === 'object' && !Array.isArray(endpoint) &&
    Object.keys(endpoint).sort().join(',') === 'hostname,port' &&
    ['127.0.0.1', 'localhost'].includes(endpoint.hostname) &&
    (endpoint.port === 0 || [DEFAULT_WORKBENCH_PORT, 3100].includes(endpoint.port) && endpoint.hostname === 'localhost'),
    'invalid_launcher_endpoint', '只允许本机临时入口或受支持的localhost工作台入口。');
  // 复制值，避免等待期间调用方修改endpoint导致Host/Origin错配；监听始终仅127.0.0.1。
  const { hostname, port } = endpoint;
  let { files, scriptHashes } = readStaticBundle(webRoot);
  let ready = false, gateway, controller, service, workspace, backup, credentialPort, generation, networkProxy, updates, closing = null;
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'self' ${scriptHashes}; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob: data:; font-src 'self'; connect-src 'self' blob: ${service?.url ?? ''}; worker-src 'self' blob:; frame-ancestors 'none'; form-action 'self'; base-uri 'none'`);
    if (!ready) { res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '1' }); res.end('本机工作区尚未就绪。'); req.resume(); return; }
    if (await networkProxy.handle(req, res)) return;
    if (await generation.handle(req, res)) return;
    if (await updates.handle(req, res)) return;
    if (await gateway.handle(req, res)) return;
    const expected = `${hostname}:${server.address().port}`;
    // 普通链接及Chrome错误页重载也可能标成cross-site；只允许顶层GET导航。
    // API由上面的独立处理器继续执行同源和会话校验，嵌入页面与跨站fetch仍拒绝。
    const topLevelNavigation = req.method === 'GET' && !req.headers.origin &&
      req.headers['sec-fetch-mode'] === 'navigate' && req.headers['sec-fetch-dest'] === 'document';
    if (req.headers.host !== expected || req.headers.origin && req.headers.origin !== 'http://' + expected ||
      req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site']) && !topLevelNavigation) {
      res.writeHead(403); res.end(); req.resume(); return;
    }
    let path;
    try { path = decodeURIComponent(req.url); } catch { res.writeHead(400); res.end(); return; }
    if (!['GET', 'HEAD'].includes(req.method) || path.includes('?') || path.includes('\\') || path.split('/').includes('..')) { res.writeHead(404); res.end(); req.resume(); return; }
    const route = path === '/' || /^\/canvas\/[A-Za-z0-9_-]+$/.test(path) ? '/index.html' : path;
    const value = files.get(route);
    if (!value) { res.writeHead(404); res.end(); return; }
    let bytes = value.bytes;
    if (value.type === 'text/html') {
      if (req.method !== 'GET' || req.headers['sec-fetch-mode'] !== 'navigate' || req.headers['sec-fetch-dest'] !== 'document') {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('请直接打开本机工作台地址。'); return;
      }
      // 不新增匿名签发API、不放URL/Cookie或动态脚本；无存储缓存的HTML只交给顶层导航。
      try {
        const html = bytes.toString('utf8');
        requireValue(html.split('</head>').length === 2 && !html.includes('guan-local-bootstrap'), 'invalid_web_bundle', '静态包不兼容自动入口。');
        const ticket = gateway.issueTicket();
        bytes = Buffer.from(html.replace('</head>', '<meta name="guan-local-bootstrap" content="' + ticket.code + '"></head>'));
      } catch { res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '1' }); res.end('本机启动暂时不可用；数据未改动，请稍后重新打开。'); return; }
    }
    res.writeHead(200, { 'Content-Type': value.type + (['text/', 'application/json'].some(type => value.type.startsWith(type)) ? '; charset=utf-8' : ''), 'Content-Length': bytes.length });
    res.end(req.method === 'HEAD' ? undefined : bytes);
  });
  server.requestTimeout = 10_000; server.headersTimeout = 5000; server.keepAliveTimeout = 1000; server.maxConnections = 32; server.maxHeadersCount = 32;
  const closeHTTP = () => new Promise((done, fail) => server.close(error => error ? fail(error) : done()));
  async function cleanup() {
    generation?.assertCanClose();
    const wasReady = ready;
    ready = false;
    try {
      // 更新请求会持有代理租约，先停止检查并排空下载，再核实实际代理活动。
      await updates?.close();
      networkProxy?.assertCanClose();
      generation?.assertCanClose();
    } catch (error) {
      if (wasReady) { updates?.start(); ready = true; }
      throw error;
    }
    const errors = [];
    for (const action of [() => networkProxy?.close(), () => generation?.close(), () => backup?.stop(), () => gateway?.close(), () => controller?.close(),
      () => server.listening ? closeHTTP() : undefined, () => service?.close(), () => credentialPort?.close(), () => workspace?.close()]) {
      try { await action(); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, '隔离工作台清理不完整，请保留数据根并检查锁；没有自动清锁。');
  }
  try {
    await listenWorkbench(server, port, { automatic: port === DEFAULT_WORKBENCH_PORT });
    const origin = 'http://' + hostname + ':' + server.address().port;
    workspace = storage.openWorkspace({ dataRoot, initialize });
    if (onWorkspaceReady) await onWorkspaceReady(workspace);
    credentialPort = await createDeferredCredentialVault({ workspace, keyProvider: credentialKeyProvider, initialize });
    // 一次性授权码已经把数据入口绑定到当前工作台 Origin；生产会话不再使用频率阈值。
    // 服务仍保留并发、体积、CSRF、写入串行和会话期限保护。
    service = await storage.startDataService({ workspace, allowedOrigins: [origin], rateLimit: 0 });
    requireValue(typeof service.createBackup === 'function', 'write_coordination_required', '必须装配已批准的写入/备份协调服务。');
    backup = createBackupCoordinator({ workspaceId: workspace.workspaceId, automatic: false, createBackup: () => service.createBackup() });
    // 用户关闭自动备份；启动、定时及升级均不自动复制工作区。
    await backup.start();
    controller = createSessionController({ service, origin });
    // 工作台页面只由本机入口交付一次性码；已有页面不会再受授权兑换频率阈值影响。
    gateway = createLocalAuthorizationGateway({ origin, dataURL: service.url, controller, credentialPort, rateLimit: 0 });
    requireValue(typeof service.runTrustedWrite === 'function', 'generation_write_coordination_required', '生成任务需要同一写入协调。');
    networkProxy = await assembleNetworkProxyService({ workspace, vault: credentialPort, origin, deferStartup: true, runTrustedWrite: operation => service.runTrustedWrite(operation), authorize: request => gateway.assertGenerationPage(request),
      runtimeOptions: { runtimeParent: join(realpathSync(tmpdir()), 'ai-workbench-proxy-' + workspace.workspaceId), ...networkProxyOptions }, initialConfiguration: initialProxyConfiguration });
    generation = await assembleGenerationService({ workspace, networkProxy, vault: credentialPort, origin, runTrustedWrite: operation => service.runTrustedWrite(operation), authorize: request => gateway.assertGenerationPage(request) });
    updates = assembleSoftwareUpdates({ ...softwareUpdateOptions, dataRoot, origin, networkProxy, generation, authorize: request => gateway.assertGenerationPage(request) });
    updates.start();
    ready = !deferActivation;
    return Object.freeze({ origin, workspaceId: workspace.workspaceId,
      // 开发版在构建成功后一次替换静态快照，保留当前会话和SQLite连接。
      reloadWebBundle() {
        const next = readStaticBundle(webRoot);
        files = next.files; scriptHashes = next.scriptHashes;
        return { files: files.size };
      },
      activate() { requireValue(!closing && service && workspace, 'launcher_stopping', '工作台尚未就绪。', 503); ready = true; },
      issueTicket() { requireValue(ready, 'launcher_stopping', '入口正在停止。', 503); return gateway.issueTicket(); },
      getStatus() { return { ready, authorization: gateway.getStatus(), backup: backup.getStatus(), generation: generation.getStatus(), networkProxy: networkProxy.getStatus(), credentials: credentialPort.getStatus() }; },
      async closeForUpdate() {
        // 同一同步段冻结新导航，再核实零页面与任务；不以页面关闭替代原生任务账本。
        requireValue(ready && !closing, 'launcher_stopping', '工作台已在停止。', 409);
        ready = false;
        try {
          const status = gateway.getStatus();
          requireValue(status.authorizedPages === 0 && status.pendingTickets === 0 && status.activeRequests === 0,
            'install_browsers_running', '请保存并关闭工作台页面，其他网站可继续使用。', 409);
          await generation.assertCanUpdate(); networkProxy.assertCanClose();
          await backup.request('before-maintenance');
          if (!closing) closing = cleanup();
          await closing;
        } catch (error) { if (server.listening) { ready = true; closing = null; updates?.start(); } throw error; }
      },
      async close() {
        // 此函数不证明页面已保存。可信调用者必须先完成维护确认；本实现只用于新建隔离工作区。
        generation?.assertCanClose(); // 忙时不缓存拒绝的closing，任务结束后仍可正常关闭。
        if (!closing) closing = cleanup().catch(error => { if (ready) closing = null; throw error; });
        return closing;
      },
    });
  } catch (error) {
    try { await cleanup(); } catch (failure) { throw new AggregateError([error, failure], '隔离工作台启动失败且清理未完全确认。', { cause: failure }); }
    throw error;
  }
}
