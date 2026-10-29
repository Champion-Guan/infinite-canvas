import test from 'node:test';
import assert from 'node:assert/strict';
import { 代理配置来源显示 } from '../扩展功能/网络代理/代理配置来源显示.mjs';
import { readProxySubscription } from '../扩展功能/网络代理/订阅读取.mjs';
import { MAX_PROXY_SOURCE } from '../扩展功能/网络代理/配置边界.mjs';

test('远端订阅状态不回显可能带有凭据的地址', () => {
  assert.equal(代理配置来源显示({ sourceKind: 'url', source: 'https://sub.example.com/?token=synthetic-secret' }), '已保存的远端订阅');
  assert.equal(代理配置来源显示({ sourceKind: 'text', configName: '代理配置.yaml' }), '代理配置.yaml');
});

test('用户填写的HTTPS订阅经受限传输读取，地址不写入显示名称', async () => {
  const config = 'proxies: []\n';
  let received;
  const value = await readProxySubscription('https://sub.example.com/a?token=synthetic-secret', {
    requestBytes: async options => {
      received = options;
      return { status: 200, bytes: Buffer.from(config) };
    },
  });
  assert.equal(value, config);
  assert.equal(received.url.href, 'https://sub.example.com/a?token=synthetic-secret');
  assert.equal(received.method, 'GET');
  assert.equal(received.headers.authorization, undefined);
  assert.equal(received.timeout, 30_000);
});

test('拒绝重定向、非200响应和超过上限的用户订阅', async () => {
  for (const reply of [
    { status: 302, bytes: Buffer.from('') },
    { status: 503, bytes: Buffer.from('') },
    { status: 200, bytes: Buffer.alloc(MAX_PROXY_SOURCE + 1) },
  ]) {
    await assert.rejects(readProxySubscription('https://sub.example.com/config', {
      requestBytes: async () => reply,
    }), error => error.code === 'proxy_subscription_failed');
  }
});
