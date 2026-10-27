import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { generationFixture, listen, closeServer } from './生成网关隔离夹具.mjs';
import { migrateLegacyChannelBindings } from '../扩展功能/本机凭据/旧渠道绑定迁移.mjs';
import { createCredentialClient } from '../扩展功能/本机凭据/凭据客户端.mjs';
import { createValueCodec } from '../扩展功能/本机存储/应用值编码.mjs';
import { createGenerationHTTPHandler } from '../扩展功能/生成网关/生成HTTP入口.mjs';
import { createProviderModelReader } from '../扩展功能/生成网关/渠道模型读取.mjs';
import { createLocalAuthorizationGateway } from '../扩展功能/本机服务/本机授权网关.mjs';
import { authorizeLocalStorage } from '../扩展功能/本机存储/本机授权客户端.mjs';
import { createSessionController } from '../扩展功能/本机服务/受控会话.mjs';
import { startDataService } from '../扩展功能/本机服务/数据服务.mjs';
import { buildFragmentPlan } from '../扩展功能/本机存储/分片值编码.mjs';
import { bindChannelConfiguration } from '../扩展功能/本机凭据/页面凭据引用.mjs';
import { createChannelSaveFlow, patchChannelDraft, sealConfiguration } from '../扩展功能/本机凭据/渠道编辑流程.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const code = expected => error => error?.code === expected;
const rootId = namespace => 'app-' + sha(namespace);
const typedChannel = (ref, endpoint, kind = 'openai') => ['object', [['apiKey', ['secret', ref]], ['baseUrl', ['string', endpoint]], ['apiFormat', ['string', kind]]]];
function save(workspace, id, value) { return workspace.writeDocument({ collection: 'extension', id, value, expectedRevision: workspace.readDocument('extension', id)?.revision ?? 0, operationId: randomUUID() }); }
async function legacy(f, { v2 = false, namespace = 'app_state', tree } = {}) {
  const ref = await f.vault.store('synthetic-legacy-secret'), channel = tree || typedChannel(ref, f.providerOrigin);
  const entries = [['legacy', { tree: ['array', [channel, ['object', [['history', ['array', [channel]]]]]]], mediaIds: [] }]];
  let value = { format: 'guan-app-storage.v1', namespace, entries };
  if (v2) {
    const plan = await buildFragmentPlan(entries);
    for (const part of plan.fragments.values()) save(f.workspace, part.id, part.value);
    value = { format: 'guan-app-storage.v2', namespace, head: plan.head, entryCount: entries.length };
  }
  save(f.workspace, rootId(namespace), value);
  return { ref, channel, root: f.workspace.readDocument('extension', rootId(namespace)) };
}
const migrate = (f, options = {}) => migrateLegacyChannelBindings({ workspace: f.workspace, gateway: f.gateway, runWrite: f.coordinator.runWrite, ...options });
function pagePort(f, calls = []) {
  return createCredentialClient({ command: async value => {
    calls.push(value.operation);
    if (value.operation === 'store') return { format: 'guan-credentials.v1', ref: await f.vault.store(value.value) };
    await f.vault.inspect(value.ref);
    return { format: 'guan-credentials.v1', ref: value.ref };
  }, generationPort: { bind: f.gateway.bind, describe: async id => f.gateway.describe(id), resolveSaved: async profile => f.gateway.resolveSaved(profile) } });
}

