import test from 'node:test';
import assert from 'node:assert/strict';
import { bindPageAuthorization } from '../扩展功能/本机存储/页面授权生命周期.mjs';
import { authorizeLocalStorage } from '../扩展功能/本机存储/本机授权客户端.mjs';
function fixture() {
  const listeners = new Map(), calls = [];
  const dispose = bindPageAuthorization({ addEventListener: (key, fn) => listeners.set(key, fn), removeEventListener: key => listeners.delete(key) }, { close: async options => { calls.push(options); } });
  return { listeners, calls, dispose };
}
test('真正离开只释放一次，切标签与取消关闭不会触发', () => {
  const f = fixture(); assert.deepEqual([...f.listeners.keys()], ['pagehide']);
  f.listeners.get('pagehide')({ persisted: false }); f.listeners.get('pagehide')({ persisted: false });
  assert.deepEqual(f.calls, [{ keepalive: true }]);
});
test('bfcache保留原授权，恢复后真正离开才释放；解绑移除监听', () => {
  const f = fixture(); f.listeners.get('pagehide')({ persisted: true }); assert.equal(f.calls.length, 0);
  f.listeners.get('pagehide')({ persisted: false }); assert.equal(f.calls.length, 1);
  f.dispose(); assert.equal(f.listeners.size, 0);
});
test('释放仍使用原同源Bearer和协议，keepalive不改变权限或期限，关闭后拒绝业务', async () => {
  const calls = [], origin = 'http://localhost:3100', now = 1000, capability = 'a'.repeat(64);
  const authorization = await authorizeLocalStorage({ code: 'b'.repeat(64), origin, now: () => now, fetchImpl: async (url, init) => {
    calls.push({ url, init }); return { ok: true, json: async () => ({ protocol: 'guan-local-authorization.v1', origin, dataURL: 'http://127.0.0.1:3001', capability, expiresAt: 2000, session: null }) };
  } });
  await authorization.host.close({ keepalive: true });
  assert.equal(calls[1].url, origin + '/__guan-local/session');
  assert.equal(calls[1].init.keepalive, true); assert.equal(calls[1].init.headers.Authorization, 'Bearer ' + capability);
  assert.equal(calls[1].init.headers['X-Guan-Local-Protocol'], 'guan-local-authorization.v1');
  assert.deepEqual(JSON.parse(calls[1].init.body), { operation: 'close' });
  await authorization.host.close(); assert.equal(calls.length, 2);
  await assert.rejects(authorization.host.initialize(), error => error.code === 'authorization_expired');
});
test('更新释放页面连接丢失后可用原能力重试，丢失已提交回执也能确认结束', async () => {
  for (const committed of [false, true]) {
    const origin = 'http://localhost:3100', capability = 'a'.repeat(64);
    let requests = 0, active = true;
    const authorization = await authorizeLocalStorage({ code: 'b'.repeat(64), origin, now: () => 1000, fetchImpl: async (url, init) => {
      if (url.endsWith('/authorize')) return { ok: true, json: async () => ({ protocol: 'guan-local-authorization.v1',
        origin, dataURL: 'http://127.0.0.1:3001', capability, expiresAt: null }) };
      assert.equal(init.headers.Authorization, 'Bearer ' + capability);
      assert.deepEqual(JSON.parse(init.body), { operation: 'close' });
      if (++requests === 1) { if (committed) active = false; throw Error('合成连接中断'); }
      if (!active) return { ok: false, status: 401, json: async () => ({ protocol: 'guan-local-authorization.v1', error: { code: 'authorization_denied' } }) };
      active = false;
      return { ok: true, json: async () => ({ protocol: 'guan-local-authorization.v1' }) };
    } });
    await assert.rejects(authorization.host.close(), { code: 'authorization_connection_failed' });
    await authorization.host.close();
    assert.equal(requests, 2); assert.equal(active, false);
    await authorization.host.close(); assert.equal(requests, 2);
    await assert.rejects(authorization.host.initialize(), { code: 'authorization_expired' });
  }
});
