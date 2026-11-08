// 独立后继，原夹具 SHA256 519e107ef4130f0baa9823a4ca6767ee4595abdfb8eeaab3155e5758a3a85c92；本轮采用320x240合成图。故障通过独立浏览器route限制在临时本机请求；不改任务账本。
// 独立后继夹具；迁自 开发工具/迁移扩大整批原工作台夹具.mjs SHA256 3b504e52f1067f1bc197da8c4f825c737adfa4388901895b388e8132ba1c2948。原件不修改。
// 本轮全链批准包的真实React/SQLite启动夹具，不注入授权host，不使用默认Chrome。
import { createRequire, syncBuiltinESMExports } from 'node:module';
import https from 'node:https';
import { createServer, request as httpRequest } from 'node:http';
import { lstatSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline';
import { 读取任务确认与设置边界隔离记录, 核验任务确认与设置边界完整包, 加载任务确认与设置边界磁盘服务 } from './接入任务确认与设置边界隔离副本.mjs';
import { 检查扩大整批类型 } from './预审迁移扩大整批.mjs';
import { 装配代理隔离依赖 } from './网络代理隔离依赖.mjs';
import { 创建完整构建镜像 } from './构建依赖只读镜像.mjs';
import { readFreshRevealCanvas } from './视区跟随原画布夹具.mjs';

export function 构建目录指纹(root) {
  if (realpathSync(root) !== root || !lstatSync(root).isDirectory()) throw Error('构建根必须为实目录');
  const hash = createHash('sha256');
  function visit(path = '') { for (const name of readdirSync(join(root, path)).sort()) {
    const relative = path ? path + '/' + name : name, file = join(root, relative), stat = lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isDirectory() && (!stat.isFile() || stat.nlink !== 1)) throw Error('构建拒绝链接或特殊文件');
    hash.update(relative + '\0'); if (stat.isDirectory()) visit(relative); else hash.update(readFileSync(file));
  } }
  visit(); return hash.digest('hex');
}
export async function createConfirmationWorkbenchFixture(record, built) {
  const integration = 读取任务确认与设置边界隔离记录(record), root = realpathSync(mkdtempSync(join(tmpdir(), 'guan-confirm-ui-')));
  let dist;
  if (built) {
    const path = realpathSync(built.path);
    if (dirname(dirname(path)) !== realpathSync(tmpdir()) || !/^guan-confirm-ui-[A-Za-z0-9]+$/.test(dirname(path).split('/').at(-1)) || path.split('/').at(-1) !== 'dist' || 构建目录指纹(path) !== built.hash) throw Error('只复用明确指纹的本轮临时构建');
    dist = path;
    writeFileSync(join(root, '复用构建.json'), JSON.stringify({ ...built, record, 说明: '仅复用本轮已经完整类型检查和构建的前端产物；新建空白SQLite及随机内存密钥。' }), { flag: 'wx' });
  } else {
  const typeEvidence = 检查扩大整批类型({ integration, delta: new Map() });
  writeFileSync(join(root, '磁盘类型检查.json'), JSON.stringify(typeEvidence, null, 2), { flag: 'wx' });
  console.log('CONFIRM_DISK_TYPES_OK');
  const buildMirror = 创建完整构建镜像(integration), buildWeb = buildMirror.web;
  const require = createRequire(join(buildWeb, 'package.json'));
  writeFileSync(join(root, '构建依赖.json'), JSON.stringify(buildMirror.report, null, 2), { flag: 'wx' });
  const { build } = await import(pathToFileURL(require.resolve('vite')).href); dist = join(root, 'dist');
  await build({ root: buildWeb, configFile: join(buildWeb, 'vite.config.ts'), cacheDir: join(root, 'cache'), logLevel: 'warn', build: { outDir: dist, emptyOutDir: false },
    css: { postcss: { plugins: [require('@tailwindcss/postcss')({ base: join(buildWeb, 'src') })] } } });
  核验任务确认与设置边界完整包(integration.组合包, true);
  console.log('CONFIRM_DISK_BUILD_OK');
  writeFileSync(join(root, '构建指纹.json'), JSON.stringify({ record, dist, hash: 构建目录指纹(dist) }), { flag: 'wx' });
  }
  const approved = await 加载任务确认与设置边界磁盘服务(integration);
  const dependency = 装配代理隔离依赖(integration);
  const { startIsolatedAuthorizedWorkbench } = await import(pathToFileURL(join(integration.副本, '扩展功能/本机服务/受限工作台启动器.mjs')).href);
  const material = randomBytes(32), dataRoot = join(root, '数据'); let launcher, workspace, initialized = false;
  const requests = [], controls = { delayMs: 0, failMedia: false }; let active = 0, maxActive = 0;
  const provider = createServer(async (req, res) => {
    active++; maxActive = Math.max(maxActive, active);
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const secret = req.headers.authorization?.replace(/^Bearer /, '') || req.headers['x-goog-api-key'];
      if (typeof secret !== 'string' || !secret.startsWith('synthetic-')) throw Error('只接受合成凭据');
      const status = secret.includes('reject') ? 429 : secret.includes('unknown') ? 500 : 200;
      const body = Buffer.concat(chunks), contentType = String(req.headers['content-type'] || ''), references = [];
      let model, bodyKeys;
      if (contentType.startsWith('multipart/form-data')) {
        const form = await new Response(body, { headers: { 'content-type': contentType } }).formData();
        model = form.get('model'); bodyKeys = [...new Set(form.keys())].sort();
        for (const [name, file] of form) if (file instanceof Blob) references.push({ name, bytes: file.size, mimeType: file.type, SHA256: createHash('sha256').update(Buffer.from(await file.arrayBuffer())).digest('hex') });
      } else {
        const requestBody = JSON.parse(body.toString('utf8'));
        model = requestBody.model; bodyKeys = Object.keys(requestBody).sort();
      }
      requests.push({ path: req.url, status, bytes: body.length, model, referenceImages: references.length, references, bodyKeys });
      if (controls.delayMs) await new Promise(done => setTimeout(done, controls.delayMs));
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(status === 200 ? { data: [{ b64_json: 'iVBORw0KGgoAAAANSUhEUgAAAUAAAADwCAIAAAD+Tyo8AAAECElEQVR4nO3T6ZYQAhzG4fdyZN+KLFEUQmSJ7KWZmpapaZlSFEWSUgrRwj39r8g9+OK85zznPBfw+/LLfXsGKJX/vQD4zwwMxbJmzwClsmZhgFIGhmK5f2GAUgaGYrl/cYBSeWBxgFIGhmIGhmJ5cO8ApQwMxQwMxfLQ3gFK5aF9A5QyMBTLw/sGKGVgKJaHlwYolUeWBihlYChmYCiWR/cPUMrAUMzAUCyP7R+gVB47MEApA0OxPH5ggFIGhmJ5/OAApfLEwQFKGRiKGRiK5clDA5QyMBQzMBTL2kMDlMra5QFKGRiKZd3yAKUMDMWy7vAApfLU4QFKGRiKGRiK5ekjA5QyMBQzMBTL+iMDlMr6lQFKGRiK5ZmVAUoZGIrlmaMDlMqzRwcoZWAoZmAolueODVDKwFDMwFAszx8boFSePz5AKQNDsWw4PkApA0OxbDgxQKm8cGKAUgaGYgaGYnlxdYBSBoZiBoZi2bg6QKlsPDlAKQNDsWw6OUApA0OxbDo1QKm8dGqAUgaGYgaGYnn5qwFKGRiKGRiKZfNXA5TK5tMDlDIwFMuW0wOUMjAUy5YzA5TKK2cGKGVgKGZgKJZXvx6glIGhmIGhWF77eoBSee2bAUoZGIpl6zcDlDIwFMvWswOUyutnByhlYChmYCiWN84NUMrAUMzAUCxvnhugVN78doBSBoZi2fbtAKUMDMWy7bsBSuWt7wYoZWAoZmAolrfPD1DKwFDMwFAs288PUCrbLwxQysBQLO9cGKCUgaFY3vl+gFJ59/sBShkYihkYiuW9HwYoZWAoZmAolvd/GKBU3r84QCkDQ7HsuDhAKQNDsez4cYBS+eDHAUoZGIoZGIrlw0sDlDIwFDMwFMvOSwOUys6fBihlYCiWj34aoJSBoVg+ujxAqXx8eYBSBoZiBoZi+eTnAUoZGIoZGIrl058HKJVPrwxQysBQLJ9dGaCUgaFYPrs6QKl8fnWAUgaGYgaGYvnilwFKGRiKGRiKZdcvA5TKrmsDlDIwFMvuawOUMjAUy+7rA5TKl9cHKGVgKGZgKJY9vw5QysBQzMBQLAu/DlAqCzcGKGVgKJbFGwOUMjAUy+LNAUpl780BShkYihkYimXfbwOUMjAUMzAUy9JvA5TK0u8DlDIwFMv+3wcoZWAolv1/DFAqB/4YoJSBoZiBoVgO3hqglIGhmIGhWA7dGqBUDv05QCkDQ7Es/zlAKQNDsSz/NUCpHP5rgFIGhmIGhmI5cnuAUgaGYgaGYlm5PUCprNwZoJSBoViO3hmglIGhWI7eHaBUjt0doJSBoZiBoViO3xuglIGhmIGhWE7cG6BUTvw9QCkDQ7Gs/j1AKQNDsaz+M0CpnPxngFIGhmIGhmL/AoZDIMaigLhDAAAAAElFTkSuQmCC' }] } : { error: { message: '合成渠道响应' } }));
    } finally { active--; }
  });
  await new Promise(done => provider.listen(0, '127.0.0.1', done));
  const originalHTTPS = https.request, providerOrigin = 'http://127.0.0.1:' + provider.address().port;
  https.request = (url, options, callback) => {
    if (url.origin !== 'https://api.fixture.example' || typeof options.lookup !== 'function') throw Error('隔离夹具拒绝非合成目标');
    return httpRequest(new URL(url.pathname + url.search, providerOrigin), { method: options.method, headers: options.headers, signal: options.signal, agent: false }, callback);
  };
  syncBuiltinESMExports();
  async function cleanup() {
    try { await stop(); } finally {
      material.fill(0); https.request = originalHTTPS; syncBuiltinESMExports();
      dependency.close();
      await new Promise(done => { provider.closeAllConnections(); provider.close(done); });
    }
  }
  async function start() {
    launcher = await startIsolatedAuthorizedWorkbench({ webRoot: dist, dataRoot, initialize: !initialized,
      credentialKeyProvider: { read: async () => Buffer.from(material), create: async () => Buffer.from(material) }, endpoint: { hostname: 'localhost', port: 0 },
      storage: { ...approved, openWorkspace(options) {
        const actual = approved.openWorkspace(options);
        workspace = { ...actual,
          writeMedia(...args) { if (controls.failMedia) throw Error('SYNTHETIC_MEDIA_SAVE_FAILURE'); return actual.writeMedia(...args); },
          writeMediaBatch(...args) { if (controls.failMedia) throw Error('SYNTHETIC_MEDIA_SAVE_FAILURE'); return actual.writeMediaBatch(...args); } };
        return workspace;
      } } });
    initialized = true; return { origin: launcher.origin, root, dataRoot };
  }
  async function stop() { if (launcher) { await launcher.close(); launcher = null; } }
  try {
    const info = await start();
    return { ...info, async evidence() {
      const canvas = await readFreshRevealCanvas({ readDocument: (...args) => workspace.readDocument(...args), readMedia: id => workspace.readMedia(id) });
      const documents = workspace.listDocuments('extension').filter(item => /^(?:guan-generation-ledger|guan-fallback)/.test(item.id)).map(item => workspace.readDocument('extension', item.id));
      const artifact = join(root, '画布证据-' + Date.now() + '.json'), value = { canvas, status: launcher.getStatus(), documents, requests, maxActive };
      writeFileSync(artifact, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); return { artifact, ...value };
    }, control(value) {
      if (!Number.isInteger(value.delayMs) || value.delayMs < 0 || value.delayMs > 10_000 || typeof value.failMedia !== 'boolean') throw Error('合成故障参数无效');
      Object.assign(controls, { delayMs: value.delayMs, failMedia: value.failMedia }); return { ...controls };
    }, stop, async restart() { await stop(); return start(); }, close: cleanup };
  } catch (error) { await cleanup(); throw error; }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (![3, 5].includes(process.argv.length) || !process.argv[2].startsWith('--隔离记录=') || process.argv.length === 5 && (!process.argv[3].startsWith('--已构建目录=') || !/^--构建SHA256=[a-f0-9]{64}$/.test(process.argv[4]))) throw Error('只接受本轮隔离记录与可选的精确临时构建');
  const fixture = await createConfirmationWorkbenchFixture(process.argv[2].slice('--隔离记录='.length), process.argv.length === 5 ? { path: process.argv[3].slice('--已构建目录='.length), hash: process.argv[4].slice('--构建SHA256='.length) } : undefined);
  console.log('CONFIRM_UI_READY ' + JSON.stringify({ origin: fixture.origin, root: fixture.root, dataRoot: fixture.dataRoot }));
  const input = createInterface({ input: process.stdin });
  for await (const line of input) {
    try {
      const command = JSON.parse(line);
      if (command.op === 'evidence') console.log('CONFIRM_UI_RESULT ' + JSON.stringify(await fixture.evidence()));
      else if (command.op === 'summary') { const e = await fixture.evidence(); console.log('CONFIRM_UI_RESULT ' + JSON.stringify({ artifact: e.artifact, status: e.status, requests: e.requests, maxActive: e.maxActive, jobs: e.documents.find(d => d.id === 'guan-generation-ledger-v1')?.value.jobs })); }
      else if (command.op === 'control') console.log('CONFIRM_UI_RESULT ' + JSON.stringify(fixture.control(command)));
      else if (command.op === 'restart') console.log('CONFIRM_UI_RESULT ' + JSON.stringify(await fixture.restart()));
      else if (command.op === 'exit') break;
      else throw Error('未知控制命令');
    } catch (error) { console.log('CONFIRM_UI_ERROR ' + error.message); }
  }
  input.close(); process.stdin.pause(); await fixture.close();
}
