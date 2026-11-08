// 独立后继，旧测试 SHA256 995b6c23c86cfed196b4fc700bf50356ffb3e49611432fbfe648c3c6b3196376；本轮增加磁盘客户端confirmSaved及真实HTTP ACK丢失。
// 只加载已批准磁盘包；HTTPS最后一跳在本测试进程映射至合成HTTP服务器，不访问真实API。
import assert from 'node:assert/strict';
import test from 'node:test';
import https from 'node:https';
import { createServer, request as httpRequest } from 'node:http';
import { syncBuiltinESMExports } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { 读取任务确认与设置边界隔离记录, 核验任务确认与设置边界完整包, 加载任务确认与设置边界磁盘服务 } from './接入任务确认与设置边界隔离副本.mjs';
import { 装配代理隔离依赖 } from './网络代理隔离依赖.mjs';

test('批准磁盘包：真实授权/任务HTTP/SQLite保存/停机保护/备份恢复及冷重开', async t => {
  const record = process.env.GUAN_CONFIRM_TEST_RECORD;
  assert.ok(record, '必须明确指定本轮隔离记录');
  const integration = 读取任务确认与设置边界隔离记录(record), modules = await 加载任务确认与设置边界磁盘服务(integration);
  const dependency = 装配代理隔离依赖(integration); t.after(() => dependency.close());
  const load = path => import(pathToFileURL(join(integration.副本, path)).href);
  const { startIsolatedAuthorizedWorkbench } = await load('扩展功能/本机服务/受限工作台启动器.mjs');
  const { authorizeLocalStorage } = await load('web/src/guan/sqlite/本机授权客户端.mjs');
  const { createRenewingDataClient } = await load('web/src/guan/sqlite/续期数据客户端.mjs');
  const { createValueCodec } = await load('web/src/guan/sqlite/应用值编码.mjs');
  const { buildFragmentPlan } = await load('扩展功能/本机存储/分片值编码.mjs');
  const root = mkdtempSync(join(tmpdir(), 'guan-confirm-disk-')), webRoot = join(root, 'web');
  mkdirSync(webRoot); writeFileSync(join(webRoot, 'index.html'), '<!doctype html><title>隔离协议夹具（非工作台UI）</title>');
  const key = randomBytes(32), keyProvider = { read: async () => Buffer.from(key), create: async () => Buffer.from(key) };
  let release, held = null, failMedia = false, launcher, workspace, service, origin;
  let loseAppliedAck = false;
  const requests = [], rawSecrets = [], evidence = [];
  const provider = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    requests.push({ method: req.method, path: req.url, bytes: Buffer.concat(chunks).length });
    assert.ok(req.headers.authorization?.startsWith('Bearer synthetic-') || req.headers['x-goog-api-key']?.startsWith('synthetic-'));
    if (held) await held;
    const status = req.headers.authorization?.includes('reject') ? 429 : req.headers.authorization?.includes('unknown') ? 500 : 200;
    requests.at(-1).status = status;
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ data: [{ b64_json: 'aXNvbGF0ZWQ=' }] }));
  });
  await new Promise(done => provider.listen(0, '127.0.0.1', done));
  const providerOrigin = 'http://127.0.0.1:' + provider.address().port, originalHTTPS = https.request;
  // 严格只映射一个合成主机。未经批准的任何HTTPS调用直接抛错；不回退真实网络。
  https.request = (url, options, callback) => {
    assert.equal(url.origin, 'https://api.fixture.example');
    assert.equal(typeof options.lookup, 'function');
    return httpRequest(new URL(url.pathname + url.search, providerOrigin), { method: options.method, headers: options.headers, signal: options.signal, agent: false }, callback);
  };
  syncBuiltinESMExports();
  const dataRoot = join(root, '数据');
  async function start(target = dataRoot, initialize = false) {
    launcher = await startIsolatedAuthorizedWorkbench({ webRoot, dataRoot: target, initialize,
      endpoint: { hostname: 'localhost', port: 0 }, credentialKeyProvider: keyProvider,
      storage: { ...modules, openWorkspace(options) {
        const actual = modules.openWorkspace(options);
        workspace = { ...actual,
          writeMedia(...args) { if (failMedia) throw Error('SYNTHETIC_MEDIA_SAVE_FAILURE'); return actual.writeMedia(...args); },
          writeMediaBatch(...args) { if (failMedia) throw Error('SYNTHETIC_MEDIA_SAVE_FAILURE'); return actual.writeMediaBatch(...args); } };
        return workspace;
      }, async startDataService(options) { service = await modules.startDataService(options); return service; } } });
    origin = launcher.origin;
  }
  async function authorize() {
    const fetchImpl = async (url, init = {}) => {
      const response = await fetch(url, { ...init, headers: { ...init.headers, Origin: origin } });
      if (loseAppliedAck && url.endsWith('/generation') && JSON.parse(init.body).operation === 'applied') {
        loseAppliedAck = false; await response.arrayBuffer(); throw Error('SYNTHETIC_LOST_APPLIED_ACK');
      }
      return response;
    };
    const auth = await authorizeLocalStorage({ origin, code: launcher.issueTicket().code, fetchImpl });
    const client = createRenewingDataClient({ url: auth.url, host: auth.host, origin, fetchImpl });
    await client.readUsage(); // 必须先建立真实数据租约，不能只凭页面能力提交生成。
    return { auth, client, generation: auth.generationPort };
  }
  const input = (binding, kind = 'openai') => ({ id: randomUUID(), productId: 'product-A', nodeId: 'result-A', binding,
    request: { method: 'POST', path: kind === 'gemini' ? '/v1beta/models/synthetic:generateContent' : '/v1/images/generations', contentType: 'application/json', body: Buffer.from('{"model":"synthetic","prompt":"隔离验收"}').toString('base64') } });
  async function settled(client, id) {
    for (let i = 0; i < 150; i++) {
      const job = await client.get(id);
      if (['succeeded', 'failed', 'uncertain', 'cancelled'].includes(job.state) && launcher.getStatus().generation.running === 0) return job;
      await new Promise(done => setTimeout(done, 20));
    }
    throw Error('合成任务未在时限内结束');
  }
  async function save(client, job) {
    const codec = createValueCodec({ client }), encoded = await codec.encode({ state: { projects: [{ id: job.productId,
      nodes: [{ id: job.nodeId, metadata: { status: 'success', gatewayGenerationReceipts: [{ taskId: job.id, responseHash: job.result.id }] } }] }] }, version: 0 });
    const entries = [['infinite-canvas:canvas_store', encoded]], plan = await buildFragmentPlan(entries);
    for (const part of plan.fragments.values()) if (!await client.readDocument('extension', part.id, { allowMissing: true })) await client.writeDocument({ collection: 'extension', id: part.id, value: part.value, expectedRevision: 0, operationId: randomUUID() });
    const id = 'app-' + createHash('sha256').update('app_state').digest('hex'), before = await client.readDocument('extension', id, { allowMissing: true });
    const ack = await client.writeDocument({ collection: 'extension', id, value: { format: 'guan-app-storage.v2', namespace: 'app_state', entryCount: 1, head: plan.head }, expectedRevision: before?.revision || 0, operationId: randomUUID() });
    return { rootRevision: ack.revision, rootHash: ack.hash };
  }
  function contains(rootPath, text) {
    return readdirSync(rootPath, { withFileTypes: true }).some(item => item.isDirectory() ? contains(join(rootPath, item.name), text) : readFileSync(join(rootPath, item.name)).includes(Buffer.from(text)));
  }
  try {
    await start(dataRoot, true);
    const page = await authorize(), secret = 'synthetic-' + randomUUID(); rawSecrets.push(secret);
    assert.equal(typeof page.generation.read, 'undefined');
    const bound = await page.generation.bind({ kind: 'openai', endpoint: 'https://api.fixture.example', value: secret });
    assert.deepEqual(Object.keys(bound).sort(), ['binding', 'endpoint', 'kind']);
    const task = input(bound.binding);
    held = new Promise(done => { release = done; });
    await Promise.all([page.generation.submit(task), page.generation.submit(task)]);
    await assert.rejects(launcher.close(), error => error.code === 'generation_busy');
    assert.equal(launcher.getStatus().ready, true);
    release(); held = null;
    assert.equal((await settled(page.generation, task.id)).state, 'succeeded');
    assert.equal(requests.length, 1);
    evidence.push('真实授权租约、无read端口、同ID并发去重、忙时拒绝关闭且服务仍可用');
    await assert.rejects(page.generation.deliver(task, { applyAndSave: async () => { throw Error('SYNTHETIC_CANVAS_SAVE_FAILURE'); } }));
    assert.equal((await page.generation.get(task.id)).applied, false);
    await assert.rejects(page.generation.deliver({ ...task, productId: 'product-B' }, { applyAndSave: () => { throw Error('跨产品不应触发保存'); } }));
    await assert.rejects(page.generation.deliver(task, { applyAndSave: async () => ({ saved: true }) }));
    const savedJob = await page.generation.get(task.id); await save(page.client, savedJob);
    await assert.rejects(page.generation.confirmSaved({ ...task, nodeId: 'other-node' }, { responseHash: savedJob.result.id }));
    await assert.rejects(page.generation.confirmSaved(task, { responseHash: '0'.repeat(64) }));
    loseAppliedAck = true;
    await assert.rejects(page.generation.confirmSaved(task, { responseHash: savedJob.result.id }));
    assert.equal((await page.generation.get(task.id)).applied, true);
    assert.equal((await page.generation.confirmSaved(task, { responseHash: savedJob.result.id })).applied, true);
    evidence.push('实际磁盘confirmSaved：拒绝错节点/摘要，真实HTTP applied落盘后丢ACK，原ID重复确认恢复且无新渠道请求');
    assert.equal(requests.length, 1);
    evidence.push('原产品/原节点/v2分片保存ACK核验，拒绝saved:true，保存重试无API重发');
    for (const id of [bound.binding, 'guan-generation-ledger-v1']) await assert.rejects(page.client.writeDocument({ collection: 'extension', id, value: {}, expectedRevision: 0, operationId: randomUUID() }), error => error.code === 'reserved_generation_document');
    evidence.push('浏览器HTTP禁止篡改provider绑定及任务账本');
    failMedia = true;
    const pending = input(bound.binding); await page.generation.submit(pending);
    assert.equal((await settled(page.generation, pending.id)).reason, 'result_save_unconfirmed');
    assert.equal(launcher.getStatus().generation.unpersistedResults, 1);
    await assert.rejects(launcher.close(), error => error.code === 'generation_busy');
    failMedia = false;
    assert.equal((await page.generation.retryResultSave(pending.id)).state, 'succeeded');
    assert.equal(requests.length, 2);
    evidence.push('真实磁盘媒体保存故障：未决结果阻止关闭；重试仅保存不重新请求');
    const geminiSecret = 'synthetic-' + randomUUID(); rawSecrets.push(geminiSecret);
    const gemini = await page.generation.bind({ kind: 'gemini', endpoint: 'https://api.fixture.example', value: geminiSecret });
    const geminiTask = input(gemini.binding, 'gemini'); await page.generation.submit(geminiTask);
    assert.equal((await settled(page.generation, geminiTask.id)).state, 'succeeded');
    assert.equal(requests.length, 3);
    const { emptyFallback } = await load('扩展功能/故障切换/原版策略.mjs');
    const policy = emptyFallback(); policy.enabled = true;
    for (const key of ['image', 'video', 'text', 'audio']) policy.capabilities[key] = { enabled: true, entries: [
      { profileId: 'A', modelName: 'synthetic-A', enabled: true }, { profileId: 'B', modelName: 'synthetic-B', enabled: true },
    ] };
    const savedPolicy = await page.generation.fallbackCommand({ operation: 'fallback-save', value: policy, revision: 0 });
    assert.equal(savedPolicy.revision, 1);
    await assert.rejects(page.generation.fallbackCommand({ operation: 'fallback-save', value: emptyFallback(), revision: 0 }));
    const reject = await page.generation.bind({ kind: 'openai', endpoint: 'https://api.fixture.example', value: 'synthetic-reject' });
    const unknown = await page.generation.bind({ kind: 'openai', endpoint: 'https://api.fixture.example', value: 'synthetic-unknown' });
    async function routed(first) {
      const requestList = [first, bound].map((_, index) => ({ method: 'POST', path: '/v1/images/generations', contentType: 'application/json', body: Buffer.from(JSON.stringify({ model: 'synthetic-' + (index ? 'B' : 'A'), prompt: '合成切换' })).toString('base64') }));
      const plan = { mode: 'fallback', capability: 'image', revision: savedPolicy.revision, candidates: [first, bound].map((entry, index) => ({
        profileId: index ? 'B' : 'A', modelName: 'synthetic-' + (index ? 'B' : 'A'), channelName: '合成渠道', binding: entry.binding,
        requestHash: createHash('sha256').update(JSON.stringify(requestList[index])).digest('hex'), quality: 'auto', size: '1024x1024',
      })) };
      const route = await page.generation.createPlan(plan), job = input(route.binding);
      job.request.body = Buffer.from(JSON.stringify({ format: 'guan-routed-image-request.v1', requests: requestList })).toString('base64');
      await page.generation.submit(job); return { task: job, result: await settled(page.generation, job.id) };
    }
    const switched = await routed(reject);
    assert.equal(switched.result.state, 'succeeded');
    assert.deepEqual(requests.slice(-2).map(item => item.status), [429, 200]);
    const trace = workspace.readDocument('extension', 'guan-fallback-attempt:' + switched.task.id);
    assert.deepEqual(trace.value.attempts.map(item => item.status), [429, 200]);
    const uncertain = await routed(unknown);
    assert.notEqual(uncertain.result.state, 'succeeded'); assert.equal(requests.length, 6);
    assert.equal(workspace.readDocument('extension', 'guan-fallback-attempt:' + uncertain.task.id).value.attempts.length, 1);
    evidence.push('磁盘收尾完整包实际HTTP：四类Fallback保存、冲突拒绝、429顺序切换与持久日志、500只发一次');
    await page.auth.host.close();
    await assert.rejects(page.generation.get(task.id));
    evidence.push('Gemini认证头及受限路径通过合成渠道；页面撤销后端口拒绝访问');
    const backup = await service.createBackup();
    for (const value of rawSecrets) assert.equal(contains(backup.path, value), false);
    const expectedLedger = workspace.readDocument('extension', 'guan-generation-ledger-v1');
    const expectedBindings = [bound.binding, gemini.binding].map(id => workspace.readDocument('extension', id));
    await launcher.close(); launcher = null;
    const db = new DatabaseSync(join(dataRoot, '工作台.sqlite'), { readOnly: true });
    try { assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok'); assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0); } finally { db.close(); }
    await start();
    const reopened = await authorize();
    assert.equal((await reopened.generation.get(task.id)).applied, true);
    assert.equal((await reopened.generation.get(pending.id)).state, 'succeeded');
    assert.equal((await reopened.generation.describe(bound.binding)).binding, bound.binding);
    await reopened.generation.submit(task); assert.equal(requests.length, 6);
    assert.deepEqual((await reopened.generation.fallbackCommand({ operation: 'fallback-load' })).value, policy);
    await reopened.client.close(); await launcher.close(); launcher = null;
    const target = join(root, '恢复数据'); modules.restoreBackup({ backupRoot: backup.path, targetRoot: target });
    await start(target);
    const restored = await authorize();
    assert.equal(workspace.readDocument('extension', 'guan-generation-ledger-v1').hash, expectedLedger.hash);
    for (const value of expectedBindings) assert.equal(workspace.readDocument('extension', value.id).hash, value.hash);
    assert.equal((await restored.generation.get(task.id)).applied, true);
    assert.equal((await restored.generation.get(pending.id)).state, 'succeeded');
    const newTask = input(bound.binding); await restored.generation.submit(newTask);
    assert.equal((await settled(restored.generation, newTask.id)).state, 'succeeded');
    assert.equal(requests.length, 7); // 同一内存主密钥恢复密文可用；不是跨机无密钥恢复承诺。
    await restored.client.close(); await launcher.close(); launcher = null;
    evidence.push('备份不含合成明文密钥，账本/绑定/密文/媒体恢复一致；冷重开无重发，原密钥恢复可用');
    核验任务确认与设置边界完整包(integration.组合包, true);
    writeFileSync(join(root, '验收证据.json'), JSON.stringify({ record, root, dataRoot, backup: backup.path, restored: target, checks: evidence,
      requests, httpsBoundary: '测试进程内映射最后一跳；未验证公网DNS/TLS或真实付费服务', productionTouched: false }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    t.diagnostic('DISK_GATEWAY_EVIDENCE ' + join(root, '验收证据.json'));
    for (const value of evidence) t.diagnostic(value);
  } finally {
    failMedia = false; release?.(); held = null;
    if (launcher) await launcher.close();
    https.request = originalHTTPS; syncBuiltinESMExports();
    await new Promise(done => { provider.closeAllConnections(); provider.close(done); }); key.fill(0);
  }
});
