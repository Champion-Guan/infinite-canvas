import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { webProgressSnapshot, serveWebUpdateProgress, createWebProgressObserver } from '../扩展功能/客户安装/Web更新进度服务.mjs';
import { createWebManagerClient } from '../扩展功能/客户安装/Web管理通信.mjs';
import { SoftwareUpdates } from '../扩展功能/软件更新/software-updates.mjs';
import { assembleSoftwareUpdates } from '../扩展功能/软件更新/更新服务装配.mjs';
import { WEB_REPOSITORY } from '../扩展功能/客户安装/Web发布协议.mjs';
import { PassThrough } from 'node:stream';

const target = '2.0.0-beta.10';
const identity = { version: target, repository: WEB_REPOSITORY };
const status = { state: 'committed', targetVersion: target, currentVersion: target, reason: null };
const evidence = { transaction: { phase: 'committed', current: { version: target }, workspaceId: 'workspace' },
  service: { ready: true, version: target, workspaceId: 'workspace', origin: 'http://localhost:3007' }, alive: true };
test('beta目标只有事务、进程、工作区与健康版本全部一致才成功；返回实际动态端口', () => {
  const value = webProgressSnapshot(target, status, evidence);
  assert.equal(value.state, 'success'); assert.equal(value.origin, 'http://localhost:3007');
  for (const changed of [{ alive: false }, { transaction: { ...evidence.transaction, phase: 'switching' } },
    { service: { ...evidence.service, ready: false } }, { service: { ...evidence.service, acceptingPages: false } },
    { service: { ...evidence.service, version: '2.0.0-beta.9' } }, { service: { ...evidence.service, workspaceId: 'other' } },
    { service: { ...evidence.service, origin: 'https://foreign.example' } }]) {
    assert.notEqual(webProgressSnapshot(target, status, { ...evidence, ...changed }).state, 'success');
  }
  assert.equal(webProgressSnapshot(target, { ...status, targetVersion: 'other' }, evidence).state, 'unavailable');
});
test('回退同样要求健康服务，不把日志或断线当作恢复成功', () => {
  const rolled = { ...status, state: 'rolled-back' };
  assert.equal(webProgressSnapshot(target, rolled, evidence).state, 'recovery-required');
  assert.equal(webProgressSnapshot(target, rolled, { ...evidence, transaction: { ...evidence.transaction, phase: 'rolled-back' } }).state, 'rolled-back');
});
function get(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, options, res => { let body = ''; res.setEncoding('utf8'); res.on('data', chunk => body += chunk); res.on('end', () => resolve({ code: res.statusCode, body, headers: res.headers })); });
    req.on('error', reject); req.end();
  });
}
test('独立只读服务随状态更新，拒绝写入、跨站、错误Host及未知路径；故障可重连', async t => {
  let phase = 'awaiting-browser-exit', failed = false;
  const monitor = await serveWebUpdateProgress({ target, readStatus: async () => { if (failed) throw Error(); return { target, state: phase }; } });
  t.after(() => monitor.close());
  assert.match(monitor.url, /^http:\/\/127\.0\.0\.1:\d+\/[a-f0-9]{48}\/$/);
  assert.match((await get(monitor.url)).body, /工作台更新进度/);
  assert.match((await get(monitor.url)).headers['content-security-policy'], /frame-ancestors 'none'/);
  const navigation = { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document', origin: 'http://localhost:3001' };
  assert.equal((await get(monitor.url, { headers: navigation })).code, 200);
  for (const headers of [{ ...navigation, 'sec-fetch-dest': 'iframe' }, { ...navigation, 'sec-fetch-mode': 'cors' }, { ...navigation, origin: 'https://foreign.example' }]) assert.equal((await get(monitor.url, { headers })).code, 403);
  assert.equal((await get(monitor.url + 'status', { headers: navigation })).code, 403);
  assert.equal(JSON.parse((await get(monitor.url + 'status')).body).state, phase);
  // 模拟业务服务停服和重启，观察HTTP服务自身始终可读。
  phase = 'stopping'; assert.equal(JSON.parse((await get(monitor.url + 'status')).body).state, 'stopping');
  phase = 'starting'; assert.equal(JSON.parse((await get(monitor.url + 'status')).body).state, 'starting');
  failed = true; assert.equal(JSON.parse((await get(monitor.url + 'status')).body).state, 'unavailable');
  failed = false; phase = 'success'; assert.equal(JSON.parse((await get(monitor.url + 'status')).body).state, 'success');
  for (const options of [{ method: 'POST' }, { headers: { host: 'foreign.example' } }, { headers: { origin: 'http://foreign.example' } }, { headers: { 'sec-fetch-site': 'cross-site' } }]) assert.equal((await get(monitor.url + 'status', options)).code, 403);
  assert.equal((await get(monitor.url + 'install')).code, 404);
  assert.equal((await get(new URL('/status', monitor.url))).code, 404);
  new Function((await get(monitor.url + 'app.js')).body);
});
test('重复和并发打开合并为一个服务，换目标或关闭才回收，不写任何文件', async () => {
  let opens = 0, closes = 0;
  const observer = createWebProgressObserver(() => ({}), async ({ target: version }) => {
    opens++; await Promise.resolve(); return { target: version, url: 'memory:' + opens, closed: false, close() { closes++; this.closed = true; } };
  });
  try {
    assert.deepEqual(await Promise.all(Array.from({ length: 8 }, () => observer.open(target))), Array.from({ length: 8 }, () => ({ url: 'memory:1' })));
    assert.equal(opens, 1); await observer.open('2.0.0-beta.11'); assert.equal(opens, 2); assert.equal(closes, 1);
  } finally { await observer.close(); }
  assert.equal(closes, 2);
});
test('旧版管理器通信不发安装命令；观察请求只传目标版本', async () => {
  const channel = new EventEmitter(), sent = []; channel.connected = true;
  channel.send = value => { sent.push(value); queueMicrotask(() => channel.emit('message', { type: 'web-manager-reply', id: value.id, result: { url: 'observed' } })); };
  const client = createWebManagerClient(channel);
  try { assert.deepEqual(await client.progressWindow(target), { url: 'observed' }); assert.equal(sent[0].operation, 'progress-window'); assert.equal(sent[0].identity, target); }
  finally { client.close(); }
});
test('观察目标来自管理器已验证身份；不接受任意版本或从源码模式取得安装能力', async t => {
  const root = await mkdtemp(join(tmpdir(), '更新进度-')); t.after(() => rm(root, { recursive: true, force: true }));
  let received = null;
  const updates = new SoftwareUpdates({ directory: root, currentVersion: '2.0.0-beta.9', auth: {},
    manager: { status: async () => ({ allowed: true, state: 'staged' }), stagedIdentity: async () => identity }, progress: { open: async version => { received = version; return { url: 'observed' }; } } });
  await updates.configure({ developerMode: true });
  assert.deepEqual(await updates.progressWindow(), { url: 'observed' }); assert.equal(received, target);
  updates.manager.stagedIdentity = async () => ({ ...identity, version: '2.0.0-beta.9' }); await assert.rejects(updates.progressWindow());
  updates.manager.stagedIdentity = async () => ({ ...identity, repository: 'other/repo' }); await assert.rejects(updates.progressWindow());
  updates.manager = null; await assert.rejects(updates.progressWindow());
});
test('授权HTTP观察入口返回URL，不接受网页身份或URL，不调用approve', async t => {
  const root = await mkdtemp(join(tmpdir(), '更新进度HTTP-')); t.after(() => rm(root, { recursive: true, force: true }));
  let approvals = 0, authorizations = 0;
  const url = 'http://127.0.0.1:34567/' + 'a'.repeat(48) + '/';
  const service = assembleSoftwareUpdates({ dataRoot: root, origin: 'http://localhost:3001', currentVersion: '2.0.0-beta.9',
    authorize: async () => { authorizations++; }, networkProxy: { getStatus: () => ({ enabled: false }) },
    manager: { status: async () => ({ allowed: true, state: 'staged' }), stagedIdentity: async () => identity, progressWindow: async version => { assert.equal(version, target); return { url }; }, approve: () => { approvals++; } } });
  t.after(() => service.close());
  async function request(value) {
    const req = new PassThrough(); req.url = '/__guan-local/software-updates'; req.method = 'POST';
    req.headers = { host: 'localhost:3001', origin: 'http://localhost:3001', 'content-type': 'application/json', 'x-guan-local-protocol': 'guan-local-authorization.v1' };
    const result = {}; const res = { writeHead: code => result.code = code, end: body => result.body = JSON.parse(body) };
    req.end(JSON.stringify(value)); await service.handle(req, res); return result;
  }
  assert.equal((await request({ operation: 'preferences', preferences: { developerMode: true } })).code, 200); authorizations = 0;
  assert.deepEqual((await request({ operation: 'progress-window' })).body.result, { url }); assert.equal(authorizations, 3);
  assert.equal((await request({ operation: 'progress-window', identity })).code, 409);
  assert.equal((await request({ operation: 'progress-window', preferences: { target } })).code, 409);
  assert.equal(approvals, 0);
});
const require = createRequire(new URL('../.运行/3100源/画布副本/web/package.json', import.meta.url));
const ts = require('typescript');
test('浏览器被拦截、窗口关闭或服务失败不导航；有效只读URL才连接并解除opener', async () => {
  const source = readFileSync(new URL('../扩展功能/软件更新/独立进度窗口.ts', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  let fail = false, called = 0; const module = { exports: {} };
  new Function('module', 'exports', 'require', code)(module, module.exports, () => ({ updateRequest: async op => { assert.equal(op, 'progress-window'); called++; if (fail) throw Error('offline'); return { url: 'observed' }; } }));
  const connect = module.exports.connectUpdateProgressWindow;
  await assert.rejects(connect(null)); assert.equal(called, 0);
  let closed = false, navigated = null; const popup = { closed: false, opener: {}, close() { closed = true; }, location: { replace(url) { navigated = url; } } };
  fail = true; await assert.rejects(connect(popup)); assert.equal(closed, true); assert.equal(navigated, null);
  fail = false; await connect(popup); assert.equal(popup.opener, null); assert.equal(navigated, 'observed');
});
test('前端只接受回环只读进度地址，拒绝外部URL和伪状态响应', async () => {
  const source = readFileSync(new URL('../扩展功能/软件更新/软件更新客户端.ts', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  let reply; const module = { exports: {} };
  new Function('module', 'exports', 'window', code)(module, module.exports, { __guanUpdateHost: { request: async op => { assert.equal(op, 'progress-window'); return reply; } } });
  for (reply of [{ url: 'https://outside.example/' }, { state: 'success' }, { url: 'http://localhost:3001/approve' }, { url: 'javascript:alert(1)' }]) await assert.rejects(module.exports.updateRequest('progress-window'));
  reply = { url: 'http://127.0.0.1:45678/' + 'a'.repeat(48) + '/' };
  assert.deepEqual(await module.exports.updateRequest('progress-window'), reply);
});
test('面板显示真实下载百分比；安装不编造百分比，最新版本不假装有待安装任务', () => {
  const source = readFileSync(new URL('../扩展功能/软件更新/更新进度面板.tsx', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} }, jsx = (type, props) => ({ type, props });
  new Function('module', 'exports', 'require', code)(module, module.exports, name => name === 'react/jsx-runtime' ? { jsx, jsxs: jsx } : name === 'antd' ? { Progress: 'progress' } : { updateMessages: {}, installationMessages: {} });
  function flatten(value) { if (!value || typeof value !== 'object') return []; if (Array.isArray(value)) return value.flatMap(flatten); return [value, ...flatten(value.props?.children)]; }
  const base = { hasNewVersion: true, latest: { version: target }, download: { state: 'downloading', progress: 37 }, install: { allowed: true, state: 'idle' } };
  const render = status => flatten(module.exports.UpdateProgressPanel({ status }));
  assert.equal(render(base).find(item => item.type === 'progress').props.percent, 37);
  const installing = render({ ...base, download: { state: 'verified', progress: 100 }, install: { allowed: true, state: 'starting', targetVersion: target } });
  assert.equal(installing.find(item => item.type === 'progress').props['aria-label'], '安装包下载进度');
  assert.ok(installing.some(item => item.props?.['aria-current'] === 'step' && item.props.children.includes('切换与启动')));
  const idle = render({ ...base, hasNewVersion: false, state: 'up-to-date', download: { state: 'idle', progress: 0 } });
  assert.equal(idle.some(item => item.type === 'progress'), false);
  assert.equal(idle.some(item => item.props?.['aria-current'] === 'step'), false);
});
