import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:net';
import { request } from 'node:http';
import { lstat, readFile, realpath, mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { spawnProxyProcess, stopProxyProcess } from './旧版进程管理.mjs';
import { buildIsolatedProxyConfig } from './配置边界.mjs';
import { 清理中断代理目录, 记录代理目录所有者 } from './代理运行目录保护.mjs';
import { 开始目录写入监测 } from '../本机服务/目录写入监测.mjs';
import { 诊断代理连接, 检测全部代理节点 } from './代理节点诊断.mjs';
import { StorageError, requireValue } from '../本机存储/协议.mjs';

export async function assertProxyPortsAvailable(port) {
  requireValue(Number.isInteger(port) && port >= 1024 && port < 65535, 'proxy_port_invalid', '代理端口无效。');
  const listeners = [];
  try { for (const value of [port, port + 1]) { const server = createServer(); listeners.push(server); await new Promise((done, fail) => { server.once('error', fail); server.listen(value, '127.0.0.1', done); }); } }
  catch { throw new StorageError('proxy_port_occupied', '代理端口被占用，未连接或停止其他进程。', 409); }
  finally { await Promise.all(listeners.filter(server => server.listening).map(server => new Promise(done => server.close(done)))); }
}
async function verifyCore(core) {
  requireValue(core && isAbsolute(core.path) && /^[a-f0-9]{64}$/.test(core.sha256), 'proxy_core_missing', '尚未配置经过校验的内置代理核心。', 503);
  const stat = await lstat(core.path);
  requireValue(await realpath(core.path) === core.path && stat.isFile() && stat.nlink === 1 && !stat.isSymbolicLink() && stat.size <= 128 * 1024 * 1024 &&
    (stat.mode & 0o111) && !(stat.mode & 0o6022), 'proxy_core_invalid', '代理核心文件权限或来源不符合要求。', 503);
  const digest = createHash('sha256').update(await readFile(core.path)).digest('hex');
  requireValue(timingSafeEqual(Buffer.from(digest), Buffer.from(core.sha256)), 'proxy_core_invalid', '代理核心指纹不匹配，未执行。', 503);
}
export function createMihomoRuntime({ core, runtimeParent, port = 23210, coreArguments = [], startupTimeout = 15_000, requestProbe } = {}) {
  requireValue(typeof runtimeParent === 'string' && isAbsolute(runtimeParent) && Array.isArray(coreArguments) && coreArguments.every(value => typeof value === 'string') &&
    Number.isInteger(startupTimeout) && startupTimeout >= 100 && startupTimeout <= 120_000, 'proxy_runtime_invalid', '代理运行目录或启动参数无效。');
  let active = null, starting = false;
  return Object.freeze({
    async start(source) {
      requireValue(!active && !starting, 'proxy_already_running', '代理已经运行。', 409);
      starting = true;
      try {
      await verifyCore(core); await assertProxyPortsAvailable(port);
      await mkdir(runtimeParent, { recursive: true, mode: 0o700 });
      requireValue(await realpath(runtimeParent) === runtimeParent && (await lstat(runtimeParent)).isDirectory(), 'proxy_runtime_invalid', '代理运行目录不能使用链接。');
      await 清理中断代理目录(runtimeParent);
      const directory = await mkdtemp(join(runtimeParent, 'workbench-proxy-'));
      const token = randomBytes(32).toString('hex'), password = randomBytes(32).toString('hex');
      let child, monitor, writeFailure = null, cleaning = null, stopping = null;
      const cleanup = () => {
        if (!cleaning) cleaning = (async () => { monitor?.stop(); await rm(directory, { recursive: true, force: true }); active = null; })();
        return cleaning;
      };
      try {
        await 记录代理目录所有者(directory);
        const config = buildIsolatedProxyConfig(source, { port, controllerToken: token, proxyPassword: password });
        const file = join(directory, 'config.yaml'); await writeFile(file, config, { mode: 0o600, flag: 'wx' });
        if (core.model) {
          const info = await lstat(core.model.path);
          requireValue(info.isFile() && !info.isSymbolicLink() && info.nlink === 1 && !(info.mode & 0o022) && info.size === core.model.size && info.size <= 16 * 1024 ** 2,
            'proxy_core_invalid', 'Smart模型文件无效。', 503);
          const model = await readFile(core.model.path);
          requireValue(createHash('sha256').update(model).digest('hex') === core.model.sha256, 'proxy_core_invalid', 'Smart模型指纹无效。', 503);
          await writeFile(join(directory, 'Model.bin'), model, { mode: 0o600, flag: 'wx' });
        }
        child = spawnProxyProcess(core.path, [...coreArguments, '-d', directory, '-f', file], {
          cwd: directory, stdio: ['ignore', 'ignore', 'ignore'],
          // 不继承用户的代理、自动下载或私人路径环境设置。
          env: { PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8', TMPDIR: directory },
        });
        await 记录代理目录所有者(directory, child.pid || null);
        child.once('exit', () => { void cleanup().catch(() => {}); });
        monitor = 开始目录写入监测(directory, { maxBytes: 256 * 1024 ** 2, reserveBytes: 1024 ** 3 }, error => {
          writeFailure = error.code || 'proxy_disk_limit';
          void stopProxyProcess(child).then(cleanup).catch(() => {});
        });
        const api = (path, { method = 'GET', value } = {}) => new Promise((resolve, reject) => {
          if (writeFailure) { reject(new StorageError('proxy_disk_limit', '代理缓存达到限制，已停止代理并保留工作台数据。', 503)); return; }
          if (child.exitCode !== null || child.signalCode !== null) { reject(new StorageError('proxy_core_exited', '内置代理进程已退出。', 503)); return; }
          const bytes = value === undefined ? undefined : Buffer.from(JSON.stringify(value));
          const req = request({ hostname: '127.0.0.1', port: port + 1, path, method, agent: false,
            headers: { Authorization: 'Bearer ' + token, ...(bytes ? { 'content-type': 'application/json', 'content-length': bytes.length } : {}) } }, res => {
            const chunks = []; let size = 0;
            res.on('data', chunk => { size += chunk.length; if (size > 1024 * 1024) res.destroy(); else chunks.push(chunk); });
            res.once('error', () => reject(new StorageError('proxy_controller_failed', '代理控制请求未确认。', 503)));
            res.once('end', () => {
              try { requireValue(res.statusCode >= 200 && res.statusCode < 300, 'proxy_controller_failed', '代理控制请求失败。', 503); resolve(size ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
              catch { reject(new StorageError('proxy_controller_failed', '代理控制请求失败。', 503)); }
            });
          });
          req.setTimeout(6500, () => req.destroy()); req.once('error', () => reject(new StorageError('proxy_controller_failed', '代理控制连接失败。', 503))); req.end(bytes);
        });
        const until = Date.now() + startupTimeout;
        for (;;) {
          try { const version = await api('/version'); requireValue(typeof version.version === 'string', 'proxy_core_invalid', '代理核心未就绪。'); break; }
          catch { requireValue(child.exitCode === null && child.signalCode === null && Date.now() < until, 'proxy_start_failed', '代理启动未通过认证健康检查。', 503); await new Promise(done => setTimeout(done, 50)); }
        }
        const smartGroups = Object.values((await api('/proxies')).proxies || {}).filter(group => group.type === 'Smart' && group.useLightGBM === true);
        const handle = Object.freeze({
          smartStatus: () => ({ enabled: smartGroups.length > 0, groups: smartGroups.length, modelBundled: Boolean(core.model) }),
          running: () => !writeFailure && child.exitCode === null && child.signalCode === null,
          route: () => ({ proxyURL: 'http://127.0.0.1:' + port, username: 'workbench', password }),
          async inspect() {
            const data = await api('/proxies'), entries = Object.entries(data.proxies || {}).slice(0, 2048);
            return entries.map(([name, v]) => ({ name: String(name).slice(0, 256), type: String(v.type || '').slice(0, 40),
              selected: typeof v.now === 'string' ? v.now.slice(0, 256) : '', choices: Array.isArray(v.all) ? v.all.filter(item => typeof item === 'string').slice(0, 2048) : [] }));
          },
          async select(group, name) {
            const nodes = await handle.inspect(), target = nodes.find(node => node.name === group);
            requireValue(target?.type === 'Selector' && target.choices.includes(name), 'proxy_node_denied', '只允许选择当前配置中的可选节点。');
            await api('/proxies/' + encodeURIComponent(group), { method: 'PUT', value: { name } }); return handle.inspect();
          },
          async diagnose() {
            return 诊断代理连接({ api, route: handle.route(), probe: requestProbe });
          },
          testAll: () => 检测全部代理节点({ api, route: handle.route(), probe: requestProbe }),
          stop() { if (!stopping) stopping = (async () => { await stopProxyProcess(child); await cleanup(); if (active === handle) active = null; })(); return stopping; },
        });
        active = handle; return handle;
      } catch (error) { if (child) await stopProxyProcess(child); await cleanup(); throw error; }
      } finally { starting = false; }
    },
  });
}
