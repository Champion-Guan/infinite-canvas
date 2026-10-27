import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { normalizeEndpoint, planProviderRequest, publicIPv4 } from '../扩展功能/生成网关/受限请求规划.mjs';
import { validateSubmission, canonicalBase64, MAX_REQUEST_BYTES } from '../扩展功能/生成网关/生成协议.mjs';
import { generationFixture, containsText } from './生成网关隔离夹具.mjs';

const code = wanted => error => error?.code === wanted;
for (const endpoint of ['http://api.example.com', 'https://' + 'key:password@api.example.com', 'https://api.example.com?key=foo', 'https://api.example.com/#x', 'https://localhost', 'https://127.0.0.1', 'https://[::1]', 'https://169.254.169.254', 'https://machine.local', 'https://api.example.com/local-app', 'https://api.example.com/%2e%2e/test']) {
  test('渠道端点拒绝非公开或带认证信息：' + endpoint, () => assert.throws(() => normalizeEndpoint(endpoint), code('invalid_provider_endpoint')));
}
test('兼容/v1和/v1beta渠道基址，不重复拼版本；原路径白名单保留', () => {
  assert.equal(planProviderRequest({ kind: 'openai', endpoint: 'https://api.example.com/v1' }, '/v1/images/generations', 'POST', 'application/json').url.href, 'https://api.example.com/v1/images/generations');
  assert.equal(planProviderRequest({ kind: 'gemini', endpoint: 'https://api.example.com/v1beta' }, '/v1beta/models/gemini:generateContent', 'POST', 'application/json').url.href, 'https://api.example.com/v1beta/models/gemini:generateContent');
});
for (const path of ['//evil.example/v1/models', '/v1/../admin', '/v1/%2e%2e/admin', '/v1/%252fadmin', '/v1/models#secret', '/v1/models?key=secret', '/local-app', '/v1/models\\admin']) {
  test('请求路径绕过拒绝：' + path, () => assert.throws(() => planProviderRequest({ kind: 'openai', endpoint: 'https://api.example.com' }, path, 'GET')));
}
test('禁止Agent/WebDAV/GitHub、DELETE及修改模型/视频资源', () => {
  for (const kind of ['agent', 'webdav', 'github']) assert.throws(() => planProviderRequest({ kind, endpoint: 'https://api.example.com' }, '/v1/models', 'GET'));
  for (const [path, method] of [['/v1/models', 'POST'], ['/v1/videos/id', 'POST'], ['/v1/videos/id', 'DELETE'], ['/v1/images/generations', 'GET']]) assert.throws(() => planProviderRequest({ kind: 'openai', endpoint: 'https://api.example.com' }, path, method, 'application/json'));
});
test('固定DNS地址策略拒绝内网、元数据、CGNAT、保留地址和IPv6', () => {
  for (const address of ['127.0.0.1', '10.1.1.1', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '198.18.0.1', '224.0.0.1', '::1', '::ffff:127.0.0.1']) assert.equal(publicIPv4(address), false);
  assert.equal(publicIPv4('8.8.8.8'), true);
});
test('密钥不交付绑定/描述，不在SQLite、WAL、备份中明文出现', async () => {
  const f = await generationFixture();
  try {
    const bound = await f.bind(), view = f.gateway.describe(bound.binding);
    assert.deepEqual(Object.keys(view).sort(), ['binding', 'endpoint', 'kind']);
    assert.equal(JSON.stringify(view).includes(bound.value), false);
    assert.equal((await f.gateway.bind({ kind: 'openai', endpoint: f.providerOrigin, value: bound.value })).binding, bound.binding);
    await f.workspace.createBackup(); assert.equal(containsText(f.dataRoot, bound.value), false);
    assert.equal('read' in f.gateway, false);
  } finally { await f.close(); }
});
test('旧secret引用仅在服务端重新绑定，新地址得到独立引用，不能改写已有绑定', async () => {
  const f = await generationFixture();
  try {
    const ref = await f.vault.store('synthetic-existing-key'), a = await f.gateway.bindExistingProfile({ kind: 'openai', endpoint: f.providerOrigin, credentialRef: ref });
    const b = await f.gateway.bindExistingProfile({ kind: 'openai', endpoint: 'https://api.example.com', credentialRef: ref });
    assert.notEqual(a.binding, b.binding); assert.equal(f.gateway.describe(a.binding).endpoint, f.providerOrigin);
    await assert.rejects(f.gateway.bind({ kind: 'openai', endpoint: f.providerOrigin, credentialRef: ref }), code('invalid_provider_binding'));
    await assert.rejects(f.gateway.bindExistingProfile({ kind: 'openai', endpoint: f.providerOrigin, credentialRef: 'secret:' + 'a'.repeat(64) }));
  } finally { await f.close(); }
});
test('OpenAI与Gemini仅在后端加入认证头，响应回显消毒，不返回Cookie等头', async () => {
  const f = await generationFixture();
  try {
    for (const kind of ['openai', 'gemini']) {
      const bound = await f.bind(kind), input = f.submit(bound.binding);
      if (kind === 'gemini') input.request.path = '/v1beta/models/synthetic:generateContent';
      f.reply.bytes = Buffer.from(JSON.stringify({ plain: bound.value, encoded: encodeURIComponent(bound.value), b64: Buffer.from(bound.value).toString('base64') }));
      await f.tasks.submit(input); await f.tasks.drain(); const result = f.tasks.result(input.id);
      assert.equal(result.state, 'succeeded'); assert.equal(result.applied, false); assert.equal(result.bytes.includes(Buffer.from(bound.value)), false);
      const req = f.requests.at(-1);
      assert.equal(req.headers[kind === 'gemini' ? 'x-goog-api-key' : 'authorization'], kind === 'gemini' ? bound.value : 'Bearer ' + bound.value);
      assert.deepEqual(Object.keys(result.result).sort(), ['contentType', 'id', 'size', 'status']);
      assert.equal(containsText(f.dataRoot, bound.value), false);
    }
  } finally { await f.close(); }
});
test('跨主机重定向不跟随，任务待核实且原密钥不外泄', async () => {
  const f = await generationFixture();
  try { const bound = await f.bind(), input = f.submit(bound.binding); f.reply.redirect = true; await f.tasks.submit(input); await f.tasks.drain(); assert.equal(f.tasks.get(input.id).state, 'uncertain'); assert.equal(f.requests.length, 1); }
  finally { await f.close(); }
});
test('二进制回显已知密钥拒绝交付，不能借MIME绕过', async () => {
  const f = await generationFixture();
  try { const bound = await f.bind(), input = f.submit(bound.binding); f.reply.type = 'image/png'; f.reply.bytes = Buffer.from(bound.value); await f.tasks.submit(input); await f.tasks.drain(); assert.equal(f.tasks.get(input.id).state, 'uncertain'); }
  finally { await f.close(); }
});
test('任务格式严格：不接受任意URL、请求头、凭据与非规范base64', () => {
  const base = { id: randomUUID(), productId: 'p', nodeId: 'n', binding: 'provider:' + 'a'.repeat(64), request: { method: 'POST', path: '/v1/images/generations', contentType: 'application/json', body: 'e30=' } };
  validateSubmission(base);
  for (const extra of [{ url: 'https://evil.example' }, { headers: { authorization: 'secret' } }, { body: '$#' }]) assert.throws(() => validateSubmission({ ...base, request: { ...base.request, ...extra } }));
});
test('32MiB正文规范base64不耗尽正则栈，超限及伪造尾部拒绝', () => {
  const body = Buffer.alloc(MAX_REQUEST_BYTES, 120).toString('base64');
  const value = { id: randomUUID(), productId: 'p', nodeId: 'n', binding: 'provider:' + 'a'.repeat(64), request: { method: 'POST', path: '/v1/images/edits', contentType: 'application/json', body } };
  assert.equal(validateSubmission(value), value);
  for (const invalid of ['A', '====', 'AA=A', 'Zh==', 'Zm9=', 'AA\n=', 'AAA$', body.slice(0, -1) + 'A']) assert.equal(canonicalBase64(invalid, MAX_REQUEST_BYTES), false);
  for (const valid of ['', 'Zg==', 'Zm8=', 'Zm9v']) assert.equal(canonicalBase64(valid, MAX_REQUEST_BYTES), true);
});
