import assert from 'node:assert/strict';
import test from 'node:test';
import { maskCredential, readCredentialPreview } from '../扩展功能/本机凭据/密钥脱敏.mjs';
import { bindChannelConfiguration } from '../扩展功能/本机凭据/页面凭据引用.mjs';
import { createChannelSaveFlow } from '../扩展功能/本机凭据/渠道编辑流程.mjs';
import { generationFixture } from './生成网关隔离夹具.mjs';

test('长密钥显示前六后四，长度不同仍只有三个星号，短密钥不完整泄露', () => {
  assert.equal(maskCredential('sk-' + '18f-masked-content-89ba'), 'sk-18f***89ba');
  assert.equal(maskCredential('sk-' + '18f-longer-masked-content-89ba'), 'sk-18f***89ba');
  for (let length = 1; length <= 14; length++) {
    const key = 'abcdefghijklmn'.slice(0, length), display = maskCredential(key);
    assert.ok(display.includes('***'));
    assert.ok(!display.includes(key));
    assert.ok(display.replaceAll('*', '').length <= Math.max(0, key.length - 4));
  }
});

test('凭据核对只返回脱敏值，不改写绑定、不产生上游请求或明文导出', async () => {
  const f = await generationFixture();
  try {
    const saved = await f.bind('openai', 'sk-' + '18f-synthetic-only-89ba');
    const before = f.workspace.listDocuments('extension');
    assert.deepEqual(await f.gateway.previewCredential(saved.binding), { binding: saved.binding, maskedKey: 'sk-18f***89ba' });
    assert.equal(await readCredentialPreview(f.gateway, saved.binding), 'sk-18f***89ba');
    assert.deepEqual(f.workspace.listDocuments('extension'), before);
    assert.equal(f.requests.length, 0);
    await assert.rejects(f.gateway.previewCredential('secret:' + 'a'.repeat(64)));
    await assert.rejects(f.gateway.previewCredential('provider:' + 'a'.repeat(64)));
  } finally { await f.close(); }
});

test('修改其他配置保留原密钥，复制的脱敏值在前后端都不能误存为新密钥', async () => {
  const f = await generationFixture();
  try {
    const saved = await f.bind('openai', 'sk-' + '18f-synthetic-only-89ba');
    const channel = { id: 'one', name: '仅修改渠道名称', apiFormat: 'openai', baseUrl: f.providerOrigin, apiKey: saved.binding };
    let committed;
    const flow = createChannelSaveFlow({ bind: value => bindChannelConfiguration(f.gateway, value), commit: value => { committed = value; }, flush: async () => {}, retry: async () => {} });
    await flow.save(channel, () => true);
    assert.equal(committed.apiKey, saved.binding);
    await assert.rejects(bindChannelConfiguration(f.gateway, { ...channel, apiKey: 'sk-18f***89ba' }), { code: 'channel_credential_masked' });
    await assert.rejects(f.gateway.bind({ kind: 'openai', endpoint: f.providerOrigin, value: 'sk-18f***89ba' }), { code: 'invalid_provider_credential' });
    assert.equal(f.gateway.describe(saved.binding).binding, saved.binding);
  } finally { await f.close(); }
});

test('核对响应必须属于当前绑定，失败或完整明文响应不能显示', async () => {
  const binding = 'provider:' + 'a'.repeat(64);
  for (const response of [{ binding: 'provider:' + 'b'.repeat(64), maskedKey: 'sk-18f***89ba' }, { binding, maskedKey: 'sk-' + '18f-synthetic-only-89ba' }, { binding, maskedKey: 'sk-18f***89ba\nunsafe' }]) {
    await assert.rejects(readCredentialPreview({ previewCredential: async () => response }, binding));
  }
  await assert.rejects(readCredentialPreview({}, binding));
});