for (const v2 of [false, true]) test('旧配置及历史快照建立固定绑定，原根不改写、刷新不需要重填：' + (v2 ? 'v2' : 'v1'), async () => {
  const f = await generationFixture();
  try {
    const old = await legacy(f, { v2 }); await migrate(f);
    assert.deepEqual(f.workspace.readDocument('extension', rootId('app_state')), old.root);
    const binding = f.gateway.resolveSaved({ kind: 'openai', endpoint: f.providerOrigin, credentialRef: old.ref });
    assert.match(binding.binding, /^provider:[a-f0-9]{64}$/);
    const calls = [], codec = createValueCodec({ client: {}, secretPort: pagePort(f, calls) });
    const value = await codec.decode(old.channel);
    assert.equal(value.apiKey, binding.binding); assert.equal(JSON.stringify(value).includes('synthetic-legacy-secret'), false);
    assert.deepEqual(calls, ['inspect']);
    await migrate(f); assert.equal(f.workspace.readDocument('extension', 'guan-credential-binding-migration-v1').revision, 1);
    const reopened = createValueCodec({ client: {}, secretPort: pagePort(f) });
    assert.equal((await reopened.decode(old.channel)).apiKey, binding.binding);
    codec.close(); reopened.close();
  } finally { await f.close(); }
});
test('首次迁移完成后伪造旧树不能建立新地址绑定，resolve只读且不写盘', async () => {
  const f = await generationFixture();
  try {
    const old = await legacy(f); await migrate(f);
    const altered = typedChannel(old.ref, 'https://other.example.com');
    save(f.workspace, rootId('app_state'), { format: 'guan-app-storage.v1', namespace: 'app_state', entries: [['forged', { tree: altered, mediaIds: [] }]] });
    const before = f.workspace.listDocuments('extension'); await migrate(f);
    assert.equal(f.gateway.resolveSaved({ kind: 'openai', endpoint: 'https://other.example.com', credentialRef: old.ref }), null);
    const codec = createValueCodec({ client: {}, secretPort: pagePort(f) });
    const channel = await codec.decode(altered);
    assert.equal(channel.apiKey, 'guan-vault:' + old.ref);
    await assert.rejects(bindChannelConfiguration(f.gateway, channel), code('channel_credential_unbound'));
    assert.deepEqual(f.workspace.listDocuments('extension'), before); codec.close();
  } finally { await f.close(); }
});
test('无效旧地址保留封存引用，不阻断其他渠道恢复、不把引用当新密钥保存', async () => {
  const f = await generationFixture();
  try {
    const ref = await f.vault.store('synthetic-old-local'), tree = typedChannel(ref, 'http://localhost:3000');
    await legacy(f, { tree }); await migrate(f);
    const codec = createValueCodec({ client: {}, secretPort: pagePort(f) }), restored = await codec.decode(tree);
    assert.equal(restored.apiKey, 'guan-vault:' + ref);
    assert.deepEqual((await codec.encode(restored)).tree, tree);
    assert.equal(f.workspace.listDocuments('extension').filter(row => row.id.startsWith('secret:')).length, 2); codec.close();
  } finally { await f.close(); }
});
test('新密钥保存与恢复只交付provider，替换地址/协议不复用旧绑定，重复保存不新建密文', async () => {
  const f = await generationFixture();
  try {
    const codec = createValueCodec({ client: {}, secretPort: pagePort(f) });
    const input = { apiKey: 'synthetic-new-private', baseUrl: f.providerOrigin, apiFormat: 'openai' };
    const encoded = await codec.encode(input), restored = await codec.decode(encoded.tree);
    assert.match(restored.apiKey, /^provider:/); assert.equal(JSON.stringify(encoded).includes(input.apiKey), false);
    const before = f.workspace.listDocuments('extension'); assert.deepEqual(await codec.encode(restored), encoded);
    assert.deepEqual(f.workspace.listDocuments('extension'), before);
    await assert.rejects(codec.encode({ ...restored, baseUrl: 'https://other.example.com' }), code('channel_credential_scope_changed'));
    await assert.rejects(codec.encode({ ...restored, apiFormat: 'gemini' }), code('channel_credential_scope_changed'));
    assert.equal(patchChannelDraft(restored, { baseUrl: 'https://other.example.com' }).apiKey, '');
    assert.equal(patchChannelDraft(restored, { baseUrl: f.providerOrigin + '/' }).apiKey, restored.apiKey);
    assert.equal(patchChannelDraft(restored, { apiFormat: 'gemini' }).apiKey, '');
    const password = await codec.decode((await codec.encode({ password: 'synthetic-' + 'inactive-webdav' })).tree);
    assert.match(password.password, /^guan-vault:secret:/); assert.equal(JSON.stringify(password).includes('synthetic-inactive-webdav'), false);
    codec.close();
  } finally { await f.close(); }
});
for (const phase of ['before', 'after', 'ack']) test('迁移标记失败可重试，丢ACK核对已提交结果，原根保持：' + phase, async () => {
  const f = await generationFixture();
  try {
    const old = await legacy(f); let once = true;
    const workspace = { ...f.workspace, writeDocument(value) {
      if (value.id !== 'guan-credential-binding-migration-v1' || !once) return f.workspace.writeDocument(value);
      once = false;
      if (phase === 'before') throw Error('synthetic-before');
      const ack = f.workspace.writeDocument(value);
      if (phase === 'after') throw Error('synthetic-after');
      return { ...ack, hash: 'f'.repeat(64) };
    } };
    if (phase === 'before') await assert.rejects(migrate(f, { workspace })); else await migrate(f, { workspace });
    await migrate(f, { workspace });
    assert.deepEqual(f.workspace.readDocument('extension', rootId('app_state')), old.root);
    assert.equal(f.workspace.readDocument('extension', 'guan-credential-binding-migration-v1').revision, 1);
  } finally { await f.close(); }
});
test('HTTP授权→凭据检查→旧配置恢复→模型认证闭环，read/改绑定/保留文档写入均拒绝', async () => {
  const f = await generationFixture(); let authGateway, generationHandler;
  const server = createServer(async (req, res) => { if (await generationHandler?.(req, res) || await authGateway?.handle(req, res)) return; res.writeHead(404); res.end(); });
  const origin = await listen(server), data = await startDataService({ workspace: f.workspace, allowedOrigins: [origin], rateLimit: 0 });
  const controller = createSessionController({ service: data, origin });
  try {
    const old = await legacy(f); await migrate(f);
    authGateway = createLocalAuthorizationGateway({ origin, dataURL: data.url, controller, credentialPort: f.vault });
    generationHandler = createGenerationHTTPHandler({ origin, authorize: req => authGateway.assertGenerationPage(req), gateway: f.gateway, tasks: f.tasks, models: createProviderModelReader({ gateway: f.gateway }) });
    const requests = [], replies = [], transport = async (url, init) => {
      requests.push(JSON.parse(init.body));
      const response = await fetch(url, { ...init, headers: { ...init.headers, Origin: origin, 'Sec-Fetch-Site': 'same-origin' } });
      replies.push(await response.clone().text()); return response;
    };
    const auth = await authorizeLocalStorage({ origin, code: authGateway.issueTicket().code, fetchImpl: transport });
    const session = await auth.host.initialize(), codec = createValueCodec({ client: {}, secretPort: auth.secretPort });
    const channel = await codec.decode(old.channel);
    f.reply.bytes = Buffer.from('{"data":[{"id":"model-a"}]}');
    assert.deepEqual(await auth.generationPort.models(channel.apiKey), ['model-a']);
    assert.equal(f.requests.at(-1).headers.authorization, 'Bearer ' + 'synthetic-legacy-secret');
    assert.equal(replies.join('').includes('synthetic-legacy-secret'), false); assert.equal(auth.secretPort.read, undefined);
    const beforePreview = f.workspace.listDocuments('extension');
    assert.deepEqual(await auth.generationPort.previewCredential(channel.apiKey), { binding: channel.apiKey, maskedKey: 'synthe***cret' });
    assert.equal(replies.join('').includes('synthetic-legacy-secret'), false);
    assert.deepEqual(f.workspace.listDocuments('extension'), beforePreview, '查看脱敏密钥不能触发保存');
    const exchange = await fetch(origin + '/__guan-local/authorize', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Guan-Local-Protocol': 'guan-local-authorization.v1' }, body: JSON.stringify({ code: authGateway.issueTicket().code }) });
    const page = await exchange.json();
    const denied = await fetch(origin + '/__guan-local/credentials', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Guan-Local-Protocol': 'guan-local-authorization.v1', Authorization: 'Bearer ' + page.capability }, body: JSON.stringify({ operation: 'read', ref: old.ref }) });
    assert.equal(denied.status, 400); assert.equal((await denied.text()).includes('synthetic-legacy-secret'), false);
    assert.equal(await auth.generationPort.resolveSaved({ kind: 'openai', endpoint: 'https://other.example.com', credentialRef: old.ref }), null);
    for (const id of ['secret:' + 'a'.repeat(64), 'provider:' + 'b'.repeat(64), 'guan-credential-vault', 'guan-credential-binding-migration-v1']) {
      const result = await fetch(data.url + `/v1/workspaces/${f.workspace.workspaceId}/documents/extension/${id}`, { method: 'PUT', headers: { Origin: origin, Authorization: 'Bearer ' + session.token, 'X-Guan-CSRF': session.csrf, 'Content-Type': 'application/json' }, body: JSON.stringify({ value: { forged: true }, expectedRevision: 0, operationId: randomUUID() }) });
      assert.equal(result.status, 403);
    }
    codec.close(); await auth.host.close();
  } finally { authGateway?.close(); controller.close(); await closeServer(server); await data.close(); await f.close(); }
});
test('编辑取消和切换期间迟到的绑定不提交；保存失败只重试原队列、不再次绑定或提交', async () => {
  let release, binds = 0, commits = 0, retries = 0, current = true, fail = true;
  const flow = createChannelSaveFlow({ bind: () => { binds++; return new Promise(resolve => { release = resolve; }); }, commit: () => { commits++; }, flush: async () => { if (fail) throw Error('synthetic-save'); }, retry: async () => { retries++; fail = false; } });
  const channel = { id: 'one', apiKey: 'synthetic-edit' };
  const cancelled = flow.save(channel, () => current); flow.invalidate(); current = false; release('provider:' + 'a'.repeat(64));
  assert.equal(await cancelled, null); assert.equal(commits, 0);
  current = true;
  const failed = flow.save(channel, () => current); release('provider:' + 'b'.repeat(64)); await assert.rejects(failed);
  assert.equal(flow.getStatus().pending, true); assert.equal(commits, 1);
  const saved = await flow.save({ ...channel, apiKey: 'ignored-new-draft' }, () => current);
  assert.equal(saved.apiKey, 'provider:' + 'b'.repeat(64)); assert.equal(binds, 2); assert.equal(commits, 1); assert.equal(retries, 1);
  assert.equal(flow.getStatus().pending, false);
});
test('导入新渠道候选先封存全部密钥，失败不修改原对象，脱敏旧引用仅同地址复用', async () => {
  const f = await generationFixture();
  try {
    const channel = { apiKey: 'synthetic-import-key', baseUrl: f.providerOrigin, apiFormat: 'openai' };
    const original = { ...channel, channels: [{ ...channel, id: 'one' }] };
    const protectedConfig = await sealConfiguration(original, () => f.gateway);
    assert.match(protectedConfig.apiKey, /^provider:/); assert.equal(protectedConfig.apiKey, protectedConfig.channels[0].apiKey);
    assert.equal(original.apiKey, 'synthetic-import-key'); assert.equal(original.channels[0].apiKey, original.apiKey);
    assert.deepEqual(await sealConfiguration(protectedConfig, () => f.gateway), protectedConfig);
    const changed = { ...protectedConfig, channels: [{ ...protectedConfig.channels[0], baseUrl: 'https://other.example.com' }] };
    await assert.rejects(sealConfiguration(changed, () => f.gateway), code('channel_credential_scope_changed'));
    assert.equal(changed.channels[0].apiKey, protectedConfig.apiKey);
  } finally { await f.close(); }
});

test('未确认保存后切到另一渠道，先排空旧队列再保存当前渠道，不误交付旧草稿', async () => {
  let fail = true;
  const committed = [], bindings = [];
  const flow = createChannelSaveFlow({ bind: async channel => { bindings.push(channel.id); return 'provider:' + channel.id.repeat(64); },
    commit: value => committed.push(value.id), flush: async () => { if (fail) throw Error('unconfirmed'); }, retry: async () => { fail = false; } });
  await assert.rejects(flow.save({ id: 'a', apiKey: 'synthetic-a' }, () => true));
  flow.invalidate();
  const saved = await flow.save({ id: 'b', apiKey: 'synthetic-b' }, () => true);
  assert.equal(saved.id, 'b'); assert.deepEqual(committed, ['a', 'b']); assert.deepEqual(bindings, ['a', 'b']);
});

test('配置提交前同步失败不伪造待保存队列，重试仍须真正提交配置', async () => {
  let attempts = 0, flushes = 0;
  const flow = createChannelSaveFlow({ bind: async () => 'provider:' + 'a'.repeat(64), commit: () => { if (++attempts === 1) throw Error('rejected'); },
    flush: async () => { flushes++; }, retry: async () => assert.fail('没有提交的操作不能靠排空队列伪造保存成功') });
  const channel = { id: 'a', apiKey: 'synthetic-a' };
  await assert.rejects(flow.save(channel, () => true)); assert.equal(flow.getStatus().pending, false);
  assert.equal((await flow.save(channel, () => true)).id, 'a'); assert.equal(attempts, 2); assert.equal(flushes, 1);
});
