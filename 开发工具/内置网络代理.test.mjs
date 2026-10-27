import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID, randomInt } from 'node:crypto';
import { mkdtempSync, readFileSync, realpathSync, readdirSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServer, request } from 'node:http';
import { createServer as netServer } from 'node:net';
import { parse } from '../扩展功能/网络代理/node_modules/yaml/dist/index.js';
import { buildMihomoConfig } from '../扩展功能/网络代理/旧版配置转换.mjs';
import { buildIsolatedProxyConfig, subscriptionURL, PROXY_PROTOCOL } from '../扩展功能/网络代理/配置边界.mjs';
import { createProxyConfigurationStore } from '../扩展功能/网络代理/代理配置存储.mjs';
import { createMihomoRuntime, assertProxyPortsAvailable } from '../扩展功能/网络代理/内置代理运行.mjs';
import { openNetworkProxyService } from '../扩展功能/网络代理/代理服务.mjs';
import { createNetworkProxyHTTPHandler } from '../扩展功能/网络代理/代理HTTP入口.mjs';
import { createNetworkProxyClient } from '../扩展功能/网络代理/代理客户端.mjs';
import { 读取默认代理配置 } from '../扩展功能/网络代理/默认代理配置.mjs';
import { 内置网络代理订阅 } from '../扩展功能/网络代理/内置订阅设置.mjs';
import { openWorkspace } from '../扩展功能/本机存储/SQLite工作区.mjs';
import { openSQLiteCredentialVault } from '../扩展功能/本机凭据/SQLite凭据保管.mjs';
import { createWriteCoordinator } from '../扩展功能/本机服务/写入协调.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const source = 'proxies:\n  - name: test-A\n    type: ss\n    server: node.example.com\n    port: 443\n    cipher: aes-256-gcm\n    password: synthetic-proxy-password\n  - name: test-B\n    type: hysteria2\n    server: second.example.com\n    port: 443\n    password: synthetic-other-password\nproxy-groups:\n  - name: TEST-GROUP\n    type: select\n    proxies: [test-A, test-B]\nrules:\n  - MATCH,TEST-GROUP\n';
const parameters = { port: 23210, controllerToken: 'a'.repeat(64), proxyPassword: 'b'.repeat(64) };
const roots = [];
const listen = server => new Promise((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', () => done(server.address().port)); });
const close = server => new Promise((done, fail) => { server.closeAllConnections?.(); server.close(error => error ? fail(error) : done()); });
const contains = (root, text) => readdirSync(root).some(name => { const p = join(root, name); return statSync(p).isDirectory() ? contains(p, text) : readFileSync(p).includes(Buffer.from(text)); });
async function pairPort() { for (let i = 0; i < 40; i++) { const port = randomInt(20000, 48000); try { await assertProxyPortsAvailable(port); return port; } catch { /* try another isolated pair */ } } throw Error('fixture ports unavailable'); }
async function fixture({ wrap = value => value, subscription, initialConfiguration } = {}) {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'guan-proxy-test-'))); roots.push(parent);
  let workspace = openWorkspace({ dataRoot: join(parent, 'data'), initialize: true }); const key = randomBytes(32);
  const keyProvider = { create: async () => Buffer.from(key), read: async () => Buffer.from(key) };
  let vault = await openSQLiteCredentialVault({ workspace, keyProvider, initialize: true }), coordinator = createWriteCoordinator();
  const port = await pairPort(), corePath = realpathSync(process.execPath);
  const options = { core: { path: corePath, sha256: digest(readFileSync(corePath)) }, runtimeParent: join(parent, 'runtime'), port,
    coreArguments: [fileURLToPath(new URL('./内置代理模拟核心.mjs', import.meta.url))], startupTimeout: 10000, requestProbe: async () => { await new Promise(done => setTimeout(done, 30)); return { status: 204 }; } };
  const args = () => ({ workspace: wrap(workspace), vault, runTrustedWrite: f => coordinator.runWrite(f), runtime: createMihomoRuntime(options), initialConfiguration, ...(subscription ? { readSubscription: subscription } : {}) });
  let serviceArgs = args();
  let service = await openNetworkProxyService(serviceArgs);
  return { get workspace() { return workspace; }, get vault() { return vault; }, parent, port, options, get service() { return service; }, get serviceArgs() { return serviceArgs; },
    async reopen() { await service.close(); service = await openNetworkProxyService(serviceArgs); return service; },
    async coldReopen() {
      await service.close(); await coordinator.close(); vault.close(); workspace.close();
      workspace = openWorkspace({ dataRoot: join(parent, 'data'), initialize: false });
      vault = await openSQLiteCredentialVault({ workspace, keyProvider, initialize: false }); coordinator = createWriteCoordinator();
      serviceArgs = args(); service = await openNetworkProxyService(serviceArgs); return service;
    },
    async close() { await service.close(); await coordinator.close(); vault.close(); workspace.close(); key.fill(0); } };
}
test('旧版内联配置和节点保持，安全运行项覆盖', () => {
  const old = parse(buildMihomoConfig(source, parameters.port)), next = parse(buildIsolatedProxyConfig(source + '\nallow-lan: true\ntun: {enable: true}\ndns: {enable: true, listen: 0.0.0.0:53}\n', parameters));
  assert.deepEqual(next.proxies, old.proxies); assert.deepEqual(next['proxy-groups'], old['proxy-groups']); assert.deepEqual(next.rules, old.rules);
  assert.equal(next['bind-address'], '127.0.0.1'); assert.equal(next['allow-lan'], false); assert.equal(next.tun.enable, false); assert.equal(next.dns.enable, false);
  assert.equal(next['external-controller'], '127.0.0.1:23211'); assert.equal(next.secret, parameters.controllerToken); assert.deepEqual(next.authentication, ['workbench:' + parameters.proxyPassword]);
});
for (const input of ['ss://aes-256-gcm:synthetic@node.example.com:443#one', 'hysteria2://synthetic@node.example.com:443#two']) test('原有URI转换：' + input.split(':')[0], () => {
  assert.deepEqual(parse(buildIsolatedProxyConfig(input, parameters)).proxies, parse(buildMihomoConfig(input, 23210)).proxies);
  assert.deepEqual(parse(buildIsolatedProxyConfig(Buffer.from(input).toString('base64'), parameters)).proxies, parse(buildMihomoConfig(input, 23210)).proxies);
});
for (const suffix of ['script: {code: evil}', 'proxy-providers: {remote: {url: "https://example.com/sub"}}', 'rule-providers: {remote: {path: /private/file}}', 'listeners: [{port: 1234}]', 'broken: !!foo x', 'bad: &a [*a]', 'mixed-port: 12\nmixed-port: 13']) test('拒绝未审查配置：' + suffix.split(':')[0], () => assert.throws(() => buildIsolatedProxyConfig(source + suffix + '\n', parameters)));
for (const url of ['http://example.com/sub', 'https://127.0.0.1/sub', 'https://localhost/sub', 'https://' + 'user:pass@example.com/sub', 'file:///private/config', 'https://example.com/sub#token']) test('拒绝订阅地址：' + url.split(':')[0], () => assert.throws(() => subscriptionURL(url)));
test('HTTPS订阅保留查询但不改公开目标', () => assert.equal(subscriptionURL('https://sub.example.com/a?token=synthetic'), 'https://sub.example.com/a?token=synthetic'));
test('真实临时SQLite加密分片读回；不留下订阅与节点明文', async () => {
  const f = await fixture();
  try {
    const store = createProxyConfigurationStore(f.serviceArgs), text = source + '#'.repeat(9000) + '中文😀'.repeat(900), url = 'https://sub.example.com/a?token=' + randomUUID();
    const next = await store.prepare({ sourceKind: 'url', source: url, config: text, configName: '远端订阅配置' });
    await store.save(next, 0); assert.equal(await store.unseal(store.read().value.config), text); assert.equal(await store.unseal(store.read().value.source), url);
    assert.equal(contains(join(f.parent, 'data'), url), false); assert.equal(contains(join(f.parent, 'data'), 'synthetic-proxy-password'), false);
    assert.equal(contains(join(f.parent, 'data'), '中文😀'), false);
  } finally { await f.close(); }
});
test('两类代理初始默认开启；主动关闭后冷重开保留选择，不启动无配置核心', async () => {
  const f = await fixture();
  try {
    assert.equal(f.service.status().enabled, true); assert.equal(f.service.status().relayEnabled, true);
    assert.equal(f.service.status().configured, false); assert.equal(f.service.status().running, false);
    await f.service.toggle(false); await f.service.toggleRelay(false); await f.coldReopen();
    assert.equal(f.service.status().enabled, false); assert.equal(f.service.status().relayEnabled, false);
    await f.service.toggleRelay(true); assert.equal(f.service.status().running, false);
  } finally { await f.close(); }
});
test('原代理配置仅接续一次并加密保存，重开后不覆盖自己的开关', async () => {
  let calls = 0;
  const f = await fixture({ initialConfiguration: async () => { calls++; return { sourceKind: 'url', source: 'https://sub.example.com/?token=synthetic-legacy', config: source, configName: '远端订阅配置', enabled: false, relayEnabled: false }; } });
  try {
    assert.equal(f.service.status().running, false); assert.equal(f.service.status().enabled, false); assert.equal(f.service.status().relayEnabled, false);
    assert.equal(contains(join(f.parent, 'data'), 'synthetic-legacy'), false);
    await f.coldReopen();
    assert.equal(calls, 1); assert.equal(f.service.status().relayEnabled, false); assert.equal(f.service.status().enabled, false);
    await f.service.toggleRelay(true); await f.service.toggle(true); assert.equal(f.service.status().running, true); await f.coldReopen();
    assert.equal(calls, 1); assert.equal(f.service.status().relayEnabled, true); assert.equal(f.service.status().enabled, true);
  } finally { await f.close(); }
});
test('原代理配置接续异常只显示代理错误，不阻止工作台启动', async () => {
  const f = await fixture({ initialConfiguration: async () => { throw Error('synthetic missing configuration'); } });
  try { assert.equal(f.service.status().running, false); assert.equal(f.service.status().lastError, 'proxy_import_failed'); }
  finally { await f.close(); }
});
test('只有旧开关没有代理配置时也接续开关，不写入伪造密文', async () => {
  const f = await fixture({ initialConfiguration: async () => ({ enabled: false, relayEnabled: false }) });
  try {
    assert.equal(f.service.status().enabled, false); assert.equal(f.service.status().relayEnabled, false);
    assert.equal(f.service.status().configured, false); assert.equal(f.service.status().running, false);
    await f.coldReopen();
    assert.equal(f.service.status().enabled, false); assert.equal(f.service.status().relayEnabled, false);
    assert.equal(f.service.status().configured, false); assert.equal(f.service.status().running, false);
  } finally { await f.close(); }
});
test('无原配置时接续内置订阅；状态显示公开地址，冷重开沿用加密配置', async () => {
  let reads = 0;
  const f = await fixture({ initialConfiguration: () => 读取默认代理配置({ readSubscription: async url => { assert.equal(url, 内置网络代理订阅); reads++; return source; } }) });
  try {
    assert.equal(f.service.status().running, true); assert.equal(f.service.status().configInput, 内置网络代理订阅);
    await f.coldReopen(); assert.equal(reads, 1); assert.equal(f.service.status().configInput, 内置网络代理订阅);
    await f.service.configure({ configText: source, subscriptionUrl: '', fileName: '自定义配置.yaml' });
    assert.equal(f.service.status().configInput, '自定义配置.yaml');
  } finally { await f.close(); }
});
test('配置启动、节点、诊断、停止、重开和租约保护', async () => {
  const f = await fixture();
  try {
    assert.equal(f.service.status().configured, false);
    const result = await f.service.configure({ configText: source, subscriptionUrl: '', fileName: '合成配置.yaml' }); assert.equal(result.running, true);
    assert.equal((await f.service.nodes())[0].selected, 'test-A'); assert.equal((await f.service.select('TEST-GROUP', 'test-B'))[0].selected, 'test-B');
    await assert.rejects(f.service.select('TEST-GROUP', 'unknown'));
    const diagnosis = await f.service.diagnose(); assert.equal(diagnosis.reachable, true); assert.equal(diagnosis.node, "test-B"); assert.ok(diagnosis.delay >= 0);
    const measured = await f.service.testAll(); assert.deepEqual(measured.delayResults.map(item => item.latencyMs), [12, 12]);
    const lease = f.service.acquireRoute(); assert.equal(lease.username, 'workbench'); assert.equal(lease.password.length, 64);
    await assert.rejects(f.service.toggle(false), error => error.code === 'proxy_busy'); assert.throws(() => f.service.assertCanClose()); lease.release(); lease.release();
    assert.equal((await f.service.toggle(false)).running, false); assert.throws(() => f.service.acquireRoute());
    assert.equal((await f.service.toggle(true)).running, true);
    const reopened = await f.reopen(); assert.equal(reopened.status().running, true); assert.equal(reopened.status().configName, '合成配置.yaml');
    await reopened.toggle(false);
    assert.equal(readdirSync(join(f.parent, 'runtime')).length, 0);
  } finally { await f.close(); }
});
test('新核心启动失败时恢复旧运行配置与落盘指针', async () => {
  const f = await fixture();
  try {
    await f.service.configure({ configText: source, subscriptionUrl: '', fileName: 'old.yaml' });
    await assert.rejects(f.service.configure({ configText: source.replaceAll('test-A', 'FAIL_FIXTURE'), subscriptionUrl: '', fileName: 'bad.yaml' }));
    assert.equal(f.service.status().running, true); assert.equal(f.service.status().configName, 'old.yaml'); assert.equal((await f.service.nodes())[0].selected, 'test-A');
  } finally { await f.close(); }
});
test('保存失败不报告成功，重新读取实际落盘状态后恢复', async () => {
  let fail = false;
  const f = await fixture({ wrap: workspace => new Proxy(workspace, { get(target, property) { if (property === 'writeDocument') return args => { if (fail && args.id === 'guan-network-proxy-state-v1') throw Error('synthetic IO failure'); return target.writeDocument(args); }; return Reflect.get(target, property); } }) });
  try { await f.service.configure({ configText: source, subscriptionUrl: '', fileName: 'old.yaml' }); fail = true;
    await assert.rejects(f.service.configure({ configText: source, subscriptionUrl: '', fileName: 'new.yaml' }));
    assert.equal(f.service.status().configName, 'old.yaml'); assert.equal(f.service.status().running, true);
  } finally { fail = false; await f.close(); }
});
test('保存已提交但ACK丢失：报告未确认，按真实新指针恢复而不假称旧配置回滚', async () => {
  let loseAck = false;
  const f = await fixture({ wrap: workspace => new Proxy(workspace, { get(target, property) {
    if (property === 'writeDocument') return args => { const ack = target.writeDocument(args); return loseAck && args.id === 'guan-network-proxy-state-v1' ? { ...ack, persisted: false } : ack; };
    return Reflect.get(target, property);
  } }) });
  try {
    await f.service.configure({ configText: source, subscriptionUrl: '', fileName: 'old.yaml' }); loseAck = true;
    await assert.rejects(f.service.configure({ configText: source.replaceAll('test-A', 'new-A'), subscriptionUrl: '', fileName: 'new.yaml' }), error => error.code === 'proxy_save_unconfirmed');
    assert.equal(f.service.status().configName, 'new.yaml'); assert.equal(f.service.status().running, true);
    assert.equal((await f.service.nodes())[0].selected, 'new-A');
    loseAck = false; await f.coldReopen();
    assert.equal(f.service.status().configName, 'new.yaml'); assert.equal((await f.service.nodes())[0].selected, 'new-A');
  } finally { loseAck = false; await f.close(); }
});
test('完全关闭SQLite和凭据保管后冷重开：同工作区同测试密钥自动恢复', async () => {
  const f = await fixture();
  try {
    await f.service.configure({ configText: source, subscriptionUrl: '', fileName: 'cold.yaml' });
    const workspaceId = f.workspace.workspaceId, oldPassword = f.service.acquireRoute(); oldPassword.release();
    await f.coldReopen(); assert.equal(f.workspace.workspaceId, workspaceId); assert.equal(f.service.status().running, true);
    const route = f.service.acquireRoute(); assert.notEqual(route.password, oldPassword.password); route.release();
    assert.equal(f.service.status().configName, 'cold.yaml'); assert.equal((await f.service.nodes())[0].selected, 'test-A');
    await f.service.toggle(false); await f.coldReopen(); assert.equal(f.service.status().running, false); assert.equal(f.service.status().enabled, false);
  } finally { await f.close(); }
});
test('订阅读取未结束时阻止关闭和新租约，配置变更保持串行', async () => {
  let release, entered;
  const ready = new Promise(resolve => { entered = resolve; });
  const f = await fixture({ subscription: async () => { entered(); return new Promise(resolve => { release = () => resolve(source); }); } });
  try {
    const setting = f.service.configure({ configText: '', subscriptionUrl: 'https://sub.example.com/synthetic', fileName: '' });
    await ready; assert.equal(f.service.status().busy, true); assert.throws(() => f.service.assertCanClose(), error => error.code === 'proxy_busy');
    assert.throws(() => f.service.acquireRoute(), error => error.code === 'proxy_not_running');
    const disabling = f.service.toggle(false); release(); await setting; await disabling;
    assert.equal(f.service.status().enabled, false); assert.equal(f.service.status().busy, false);
  } finally { release?.(); await f.close(); }
});
test('订阅刷新失败保留当前配置和运行进程', async () => {
  let fail = false, calls = 0;
  const f = await fixture({ subscription: async () => { calls++; if (fail) throw Error('synthetic subscription failure'); return source; } });
  try { await f.service.configure({ configText: '', subscriptionUrl: 'https://sub.example.com/a?token=synthetic', fileName: '' }); fail = true;
    await assert.rejects(f.service.refresh()); assert.equal(f.service.status().running, true); assert.equal(calls, 2); assert.equal(contains(join(f.parent, 'data'), 'token=synthetic'), false);
    assert.equal(JSON.stringify(f.service.status()).includes('token'), false);
  } finally { await f.close(); }
});
test('核心缺失、指纹错误和端口占用不执行或接管其他进程', async () => {
  const f = await fixture(), occupied = netServer();
  try {
    const absent = createMihomoRuntime({ ...f.options, core: undefined }); await assert.rejects(absent.start(source), error => error.code === 'proxy_core_missing');
    const wrong = createMihomoRuntime({ ...f.options, core: { ...f.options.core, sha256: '0'.repeat(64) } }); await assert.rejects(wrong.start(source), error => error.code === 'proxy_core_invalid');
    await new Promise(done => occupied.listen(f.port, '127.0.0.1', done)); await assert.rejects(f.service.configure({ configText: source, subscriptionUrl: '', fileName: '' })); assert.equal(occupied.listening, true);
    assert.equal(f.service.status().configured, false);
  } finally { await close(occupied); await f.close(); }
});
test('实际HTTP CONNECT需要代理认证且只经过隔离模拟核心', async () => {
  const f = await fixture(), target = createServer((req, res) => res.end('loopback-only')), targetPort = await listen(target);
  try {
    await f.service.configure({ configText: source, subscriptionUrl: '', fileName: '' });
    const lease = f.service.acquireRoute();
    try {
      for (const authenticated of [false, true]) {
        const result = await new Promise((done, fail) => {
          const req = request({ hostname: '127.0.0.1', port: f.port, method: 'CONNECT', path: '127.0.0.1:' + targetPort,
            headers: authenticated ? { 'Proxy-Authorization': 'Basic ' + Buffer.from(lease.username + ':' + lease.password).toString('base64') } : {} });
          req.once('connect', (res, socket) => {
            if (!authenticated) { socket.destroy(); done({ status: res.statusCode, payload: '' }); return; }
            let payload = ''; socket.setTimeout(2000, () => socket.destroy(Error('fixture tunnel timed out')));
            socket.on('data', bytes => { payload += bytes.toString('utf8'); }); socket.once('error', fail);
            socket.once('end', () => { socket.destroy(); done({ status: res.statusCode, payload }); });
            socket.write('GET /synthetic HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n');
          }); req.once('error', fail); req.end();
        }); assert.equal(result.status, authenticated ? 200 : 407); if (authenticated) assert.match(result.payload, /loopback-only/);
      }
    } finally { lease.release(); }
  } finally { await close(target); await f.close(); }
});
test('实际HTTP授权：拒绝跨站、无权限、错误协议、任意转发和秘密读回', async () => {
  const f = await fixture(); let handler, authorized = true;
  const server = createServer((req, res) => void handler(req, res)); const port = await listen(server), origin = 'http://127.0.0.1:' + port;
  handler = createNetworkProxyHTTPHandler({ origin, proxy: f.service, authorize: req => { if (!authorized || req.headers.authorization !== 'Bearer synthetic-page') throw Error('unauthorized'); } });
  async function command(body, headers = {}) {
    const response = await fetch(origin + '/__guan-local/network-proxy', { method: 'POST', headers: { origin, authorization: 'Bearer synthetic-page', 'content-type': 'application/json', 'x-guan-proxy-protocol': PROXY_PROTOCOL, ...headers }, body: JSON.stringify(body) }); return { status: response.status, json: await response.json() };
  }
  try {
    assert.equal((await command({ operation: 'status' })).status, 200);
    assert.equal((await command({ operation: 'status' }, { origin: 'https://evil.example' })).status, 403);
    assert.equal((await command({ operation: 'status' }, { 'x-guan-proxy-protocol': 'bad' })).status, 403);
    authorized = false; assert.equal((await command({ operation: 'status' })).status, 503); authorized = true;
    for (const operation of ['read-secret', 'fetch', 'route', 'core-path']) assert.equal((await command({ operation })).status, 400);
    assert.equal((await command({ operation: 'configure', configText: source, subscriptionUrl: '', fileName: 'test.yaml' })).status, 200);
    const status = await command({ operation: 'status' }); assert.equal(status.json.result.running, true); assert.equal(JSON.stringify(status).includes('synthetic-proxy-password'), false);
    const client = createNetworkProxyClient({ command: async value => (await command(value)).json }); assert.equal((await client.status()).running, true);
    assert.equal((await command({ operation: 'status', proxyURL: 'http://evil.example' })).status, 400);
  } finally { await close(server); await f.close(); }
});
test('慢操作期间撤销页面授权：已开始操作不伪造回滚，不返回成功结果', async () => {
  let handler, permitted = true, release, entered, calls = 0;
  const ready = new Promise(resolve => { entered = resolve; });
  const proxy = { status: () => ({ running: false }), configure: async () => { calls++; entered(); await new Promise(resolve => { release = resolve; }); return { running: true }; } };
  const server = createServer((req, res) => void handler(req, res)), port = await listen(server), origin = 'http://127.0.0.1:' + port;
  handler = createNetworkProxyHTTPHandler({ origin, proxy, authorize: () => { if (!permitted) throw Error('synthetic revocation'); } });
  try {
    const request = fetch(origin + '/__guan-local/network-proxy', { method: 'POST', headers: { origin, 'content-type': 'application/json', 'x-guan-proxy-protocol': PROXY_PROTOCOL }, body: JSON.stringify({ operation: 'configure', configText: source, subscriptionUrl: '', fileName: '' }) });
    await ready; permitted = false; release(); const response = await request;
    assert.equal(response.status, 503); const value = await response.json(); assert.equal('result' in value, false); assert.equal(calls, 1);
  } finally { release?.(); await close(server); }
});
test.after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });
