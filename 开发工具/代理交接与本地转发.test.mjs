import test from 'node:test';
import assert from 'node:assert/strict';
import { 创建本地转发, 检查转发目标 } from '../扩展功能/网络代理/本地转发服务.mjs';
import { 诊断代理连接 } from '../扩展功能/网络代理/代理节点诊断.mjs';
import { 解析代理公网地址 } from '../扩展功能/网络代理/代理域名解析.mjs';

function fixture() {
  const state = { relayEnabled: true, enabled: true }, calls = [], leases = [];
  const proxy = { status: () => state, acquireRoute(mode) { const lease = { mode, released: false, release() { this.released = true; } }; leases.push(lease); return lease; } };
  const send = mode => async request => { calls.push({ mode, request }); return { status: 200, contentType: 'text/plain', headers: { 'content-type': 'text/plain', etag: 'synthetic-secret' }, bytes: Buffer.from('Bearer synthetic-secret') }; };
  return { state, calls, leases, relay: 创建本地转发({ proxy, direct: send('direct'), proxied: send('proxy') }) };
}
const input = (extra = {}) => ({ url: 'https://dav.example.com/file', method: 'PUT', headers: { authorization: 'Bearer synthetic-secret', 'content-type': 'text/plain' }, body: Buffer.from('合成内容').toString('base64'), ...extra });
test('本地转发按实际网络开关选择路径，传正文及取消信号，认证不回显', async () => {
  const f = fixture(), signal = new AbortController().signal;
  const reply = await f.relay(input(), { signal });
  assert.equal(f.calls[0].mode, 'proxy'); assert.equal(f.calls[0].request.signal, signal);
  assert.equal(f.calls[0].request.bytes.toString(), '合成内容'); assert.equal(f.leases[0].released, true);
  assert.equal(Buffer.from(reply.body, 'base64').toString().includes('synthetic-secret'), false); assert.equal('etag' in reply.headers, false);
  f.state.enabled = false; await f.relay(input()); assert.equal(f.calls[1].mode, 'direct'); assert.equal(f.leases[1].released, true);
  f.state.relayEnabled = false; await assert.rejects(f.relay(input()), error => error.code === 'relay_disabled'); assert.equal(f.calls.length, 2);
});
test('拒绝内部目标、非法头及跨服务WebDAV目的地，保留正常WebDAV方法', async () => {
  for (const url of ['http://dav.example.com', 'https://127.0.0.1', 'https://localhost', 'https://a.local', 'https://u:p@dav.example.com']) assert.throws(() => 检查转发目标(url));
  const f = fixture();
  await assert.rejects(f.relay(input({ headers: { cookie: 'synthetic' } })), error => error.code === 'relay_header_invalid');
  await assert.rejects(f.relay(input({ method: 'MOVE', headers: { destination: 'https://other.example.com/file' } })), error => error.code === 'relay_target_invalid');
  await f.relay(input({ method: 'PROPFIND', headers: { depth: '1' } }));
  assert.equal(f.calls[0].request.method, 'PROPFIND');
});
test('转发失败释放租约，保持单次发送', async () => {
  let sent = 0, released = 0;
  const relay = 创建本地转发({ proxy: { status: () => ({ relayEnabled: true, enabled: true }), acquireRoute: () => ({ release() { released++; } }) }, proxied: async () => { sent++; throw Error('synthetic network failure'); } });
  await assert.rejects(relay(input())); assert.equal(sent, 1); assert.equal(released, 1);
});
test('32MiB媒体正文不发生正则栈溢出，非规范编码与超限拒绝', async () => {
  const f = fixture(), body = Buffer.alloc(32 * 1024 ** 2, 1).toString('base64');
  await f.relay(input({ body })); assert.equal(f.calls[0].request.bytes.length, 32 * 1024 ** 2);
  await assert.rejects(f.relay(input({ body: 'Zh==' })), error => error.code === 'relay_request_invalid');
  await assert.rejects(f.relay(input({ body: body + 'AAAA' })), error => error.code === 'relay_request_invalid');
});
test('系统Fake-IP经受管DoH取得固定公网IP，私网和无效DoH仍拒绝', async () => {
  let calls = 0;
  const query = async data => { calls++; return { status: 200, bytes: Buffer.from(JSON.stringify({ Status: 0, Answer: [{ type: 1, data }] })) }; };
  const publicIP = [{ address: '142.250.72.163' }];
  assert.deepEqual(await 解析代理公网地址(publicIP, () => query('1.1.1.1')), publicIP); assert.equal(calls, 0);
  assert.deepEqual(await 解析代理公网地址([{ address: '198.18.1.2' }], () => query('142.250.72.163')), publicIP); assert.equal(calls, 1);
  await assert.rejects(解析代理公网地址([{ address: '127.0.0.1' }], () => query('1.1.1.1'))); assert.equal(calls, 1);
  await assert.rejects(解析代理公网地址([{ address: '198.18.1.2' }], () => query('192.168.1.1')));
});
test('连通诊断依据实际连接链；未观测到时不把选择项冒充实际节点', async () => {
  for (const observed of [true, false]) {
    const result = await 诊断代理连接({ route: {}, probe: async () => { await new Promise(done => setTimeout(done, 10)); return { status: 204 }; }, api: async path => path === '/proxies' ? { proxies: { GROUP: { all: ['A'] }, A: { type: 'ss' } } } : { connections: observed ? [{ metadata: { host: 'www.gstatic.com' }, chains: ['A', 'GROUP'] }] : [] } });
    assert.equal(result.reachable, true); assert.equal(result.currentNode.name, observed ? 'A' : '未确认实际节点');
    assert.equal(result.currentNode.routeSource, observed ? 'connection' : 'unconfirmed');
  }
});
