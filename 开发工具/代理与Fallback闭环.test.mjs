import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createServer as httpServer } from 'node:http';
import { createServer as httpsServer } from 'node:https';
import { connect } from 'node:net';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { emptyFallback, editFallback, enabledEntries, reconcileFallback } from '../扩展功能/故障切换/原版策略.mjs';
import { createFallbackStore, hashJSON, FALLBACK_STATE_ID, validateFallback } from '../扩展功能/故障切换/SQLite切换配置.mjs';
import { createFallbackClient } from '../扩展功能/故障切换/切换客户端.mjs';
import { createRoutedImageGateway, canAdvanceFallback } from '../扩展功能/故障切换/渠道切换网关.mjs';
import { requestThroughManagedProxy } from '../扩展功能/故障切换/受限代理传输.mjs';
import { openGenerationTasks } from '../扩展功能/生成任务/SQLite生成任务.mjs';
import { generationFixture, listen, closeServer } from './生成网关隔离夹具.mjs';
import { 根目录 } from './公共.mjs';

const profiles = [
  { id: 'A', name: '合成渠道A', apiFormat: 'openai', baseUrl: 'https://a.example.com', models: [{ name: 'gpt-image-2', capability: 'image', price: 1 }, { name: 'text-A', capability: 'text' }] },
  { id: 'B', name: '合成渠道B', apiFormat: 'gemini', baseUrl: 'https://b.example.com', models: [{ name: 'gpt-image-2.5', capability: 'image', price: 9 }] },
];
const enabled = () => editFallback(emptyFallback(), profiles, { type: 'group', capability: 'image', enabled: true });
const digest = value => createHash('sha256').update(value).digest('hex');
async function fixture({ behavior, proxy = false, wrapWorkspace = value => value } = {}) {
  const f = await generationFixture(), workspace = wrapWorkspace(f.workspace), calls = [];
  const base = { ...f.gateway, async execute(binding, request, options) {
    calls.push({ binding, request, signal: options?.signal, route: options?.route, transport: 'direct' });
    return behavior ? behavior(calls, options) : { status: 200, contentType: 'application/json', bytes: Buffer.from('{"data":[{"b64_json":"aW1hZ2U="}]}') };
  } };
  const proxied = { ...base, async execute(binding, request, options) { const result = await base.execute(binding, request, options); calls.at(-1).transport = 'proxy'; return result; } };
  const state = { enabled: proxy, running: proxy, busy: false, activeRequests: 0, acquired: 0 };
  const networkProxy = { getStatus: () => state, acquireRoute(transport) {
    assert.equal(state.enabled, transport === 'proxy');
    if (transport === 'proxy') assert.equal(state.running, true);
    state.activeRequests++; state.acquired++;
    let released = false;
    return Object.freeze({ release() { if (!released) { released = true; state.activeRequests--; } } });
  } };
  const gateway = createRoutedImageGateway({ workspace, base, proxied, networkProxy, runTrustedWrite: operation => f.coordinator.runWrite(operation) });
  const bindings = [await f.bind(), await f.bind()], policy = await gateway.fallbackSave(enabled(), 0);
  const requests = bindings.map((_, index) => ({ method: 'POST', path: '/v1/images/generations', contentType: 'application/json', body: Buffer.from(JSON.stringify({ model: profiles[index].models[0].name, prompt: '合成提示词不应进入计划' })).toString('base64') }));
  const plan = { mode: 'fallback', capability: 'image', revision: policy.revision, candidates: bindings.map((binding, index) => ({ profileId: profiles[index].id, modelName: profiles[index].models[0].name,
    channelName: profiles[index].name, binding: binding.binding, requestHash: hashJSON(requests[index]), quality: 'auto', size: '1024x1024' })) };
  const binding = (await gateway.createPlan(plan)).binding;
  const request = { method: 'POST', path: '/v1/images/generations', contentType: 'application/json', body: Buffer.from(JSON.stringify({ format: 'guan-routed-image-request.v1', requests })).toString('base64') };
  return { ...f, base, gateway, calls, plan, request, binding, requests, state, workspace,
    async close() { await f.close(); },
  };
}
test('旧版分组与排序：新增/删除渠道和模型后保留已选顺序，不保留失效候选', () => {
  let state = enabled(); state = editFallback(state, profiles, { type: 'move', capability: 'image', index: 1, direction: -1 });
  assert.deepEqual(enabledEntries(state, 'image').map(entry => entry.profileId), ['B', 'A']);
  const next = reconcileFallback(state, [profiles[0], { ...profiles[1], models: [{ name: 'new', capability: 'image' }] }]);
  assert.deepEqual(next.capabilities.image.entries.map(entry => [entry.profileId, entry.modelName, entry.enabled]), [['A', 'gpt-image-2', true], ['B', 'new', false]]);
  assert.equal(next.capabilities.text.entries.length, 1); assert.equal(next.capabilities.video.entries.length, 0);
});
test('旧版全局关闭实际会清除勾选；再次开启不会偷偷遍历所有渠道', () => {
  const off = editFallback(enabled(), profiles, { type: 'global', enabled: false });
  assert.equal(off.enabled, false); assert.deepEqual(enabledEntries(off, 'image'), []);
  assert.deepEqual(enabledEntries(editFallback(off, profiles, { type: 'global', enabled: true }), 'image'), []);
});
test('默认排序保留旧版本优先、价格、渠道顺序规则', () => {
  const result = editFallback(enabled(), profiles, { type: 'reset', capability: 'image' });
  assert.equal(result.capabilities.image.entries[0].profileId, 'B');
});
test('配置不接受密钥、未知字段、重复项或开关冲突', () => {
  assert.throws(() => validateFallback({ ...enabled(), apiKey: 'synthetic' }));
  const value = enabled(); value.capabilities.image.entries.push({ ...value.capabilities.image.entries[0] }); assert.throws(() => validateFallback(value));
  assert.throws(() => validateFallback({ ...enabled(), enabled: false }));
});
test('SQLite配置保存、冲突拒绝与同库重读', async () => {
  const f = await generationFixture();
  try {
    const store = createFallbackStore({ workspace: f.workspace, runTrustedWrite: operation => f.coordinator.runWrite(operation) });
    assert.equal(store.read().revision, 0); await store.save(enabled(), 0); await assert.rejects(store.save(emptyFallback(), 0));
    const reopened = createFallbackStore({ workspace: f.workspace, runTrustedWrite: operation => f.coordinator.runWrite(operation) });
    assert.deepEqual(reopened.read(), { revision: 1, value: enabled() });
  } finally { await f.close(); }
});
test('SQLite已提交但丢ACK时核对精确后态，不重复写入', async () => {
  const f = await generationFixture();
  try {
    const wrapped = { workspaceId: f.workspace.workspaceId, readDocument: (...args) => f.workspace.readDocument(...args), writeDocument(value) { f.workspace.writeDocument(value); throw Error('合成丢ACK'); } };
    const store = createFallbackStore({ workspace: wrapped, runTrustedWrite: operation => f.coordinator.runWrite(operation) });
    assert.equal((await store.save(enabled(), 0)).revision, 1); assert.equal(f.workspace.readDocument('extension', FALLBACK_STATE_ID).revision, 1);
  } finally { await f.close(); }
});
test('损坏配置不能当作空配置覆盖', async () => {
  const f = await generationFixture();
  try {
    f.workspace.writeDocument({ collection: 'extension', id: FALLBACK_STATE_ID, value: { format: 'unknown' }, expectedRevision: 0, operationId: randomUUID() });
    const store = createFallbackStore({ workspace: f.workspace, runTrustedWrite: operation => f.coordinator.runWrite(operation) }); assert.throws(() => store.read());
  } finally { await f.close(); }
});
test('页内客户端读取去重、ACK后更新、冲突后重读且不覆盖', async () => {
  let stored = { revision: 0, value: emptyFallback() }, reads = 0, saves = 0, notices = 0;
  const client = createFallbackClient({ async command(value) {
    if (value.operation === 'fallback-load') { reads++; await Promise.resolve(); return structuredClone(stored); }
    saves++; if (value.revision !== stored.revision) throw Error('冲突'); stored = { revision: stored.revision + 1, value: value.value }; return stored;
  }, notify: () => notices++ });
  await Promise.all([client.read(), client.read()]); assert.equal(reads, 1);
  await client.save(enabled(), 0); assert.equal(client.snapshot().revision, 1);
  stored = { revision: 2, value: emptyFallback() }; await assert.rejects(client.save(enabled(), 1));
  assert.equal(client.snapshot().value.enabled, false); assert.equal(saves, 2); assert.equal(reads, 2); assert.equal(notices, 3);
  client.close(); await assert.rejects(client.read());
});
for (const status of [401, 403, 404, 429]) test('明确HTTP拒绝' + status + '后只按顺序切换一次，持久记录实际渠道', async () => {
  const f = await fixture({ behavior: calls => ({ status: calls.length === 1 ? status : 200, contentType: 'application/json', bytes: Buffer.from('{"data":[]}') }) });
  try {
    f.gateway.validate(f.binding, f.request);
    const taskId = randomUUID(), result = await f.gateway.execute(f.binding, f.request, { taskId });
    assert.equal(f.calls.length, 2); assert.deepEqual(f.calls.map(call => call.binding), f.plan.candidates.map(entry => entry.binding));
    assert.equal(f.gateway.resultRoute(taskId, digest(result.bytes)).profileId, 'B');
    const journal = f.workspace.readDocument('extension', 'guan-fallback-attempt:' + taskId);
    assert.deepEqual(journal.value.attempts.map(item => item.status), [status, 200]);
    assert.ok(!JSON.stringify(journal.value).includes('合成提示词')); assert.ok(!JSON.stringify(f.workspace.readDocument('extension', f.binding).value).includes('合成提示词'));
    await assert.rejects(f.gateway.execute(f.binding, f.request, { taskId })); assert.equal(f.calls.length, 2);
  } finally { await f.close(); }
});
for (const status of [200, 400, 408, 409, 500, 502, 503, 504]) test('HTTP ' + status + '不触发自动切换', async () => {
  const f = await fixture({ behavior: () => ({ status, contentType: 'application/json', bytes: Buffer.from('synthetic-response') }) });
  try { await f.gateway.execute(f.binding, f.request, { taskId: randomUUID() }); assert.equal(f.calls.length, 1); assert.equal(canAdvanceFallback(status), false); }
  finally { await f.close(); }
});
test('无响应/超时停止并保留dispatching记录，不换渠道或代理重发', async () => {
  const f = await fixture({ behavior: () => { throw Error('synthetic-timeout'); } });
  try {
    const taskId = randomUUID(); await assert.rejects(f.gateway.execute(f.binding, f.request, { taskId }));
    assert.equal(f.calls.length, 1); assert.equal(f.workspace.readDocument('extension', 'guan-fallback-attempt:' + taskId).value.phase, 'dispatching');
  } finally { await f.close(); }
});
test('取消即停止；即使同时得到401也不发送下一渠道', async () => {
  const controller = new AbortController();
  const f = await fixture({ behavior: () => { controller.abort(); return { status: 401, bytes: Buffer.from('denied'), contentType: 'text/plain' }; } });
  try { await assert.rejects(f.gateway.execute(f.binding, f.request, { taskId: randomUUID(), signal: controller.signal })); assert.equal(f.calls.length, 1); }
  finally { await f.close(); }
});
test('显式单渠道不因为总开关已开而切换', async () => {
  const f = await fixture({ behavior: () => ({ status: 401, contentType: 'text/plain', bytes: Buffer.from('denied') }) });
  try {
    const plan = { ...f.plan, mode: 'single', revision: 0, candidates: f.plan.candidates.slice(0, 1) };
    const binding = (await f.gateway.createPlan(plan)).binding;
    const request = { ...f.request, body: Buffer.from(JSON.stringify({ format: 'guan-routed-image-request.v1', requests: f.requests.slice(0, 1) })).toString('base64') };
    await f.gateway.execute(binding, request, { taskId: randomUUID() }); assert.equal(f.calls.length, 1);
  } finally { await f.close(); }
});
test('关闭或其他页面改变配置后，旧计划发送前拒绝', async () => {
  const f = await fixture();
  try { await f.gateway.fallbackSave(emptyFallback(), 1); assert.throws(() => f.gateway.validate(f.binding, f.request)); assert.equal(f.calls.length, 0); }
  finally { await f.close(); }
});
test('篡改候选顺序、请求正文或引用会在发送前拒绝', async () => {
  const f = await fixture();
  try {
    await assert.rejects(f.gateway.createPlan({ ...f.plan, candidates: [...f.plan.candidates].reverse() }));
    const modified = { ...f.request, body: Buffer.from(JSON.stringify({ format: 'guan-routed-image-request.v1', requests: [...f.requests].reverse() })).toString('base64') };
    assert.throws(() => f.gateway.validate(f.binding, modified)); assert.equal(f.calls.length, 0);
  } finally { await f.close(); }
});
test('代理已启用时直接选代理；未就绪时拒绝，不静默直连', async () => {
  const f = await fixture({ proxy: true });
  try {
    await f.gateway.execute(f.binding, f.request, { taskId: randomUUID() }); assert.equal(f.calls[0].transport, 'proxy');
    f.state.running = false; await assert.rejects(f.gateway.createPlan(f.plan)); assert.equal(f.calls.length, 1);
  } finally { await f.close(); }
});
test('代理切换全链持有同一个租约，完成后释放', async () => {
  const f = await fixture({ proxy: true, behavior: calls => {
    assert.equal(f.state.activeRequests, 1);
    assert.ok(calls.at(-1).route);
    return { status: calls.length === 1 ? 429 : 200, contentType: 'application/json', bytes: Buffer.from('{}') };
  } });
  try {
    await f.gateway.execute(f.binding, f.request, { taskId: randomUUID() });
    assert.equal(f.calls.length, 2); assert.equal(f.calls[0].route, f.calls[1].route);
    assert.equal(f.state.acquired, 1); assert.equal(f.state.activeRequests, 0);
  } finally { await f.close(); }
});
test('旧直连计划不能绕过新启用的代理，未发出请求或留下派发记录', async () => {
  const f = await fixture();
  try {
    f.state.enabled = true; f.state.running = true;
    const taskId = randomUUID();
    await assert.rejects(f.gateway.execute(f.binding, f.request, { taskId }));
    assert.equal(f.calls.length, 0); assert.equal(f.state.activeRequests, 0);
    assert.equal(f.workspace.readDocument('extension', 'guan-fallback-attempt:' + taskId), null);
  } finally { await f.close(); }
});
for (const cancelled of [false, true]) test('代理任务' + (cancelled ? '取消' : '异常') + '后释放全链租约且不重发', async () => {
  const controller = new AbortController();
  const f = await fixture({ proxy: true, behavior: () => {
    assert.equal(f.state.activeRequests, 1);
    if (cancelled) { controller.abort(); return { status: 429, contentType: 'application/json', bytes: Buffer.from('{}') }; }
    throw Error('合成传输异常');
  } });
  try {
    await assert.rejects(f.gateway.execute(f.binding, f.request, { taskId: randomUUID(), signal: controller.signal }));
    assert.equal(f.calls.length, 1); assert.equal(f.state.acquired, 1); assert.equal(f.state.activeRequests, 0);
  } finally { await f.close(); }
});
test('最终渠道摘要不匹配不交付；配置关闭仍可恢复已有结果', async () => {
  const f = await fixture();
  try {
    const taskId = randomUUID(), result = await f.gateway.execute(f.binding, f.request, { taskId });
    await f.gateway.fallbackSave(emptyFallback(), 1);
    assert.throws(() => f.gateway.resultRoute(taskId, '0'.repeat(64)));
    assert.equal(f.gateway.resultRoute(taskId, digest(result.bytes)).profileId, 'A'); assert.equal(f.calls.length, 1);
  } finally { await f.close(); }
});
test('任务仍按原产品/节点保存，结果读取与冷重开不重发', async () => {
  const f = await fixture(); let tasks;
  try {
    const routedTasks = openGenerationTasks;
    tasks = await routedTasks({ workspace: f.workspace, gateway: f.gateway, coordinator: f.coordinator, verifyApplied: f.verifyApplied });
    const input = { id: randomUUID(), productId: 'product-A', nodeId: 'node-A', binding: f.binding, request: f.request };
    await tasks.submit(input); await tasks.drain(); const job = tasks.get(input.id);
    assert.equal(job.state, 'succeeded'); assert.equal(job.productId, 'product-A'); assert.equal(job.nodeId, 'node-A');
    assert.equal(f.gateway.resultRoute(input.id, job.result.id).profileId, 'A');
    await tasks.close(); tasks = await openGenerationTasks({ workspace: f.workspace, gateway: f.gateway, coordinator: f.coordinator, verifyApplied: f.verifyApplied });
    await tasks.submit(input); assert.equal(f.calls.length, 1); assert.equal(tasks.result(input.id).result.id, job.result.id);
  } finally { await tasks?.drain(); await tasks?.close(); await f.close(); }
});
test('CONNECT真实TLS传输：代理认证只给本机代理，目标认证只给TLS上游', async () => {
  const parent = mkdtempSync(join(tmpdir(), 'guan-fallback-tls-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(parent, 'synthetic.key'), '-out', join(parent, 'synthetic.crt'), '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost'], { stdio: 'ignore' });
  const key = readFileSync(join(parent, 'synthetic.key')), cert = readFileSync(join(parent, 'synthetic.crt')), incoming = [], tunnels = [], sockets = new Set();
  const target = httpsServer({ key, cert }, async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    incoming.push({ headers: request.headers, bytes: Buffer.concat(chunks) }); response.writeHead(200, { 'content-type': 'application/json' });
    response.write('{"ok":'); await new Promise(resolve => setTimeout(resolve, 30)); response.end('true}');
  });
  const targetOrigin = (await listen(target)).replace('http://127.0.0.1', 'https://localhost');
  const proxy = httpServer();
  proxy.on('connect', (request, socket) => {
    tunnels.push({ headers: request.headers, path: request.url }); sockets.add(socket); socket.on('error', () => {});
    const remote = connect(target.address().port, '127.0.0.1', () => { socket.write('HTTP/1.1 200 Connection Established\r\n\r\n'); socket.pipe(remote).pipe(socket); });
    sockets.add(remote); remote.on('error', () => socket.destroy());
  });
  const proxyURL = await listen(proxy);
  try {
    const received = []; let completed = false;
    const result = await requestThroughManagedProxy({ url: new URL(targetOrigin + '/v1/images/generations'), method: 'POST', headers: { authorization: 'Bearer synthetic-provider', 'content-type': 'application/json' }, bytes: Buffer.from('{"model":"synthetic"}'),
      route: { proxyURL, username: 'workbench', password: 'synthetic-proxy' }, testOrigins: [targetOrigin], testCA: cert, timeout: 5000,
      onChunk(chunk) { assert.equal(completed, false); received.push(chunk.bytes.toString()); },
    });
    completed = true; assert.equal(received[0], '{"ok":'); assert.equal(received.join(''), '{"ok":true}');
    assert.equal(result.status, 200); assert.equal(result.bytes.toString(), '{"ok":true}');
    assert.equal(incoming.length, 1); assert.equal(incoming[0].headers.authorization, 'Bearer synthetic-provider'); assert.equal(incoming[0].headers['proxy-authorization'], undefined);
    assert.equal(tunnels[0].headers.authorization, undefined); assert.equal(tunnels[0].headers['proxy-authorization'], 'Basic ' + Buffer.from('workbench:synthetic-proxy').toString('base64'));
    assert.equal(tunnels[0].path, '127.0.0.1:' + target.address().port);
  } finally { for (const socket of sockets) socket.destroy(); await closeServer(proxy); await closeServer(target); rmSync(parent, { recursive: true, force: true }); }
});
test('代理传输拒绝私网目标、非受管地址与预取消', async () => {
  const base = { url: new URL('https://127.0.0.1/v1/images/generations'), method: 'POST', headers: {}, bytes: Buffer.from('{}'), route: { proxyURL: 'http://127.0.0.1:23210', username: 'workbench', password: 'synthetic' } };
  await assert.rejects(requestThroughManagedProxy(base));
  await assert.rejects(requestThroughManagedProxy({ ...base, route: { ...base.route, proxyURL: 'http://example.com:23210' } }));
  await assert.rejects(requestThroughManagedProxy({ ...base, signal: AbortSignal.abort() }));
});
test('当前装配确实接线，保留原样CSS、授权、代理租约和原产品回写', async () => {
  const get = path => readFileSync(join(根目录, '.运行/3100源', path), 'utf8');
  assert.match(get('画布副本/扩展功能/生成网关/生成HTTP入口.mjs'), /fallback-load/);
  assert.match(get('画布副本/扩展功能/生成网关/生成HTTP入口.mjs'), /gateway\.resultRoute/);
  assert.match(get('服务包/扩展功能/本机服务/数据服务.mjs'), /guan-fallback-/);
  assert.match(get('画布副本/扩展功能/生成任务/SQLite生成任务.mjs'), /taskId: input\.id/);
  assert.match(get('画布副本/web/src/pages/canvas/project.tsx'), /useCanvasImageResults/);
  assert.match(get('画布副本/web/src/扩展功能/媒体交付/图片结果保存操作.ts'), /saveProductCanvas/);
  assert.match(get('画布副本/web/src/扩展功能/画布生成/原画布图片调用.ts'), /parseRoutedImageResponse/);
  assert.match(get('画布副本/web/src/扩展功能/本机存储/工作台自动入口.mjs'), /await fallback\.read\(\)/);
  assert.ok(get('画布副本/web/src/扩展功能/故障切换/原版Fallback.css').includes('.guan-fallback .local-canvas-fallback-row'));
  const launcher = get('画布副本/扩展功能/本机服务/受限工作台启动器.mjs');
  assert.ok(launcher.indexOf('networkProxy = await assemble') < launcher.indexOf('generation = await assemble'));
  // 执行实际派生产物，验证租约穿过凭据网关到达传输端口。
  const sourceURL = pathToFileURL(join(根目录, '扩展功能/生成网关/渠道凭据网关.mjs'));
  const source = get('画布副本/扩展功能/生成网关/渠道凭据网关.mjs')
    .replace(/from '(\.[^']+)'/g, (_, relative) => 'from ' + JSON.stringify(new URL(relative, sourceURL).href));
  const { createProviderCredentialGateway } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  const f = await generationFixture(), route = Object.freeze({ id: 'synthetic-chain-lease' });
  try {
    let sends = 0;
    const gateway = createProviderCredentialGateway({ workspace: f.workspace, vault: f.vault, coordinator: f.coordinator, testOrigins: [f.providerOrigin],
      requestBytes: async options => {
        sends++; assert.equal(options.route, route); assert.equal(options.headers.authorization, 'Bearer ' + 'synthetic-candidate-credential');
        return { status: 200, contentType: 'application/json', bytes: Buffer.from('{}') };
      } });
    const binding = await gateway.bind({ kind: 'openai', endpoint: f.providerOrigin, value: 'synthetic-candidate-credential' });
    await gateway.execute(binding.binding, f.submit(binding.binding).request, { route });
    assert.equal(sends, 1); assert.equal(f.requests.length, 0);
    const proxySourceURL = pathToFileURL(join(根目录, '扩展功能/网络代理/代理服务.mjs'));
    const proxySource = get('画布副本/扩展功能/网络代理/代理服务.mjs')
      .replace(/from '(\.[^']+)'/g, (_, relative) => 'from ' + JSON.stringify(new URL(relative, proxySourceURL).href));
    const { openNetworkProxyService } = await import('data:text/javascript;base64,' + Buffer.from(proxySource).toString('base64'));
    const service = await openNetworkProxyService({ workspace: f.workspace, vault: f.vault, runTrustedWrite: operation => f.coordinator.runWrite(operation), runtime: { start() { throw Error('本测试不启动代理核心'); } } });
    await service.toggle(false);
    const direct = service.acquireRoute('direct');
    try {
      assert.equal(service.status().activeRequests, 1);
      assert.throws(() => service.acquireRoute('proxy'));
      await assert.rejects(service.toggle(true), error => error.code === 'proxy_busy');
      assert.throws(() => service.assertCanClose());
    } finally { direct.release(); }
    assert.equal(service.status().activeRequests, 0);
    await service.close();
  } finally { await f.close(); }
});
