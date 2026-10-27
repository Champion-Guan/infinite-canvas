import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { 读取代理实时状态 } from '../扩展功能/网络代理/代理实时状态.mjs';
import { createNetworkProxyClient } from '../扩展功能/网络代理/代理客户端.mjs';

const require = createRequire(new URL('../.运行/3100源/画布副本/web/package.json', import.meta.url));
const ts = require('typescript');
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function hook(t, refresh, visible = 'visible', active = true) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const listeners = new Set(), cleanups = [];
  const document = { visibilityState: visible, addEventListener: (_name, callback) => listeners.add(callback), removeEventListener: (_name, callback) => listeners.delete(callback) };
  const source = readFileSync(new URL('../扩展功能/网络代理/代理状态刷新.ts', import.meta.url), 'utf8');
  const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'document', javascript)(id => {
    assert.equal(id, 'react'); return { useEffect: callback => { const cleanup = callback(); if (cleanup) cleanups.push(cleanup); } };
  }, module, module.exports, document);
  module.exports.useProxyStatusRefresh(active, refresh);
  return { listeners, visibility(value) { document.visibilityState = value; for (const listener of listeners) listener(); }, unmount() { while (cleanups.length) cleanups.pop()(); } };
}

test('实时观测只读本机核心，识别实际叶子节点，去重并排除目标地址和凭据', async () => {
  const calls = [];
  const live = await 读取代理实时状态(async path => {
    calls.push(path);
    return path === '/proxies' ? { proxies: {
      Smart: { all: ['节点甲', '节点乙'], now: '节点乙' },
      '节点甲': { history: [{ delay: 15 }, { delay: 27 }] },
      '节点乙': { history: [{ delay: 0 }] }, DIRECT: {},
    } } : { connections: [
      { chains: ['Smart', '节点甲'], metadata: { host: 'private.example', sourceIP: '10.0.0.1' }, token: 'synthetic-private' },
      { chains: ['节点甲', 'Smart'] }, { chains: ['节点乙'] }, { chains: ['DIRECT'] }, { chains: ['unknown'] },
    ] };
  }, () => 1234);
  assert.deepEqual(calls.sort(), ['/connections', '/proxies']);
  assert.deepEqual(live, { observedAt: 1234, activeConnections: 5, nodes: [{ name: '节点乙', latencyMs: null }, { name: '节点甲', latencyMs: 27 }] });
  for (const forbidden of ['private.example', '10.0.0.1', 'synthetic-private', 'metadata', 'Smart']) assert.equal(JSON.stringify(live).includes(forbidden), false);
});

test('没有实际连接时不把Smart默认选择伪称当前节点，失败保持明确错误', async () => {
  const live = await 读取代理实时状态(async path => path === '/proxies' ? { proxies: { Smart: { now: '节点甲', all: ['节点甲'] }, '节点甲': {} } } : { connections: [] });
  assert.deepEqual(live.nodes, []); assert.equal(live.activeConnections, 0);
  await assert.rejects(读取代理实时状态(async () => { throw Error('controller unavailable'); }));
});

test('本地与网络面板共用在途读取，操作后不复用操作前的旧请求', async () => {
  const old = deferred(), calls = [];
  const client = createNetworkProxyClient({ command(value) { calls.push(value.operation); return calls.length === 1 ? old.promise : Promise.resolve({ protocol: 'guan-network-proxy.v1', result: { sequence: calls.length } }); } });
  const a = client.status(), b = client.status(); assert.equal(a, b); assert.deepEqual(calls, ['status']);
  await client.toggle(true);
  assert.deepEqual(await client.status(), { sequence: 3 });
  old.resolve({ protocol: 'guan-network-proxy.v1', result: { sequence: 1 } }); await a;
  assert.deepEqual(await client.status(), { sequence: 4 });
});

test('状态失败不会永久缓存，下一次自动读取可恢复', async () => {
  let calls = 0;
  const client = createNetworkProxyClient({ command: async () => { if (++calls === 1) throw Error('temporary'); return { protocol: 'guan-network-proxy.v1', result: { running: true } }; } });
  await assert.rejects(client.status()); assert.deepEqual(await client.status(), { running: true });
});

test('仅可见代理页签读取；慢请求不堆积，读取结束后5秒再刷新，离开清理', async t => {
  const first = deferred(); let calls = 0;
  const view = hook(t, async () => { calls++; if (calls === 1) await first.promise; }, 'hidden');
  assert.equal(calls, 0); t.mock.timers.tick(60000); assert.equal(calls, 0);
  view.visibility('visible'); assert.equal(calls, 1);
  view.visibility('visible'); t.mock.timers.tick(60000); assert.equal(calls, 1);
  first.resolve(); await flush();
  t.mock.timers.tick(4999); assert.equal(calls, 1); t.mock.timers.tick(1); assert.equal(calls, 2); await flush();
  view.visibility('hidden'); t.mock.timers.tick(60000); assert.equal(calls, 2);
  view.visibility('visible'); assert.equal(calls, 3); await flush();
  view.unmount(); t.mock.timers.tick(60000); assert.equal(calls, 3); assert.equal(view.listeners.size, 0);
});

test('隐藏页签不订阅，未完成读取在卸载后不能重启轮询', async t => {
  let calls = 0;
  const inactive = hook(t, async () => { calls++; }, 'visible', false);
  assert.equal(calls, 0); assert.equal(inactive.listeners.size, 0); inactive.unmount(); t.mock.timers.reset();
  const pending = deferred(), view = hook(t, async () => { calls++; await pending.promise; });
  assert.equal(calls, 1); view.unmount(); pending.resolve(); await flush();
  t.mock.timers.tick(60000); assert.equal(calls, 1); assert.equal(view.listeners.size, 0);
});

test('读取异常后按原节奏恢复，避免失败循环密集请求', async t => {
  let calls = 0;
  const view = hook(t, async () => { calls++; throw Error('temporary'); }); await flush();
  assert.equal(calls, 1); t.mock.timers.tick(4999); assert.equal(calls, 1);
  t.mock.timers.tick(1); await flush(); assert.equal(calls, 2); view.unmount();
});
