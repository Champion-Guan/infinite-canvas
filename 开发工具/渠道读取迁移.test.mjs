import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID, createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { generationFixture, listen, closeServer } from './生成网关隔离夹具.mjs';
import { createProviderModelReader } from '../扩展功能/生成网关/渠道模型读取.mjs';
import { planVideoDownload } from '../扩展功能/生成网关/视频下载规划.mjs';
import { openRemoteVideoLedger } from '../扩展功能/生成任务/视频远端任务账本.mjs';
import { createGenerationHTTPHandler } from '../扩展功能/生成网关/生成HTTP入口.mjs';
import { createGenerationClient } from '../扩展功能/生成任务/生成任务客户端.mjs';
import { waitForProtectedVideo } from '../扩展功能/生成任务/视频读取客户端.mjs';
import { GENERATION_PROTOCOL } from '../扩展功能/生成网关/生成协议.mjs';
import { StorageError } from '../扩展功能/本机存储/协议.mjs';

const errorCode = expected => error => error?.code === expected;
const mp4 = Buffer.from([0, 0, 0, 16, ...Buffer.from('ftypisom'), 0, 0, 0, 0]);
async function fixture(options = {}) {
  const f = await generationFixture(options);
  const videos = openRemoteVideoLedger({ workspace: f.workspace, gateway: f.gateway, coordinator: f.coordinator, verifySaved: async () => false });
  return { ...f, videos, models: createProviderModelReader({ gateway: f.gateway }),
    async track(provider = 'openai', endpoint = f.providerOrigin) {
      const bound = await f.gateway.bind({ kind: provider, endpoint, value: 'synthetic-video-secret' });
      const scope = { id: randomUUID(), productId: 'product', nodeId: randomUUID(), binding: bound.binding, provider, model: 'veo' };
      return videos.ensure(scope, provider === 'openai' ? 'video_123' : 'operations/abc-123');
    },
    json(value) { f.reply.type = 'application/json'; f.reply.bytes = Buffer.from(JSON.stringify(value)); },
    async close() { await videos.close(); await f.close(); },
  };
}
test('模型通过原绑定读取、排序去重；同渠道并发合并，不创建生成任务', async () => {
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; }), ready = new Promise(resolve => { entered = resolve; });
  const f = await fixture({ beforeReply: async () => { entered(); await gate; } });
  try {
    const binding = (await f.bind()).binding; f.json({ data: [{ id: 'z-model' }, { id: 'a-model' }, { id: 'a-model' }] });
    const first = f.models.read(binding); await ready;
    const second = f.models.read(binding); assert.equal(first, second); release();
    assert.deepEqual(await first, ['a-model', 'z-model']); assert.equal(f.requests.length, 1);
    assert.equal(f.requests[0].method, 'GET'); assert.equal(f.requests[0].path, '/v1/models');
    assert.match(f.requests[0].headers.authorization, /^Bearer synthetic-/); assert.deepEqual(f.tasks.list('product'), []);
  } finally { release(); await f.close(); }
});
test('Gemini模型分页由后端完整读取，保留版本，循环分页拒绝假成功', async () => {
  let loop = false;
  const f = await fixture({ respond(req, res) {
    const second = req.url.includes('pageToken=');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ models: [{ name: second ? 'models/a' : 'models/z' }], ...(!second || loop ? { nextPageToken: 'next+页' } : {}) }));
  } });
  try {
    const binding = (await f.gateway.bind({ kind: 'gemini', endpoint: f.providerOrigin + '/v1', value: 'synthetic-model-secret' })).binding;
    assert.deepEqual(await f.models.read(binding), ['a', 'z']); assert.match(f.requests[0].path, /^\/v1\/models\?pageSize=1000$/);
    assert.match(f.requests[1].path, /pageToken=next%2B/); assert.equal(f.requests[1].headers['x-goog-api-key'], 'synthetic-model-secret');
    loop = true; await assert.rejects(f.models.read(binding), errorCode('model_read_invalid'));
  } finally { await f.close(); }
});
test('模型错误、缺失列表、坏名称、坏分页不能清空用户列表或假成功', async () => {
  const f = await fixture();
  try {
    const binding = (await f.bind()).binding;
    for (const value of [{ error: { message: 'synthetic' }, data: [] }, { code: 500, data: [] }, {}, { data: [{ id: 1 }] }, { data: [{ id: 'bad\nname' }] }]) {
      f.json(value); await assert.rejects(f.models.read(binding), errorCode('model_read_invalid'));
    }
    f.reply.status = 401; f.json({ data: [] }); await assert.rejects(f.models.read(binding), errorCode('model_read_unconfirmed'));
    f.reply.status = 200; f.reply.type = 'text/html'; await assert.rejects(f.models.read(binding), errorCode('model_read_unconfirmed'));
  } finally { await f.close(); }
});
test('视频只按账本原绑定查询；轮询不写盘、不返回远端URL或原始响应', async () => {
  const f = await fixture();
  try {
    const job = await f.track(), revision = f.workspace.readDocument('extension', 'guan-video-remote-tasks').revision;
    f.json({ id: job.remoteId, status: 'in_progress', url: f.providerOrigin + '/cdn/result.mp4', extra: 'private' });
    assert.deepEqual(await f.videos.poll(job.id), { id: job.id, productId: job.productId, nodeId: job.nodeId, remoteId: job.remoteId, status: 'pending' });
    assert.equal(f.workspace.readDocument('extension', 'guan-video-remote-tasks').revision, revision);
    assert.equal(f.requests[0].headers.authorization, 'Bearer ' + 'synthetic-video-secret');
    await assert.rejects(f.videos.download(job.id), errorCode('video_remote_pending'));
    f.json({ id: 'other_video', status: 'completed' }); await assert.rejects(f.videos.poll(job.id), errorCode('video_check_mismatch'));
    f.json({ id: job.remoteId, status: 'completed', code: 500 }); await assert.rejects(f.videos.poll(job.id), errorCode('video_check_unconfirmed'));
    assert.equal(f.requests.filter(value => value.method === 'POST').length, 0);
  } finally { await f.close(); }
});
test('OpenAI完成后从原content下载并校验文件，下载不解除未保存视频的升级保护', async () => {
  const f = await fixture({ respond(req, res) {
    if (req.url.endsWith('/content')) { res.writeHead(200, { 'content-type': 'video/mp4' }); res.end(mp4); }
    else { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ id: 'video_123', status: 'completed' })); }
  } });
  try {
    const job = await f.track(), result = await f.videos.download(job.id);
    assert.equal(result.id, job.id); assert.equal(result.media.bytes, mp4.toString('base64')); assert.equal(result.media.hash, createHash('sha256').update(mp4).digest('hex'));
    assert.equal(f.requests.at(-1).path, '/v1/videos/video_123/content'); assert.equal(f.requests.at(-1).headers.authorization, 'Bearer ' + 'synthetic-video-secret');
    assert.throws(() => f.videos.assertCanUpdate(), errorCode('install_tasks_pending'));
  } finally { await f.close(); }
});
test('Gemini视频下载删除URI中的key，使用原绑定认证；v1查询不误用v1beta', async () => {
  let origin;
  const f = await fixture({ respond(req, res) {
    if (req.url.includes('/files/')) { assert.equal(req.url, '/v1/files/video:download?alt=media'); res.writeHead(200, { 'content-type': 'application/octet-stream' }); res.end(mp4); }
    else { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ name: 'operations/abc-123', done: true,
      response: { generateVideoResponse: { generatedSamples: [{ video: { uri: origin + '/v1/files/video:download?alt=media&key=synthetic-video-secret' } }] } } })); }
  } }); origin = f.providerOrigin;
  try {
    const job = await f.track('gemini', origin + '/v1'); const result = await f.videos.download(job.id);
    assert.equal(result.media.contentType, 'video/mp4'); assert.equal(f.requests[0].path, '/v1/operations/abc-123');
    assert.equal(f.requests.at(-1).headers['x-goog-api-key'], 'synthetic-video-secret'); assert.equal(f.requests.at(-1).headers.authorization, undefined);
  } finally { await f.close(); }
});
test('CDN下载不附带渠道认证；无凭据回显、重定向或坏媒体降级', async () => {
  let origin, mode = 'good';
  const f = await fixture({ respond(req, res) {
    if (req.url.startsWith('/cdn/')) {
      assert.equal(req.headers.authorization, undefined); assert.equal(req.headers['x-goog-api-key'], undefined);
      if (mode === 'redirect') { res.writeHead(302, { location: 'https://never-contact.invalid' }); res.end(); }
      else { res.writeHead(200, { 'content-type': 'video/mp4' }); res.end(mode === 'good' ? mp4 : Buffer.from(mode === 'secret' ? 'synthetic-video-secret' : '<html>failure</html>')); }
    } else { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ id: 'video_123', status: 'completed', video_url: origin + '/cdn/result.mp4' })); }
  } }); origin = f.providerOrigin;
  try {
    const job = await f.track(); assert.equal((await f.videos.download(job.id)).media.size, mp4.length);
    mode = 'bad'; await assert.rejects(f.videos.download(job.id), errorCode('video_media_invalid'));
    mode = 'secret'; await assert.rejects(f.videos.download(job.id), errorCode('provider_response_invalid'));
    mode = 'redirect'; await assert.rejects(f.videos.download(job.id), errorCode('provider_redirect_denied'));
    assert.equal(f.requests.filter(value => value.method === 'POST').length, 0);
  } finally { await f.close(); }
});
test('媒体规划拒绝本机、私有地址、用户名密码、伪造认证API查询与编码穿越', () => {
  const profile = { kind: 'gemini', endpoint: 'https://api.example.com/v1beta' };
  for (const url of ['http://127.0.0.1/a', 'https://192.168.1.1/a', 'https://metadata.internal/a', 'https://' + 'user:pass@cdn.example.com/a',
    'https://api.example.com/v1beta/files/a:download?arbitrary=1', 'https://api.example.com/v1beta/files/%2e%2e:download'])
    assert.throws(() => planVideoDownload(profile, url));
  assert.equal(planVideoDownload(profile, 'https://cdn.example.com/signed.mp4?signature=abc').authenticated, false);
});
test('未知远端任务不发送查询，失败与缺失媒体不标成功', async () => {
  const f = await fixture();
  try {
    const job = await f.track('gemini'); f.json({ name: job.remoteId, done: true, error: { message: 'synthetic' } });
    assert.equal((await f.videos.poll(job.id)).status, 'failed'); await assert.rejects(f.videos.download(job.id), errorCode('video_remote_pending'));
    f.json({ name: job.remoteId, done: true }); await assert.rejects(f.videos.download(job.id), errorCode('video_media_missing'));
    await assert.rejects(f.videos.poll(randomUUID()), errorCode('video_task_missing'));
  } finally { await f.close(); }
});
test('真实HTTP读取沿用原授权，拒绝页面提供URL/替换绑定和撤销后的结果', async () => {
  let handler, authorized = true, revokeOnRead = false;
  const f = await fixture({ beforeReply() { if (revokeOnRead) authorized = false; } });
  const server = createServer(async (request, response) => { if (!await handler(request, response)) { response.writeHead(404); response.end(); } });
  const origin = await listen(server);
  handler = createGenerationHTTPHandler({ origin, gateway: f.gateway, tasks: f.tasks, videos: f.videos, models: f.models,
    authorize() { if (!authorized) throw new StorageError('authorization_denied', 'synthetic', 401); } });
  const command = async value => {
    const response = await fetch(origin + '/__guan-local/generation', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Guan-Generation-Protocol': GENERATION_PROTOCOL }, body: JSON.stringify(value) });
    const reply = await response.json(); if (!response.ok) throw new StorageError(reply.error.code, reply.error.message, response.status); return reply;
  };
  const client = createGenerationClient({ command });
  try {
    const binding = (await f.bind()).binding; f.json({ data: [{ id: 'm' }] }); assert.deepEqual(await client.models(binding), ['m']);
    const job = await f.track(); f.json({ id: job.remoteId, status: 'in_progress' }); assert.equal((await client.videoPoll(job.id)).status, 'pending');
    for (const extra of [{ url: 'https://example.com' }, { binding }, { remoteId: 'other' }])
      await assert.rejects(command({ operation: 'video-download', id: job.id, ...extra }), errorCode('generation_command_denied'));
    f.json({ data: [{ id: 'm' }] }); revokeOnRead = true;
    await assert.rejects(client.models(binding), errorCode('authorization_denied')); revokeOnRead = false;
    authorized = false; await assert.rejects(client.videoDownload(job.id), errorCode('authorization_denied'));
  } finally { await closeServer(server); await f.close(); }
});
test('前端视频只取原记录，校验身份和文件摘要；取消/失败/超时不创建任务', async () => {
  const record = { id: randomUUID(), productId: 'p', nodeId: 'n', remoteId: 'video_123' };
  let polls = 0, downloads = 0, mode = 'pending';
  const media = { contentType: 'video/mp4', bytes: mp4.toString('base64'), size: mp4.length, hash: createHash('sha256').update(mp4).digest('hex') };
  const host = { async videoPoll(id) { polls++; assert.equal(id, record.id); return { ...record, status: mode === 'pending' ? polls > 1 ? 'completed' : 'pending' : mode === 'failed' ? 'failed' : 'completed', ...(mode === 'scope' ? { nodeId: 'other' } : {}) }; },
    async videoDownload(id) { downloads++; assert.equal(id, record.id); return { ...record, status: 'completed', media: { ...media, ...(mode === 'hash' ? { hash: 'a'.repeat(64) } : {}) } }; } };
  const result = await waitForProtectedVideo({ host, record, interval: 1 }); assert.equal(result.blob.size, mp4.length); assert.equal(downloads, 1);
  mode = 'scope'; await assert.rejects(waitForProtectedVideo({ host, record }), errorCode('video_scope_mismatch'));
  mode = 'hash'; await assert.rejects(waitForProtectedVideo({ host, record }), errorCode('video_media_invalid'));
  mode = 'failed'; await assert.rejects(waitForProtectedVideo({ host, record }), error => error.name === 'VideoTaskFailed');
  const controller = new AbortController(); controller.abort(); const before = polls;
  await assert.rejects(waitForProtectedVideo({ host, record, signal: controller.signal })); assert.equal(polls, before);
  await assert.rejects(waitForProtectedVideo({ host, record, attempts: 0 }), /原任务ID已保留/);
});
