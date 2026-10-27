import test from 'node:test';
import assert from 'node:assert/strict';
import { 内置网络代理订阅, 代理配置来源显示 } from '../扩展功能/网络代理/内置订阅设置.mjs';
import { readProxySubscription } from '../扩展功能/网络代理/订阅读取.mjs';
import { MAX_PROXY_SOURCE } from '../扩展功能/网络代理/配置边界.mjs';

test('公开内置订阅可显示；私人订阅查询参数不随状态回传', () => {
  assert.equal(代理配置来源显示({ sourceKind: 'url', source: 内置网络代理订阅 }), 内置网络代理订阅);
  assert.equal(代理配置来源显示({ sourceKind: 'url', source: 'https://sub.example.com/?token=synthetic-secret' }), '已保存的远端订阅');
  assert.equal(代理配置来源显示({ sourceKind: 'text', configName: '代理配置.yaml' }), '代理配置.yaml');
});
test('内置订阅首次读取固定指定地址，不携带页面凭据或跟随跳转', async () => {
  const config = 'proxies: []\n'; let calls = 0;
  const value = await readProxySubscription(内置网络代理订阅, { fetchImpl: async (url, options) => {
    calls++; assert.equal(url, 内置网络代理订阅); assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'omit');
    assert.equal(options.headers.authorization, undefined); assert.ok(options.signal instanceof AbortSignal);
    return new Response(config);
  } });
  assert.equal(value, config); assert.equal(calls, 1);
});
test('内置订阅拒绝跳转、声明超限及流式超限，并关闭读取流', async () => {
  for (const mode of ['redirect', 'length', 'stream']) {
    let cancelled = false;
    const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(mode === 'stream' ? MAX_PROXY_SOURCE + 1 : 1)); }, cancel() { cancelled = true; } });
    await assert.rejects(readProxySubscription(内置网络代理订阅, { fetchImpl: async () => new Response(body, { status: mode === 'redirect' ? 302 : 200, headers: mode === 'length' ? { 'content-length': String(MAX_PROXY_SOURCE + 1) } : {} }) }), error => error.code === 'proxy_subscription_failed');
    assert.equal(cancelled, true);
  }
});
