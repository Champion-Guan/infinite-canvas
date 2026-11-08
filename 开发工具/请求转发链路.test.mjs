import test from 'node:test';
import assert from 'node:assert/strict';
import { 建立请求转发夹具 } from './请求转发隔离夹具.mjs';

test('原作者转发实现实际HTTP透传方法/合成认证/body/响应，并提供CORS预检与健康身份', async () => {
  const fixture = await 建立请求转发夹具();
  try {
    const health = await (await fetch(fixture.proxyUrl)).json();
    assert.equal(health.proxy, '@basketikun/canvas-proxy');
    const preflight = await fetch(fixture.proxyUrl + '/' + fixture.upstreamUrl + '/v1/models', { method: 'OPTIONS', headers: { Origin: 'http://localhost:3100', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization' } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), '*');
    assert.equal(fixture.requests.length, 0);
    const body = JSON.stringify({ prompt: 'synthetic-fixture', count: 1 });
    const response = await fetch(fixture.proxyUrl + '/' + fixture.upstreamUrl + '/v1/images/generations', { method: 'POST', headers: { Authorization: 'Bearer ' + 'synthetic-fixture-only', 'content-type': 'application/json', Origin: 'http://localhost:3100' }, body });
    assert.equal(response.status, 202);
    assert.equal(response.headers.get('x-synthetic-result'), 'forwarded');
    assert.equal((await response.json()).accepted, true);
    assert.deepEqual(fixture.requests, [{ method: 'POST', path: '/v1/images/generations', authorization: 'Bearer ' + 'synthetic-fixture-only', body }]);
  } finally { await fixture.close(); }
});
test('原转发器实际保留SSE分块与二进制，解压后不残留上游压缩头', async () => {
  const fixture = await 建立请求转发夹具();
  try {
    const response = await fetch(fixture.proxyUrl + '/' + fixture.upstreamUrl + '/v1/stream');
    const reader = response.body.getReader();
    const first = await reader.read();
    assert.match(new TextDecoder().decode(first.value), /first/);
    assert.doesNotMatch(new TextDecoder().decode(first.value), /\[DONE\]/);
    fixture.finishStream();
    let remaining = '';
    for (;;) { const value = await reader.read(); if (value.done) break; remaining += new TextDecoder().decode(value.value); }
    assert.match(remaining, /\[DONE\]/);
    const binary = await fetch(fixture.proxyUrl + '/' + fixture.upstreamUrl + '/binary');
    assert.equal(binary.headers.get('content-encoding'), null);
    assert.equal(binary.headers.get('content-length'), null);
    assert.deepEqual([...new Uint8Array(await binary.arrayBuffer())], [0, 1, 2, 128, 255]);
  } finally { await fixture.close(); }
});
test('原转发器真实返回上游失败状态，不吞错或伪装成功', async () => {
  const fixture = await 建立请求转发夹具();
  try {
    fixture.setFailure(true);
    const response = await fetch(fixture.proxyUrl + '/' + fixture.upstreamUrl + '/v1/models');
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.message, 'synthetic-unavailable');
  } finally { await fixture.close(); }
});
