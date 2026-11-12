import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openWorkspace } from '../扩展功能/本机存储/SQLite工作区.mjs';
import { RETENTION_DAY } from '../扩展功能/本机存储/存储保留策略.mjs';
import { createStorageMaintenance } from '../扩展功能/本机服务/存储整理服务.mjs';
import { createWriteCoordinator } from '../扩展功能/本机服务/写入协调.mjs';
import { persistResponseMedia, readResponseMedia } from '../扩展功能/生成任务/响应图片共用存储.mjs';
import { startDataService } from '../扩展功能/本机服务/数据服务.mjs';
import { createDataClient } from '../扩展功能/本机存储/浏览器适配.mjs';
import { createGenerationClient } from '../扩展功能/生成任务/生成任务客户端.mjs';
import { GENERATION_PROTOCOL } from '../扩展功能/生成网关/生成协议.mjs';
import { generationFixture } from './生成网关隔离夹具.mjs';
const hash = value => createHash('sha256').update(value).digest('hex');
const missing = (workspace, id) => { try { workspace.readMedia(id); return false; } catch (error) { if (error.code !== 'media_not_found') throw error; return true; } };
async function workspaceTest(t, operation) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-11T12:00:00Z').getTime() });
  const root = mkdtempSync(join(tmpdir(), 'guan-retention-')), workspace = openWorkspace({ dataRoot: root, initialize: true });
  const coordinator = createWriteCoordinator(), maintenance = createStorageMaintenance({ workspace, runWrite: operation => coordinator.runWrite(operation) });
  const write = (id, value, mediaIds = []) => workspace.writeDocument({ collection: 'extension', id, value, mediaIds,
    expectedRevision: workspace.readDocument('extension', id)?.revision || 0, operationId: randomUUID() });
  try { await operation({ workspace, maintenance, write, tick: milliseconds => t.mock.timers.tick(milliseconds) }); }
  finally { await coordinator.close(); workspace.close(); rmSync(root, { recursive: true, force: true }); t.mock.timers.reset(); }
}
test('旧文件首次确认闲置起算90天；有引用媒体不会过期', t => workspaceTest(t, async f => {
  const idle = f.workspace.writeMedia(Buffer.from('idle'), 'image/png'), used = f.workspace.writeMedia(Buffer.from('used'), 'image/png');
  f.write('active', { title: '保留画布' }, [used.id]);
  assert.equal(f.workspace.storageRetention.preview().media, 0);
  f.tick(89 * RETENTION_DAY);
  assert.equal(f.workspace.storageRetention.preview().media, 0);
  f.tick(RETENTION_DAY);
  const plan = f.workspace.storageRetention.preview();
  assert.equal(plan.media, 1);
  const result = f.workspace.storageRetention.execute(plan.id);
  assert.equal(result.media, 1); assert.equal(missing(f.workspace, idle.id), true); assert.equal(missing(f.workspace, used.id), false);
}));
test('重新引用重置闲置时间，预览后的编辑使删除停止', t => workspaceTest(t, async f => {
  const media = f.workspace.writeMedia(Buffer.from('shared'), 'image/png');
  f.workspace.storageRetention.preview(); f.tick(91 * RETENTION_DAY);
  const old = f.workspace.storageRetention.preview();
  f.write('restored', {}, [media.id]);
  assert.throws(() => f.workspace.storageRetention.execute(old.id), { code: 'cleanup_preview_changed' });
  f.workspace.storageRetention.preview();
  f.write('restored', {}, []); f.workspace.storageRetention.preview();
  assert.equal(f.workspace.storageRetention.preview().media, 0);
  assert.equal(missing(f.workspace, media.id), false);
}));
test('关闭重开保留闲置起点、自动开关与近期上传保护', t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-11T12:00:00Z') });
  const root = mkdtempSync(join(tmpdir(), 'guan-retention-cold-'));
  let workspace = openWorkspace({ dataRoot: root, initialize: true });
  try {
    const media = workspace.writeMedia(Buffer.from('cold-file'), 'image/png');
    workspace.storageRetention.configure({ enabled: false, days: 90 });
    workspace.close(); t.mock.timers.tick(1000);
    workspace = openWorkspace({ dataRoot: root });
    assert.deepEqual(workspace.storageRetention.status().policy, { enabled: false, days: 90 });
    assert.equal(workspace.storageRetention.preview({ mode: 'organize' }).media, 0);
    workspace.close(); t.mock.timers.tick(91 * RETENTION_DAY);
    workspace = openWorkspace({ dataRoot: root });
    const plan = workspace.storageRetention.preview();
    assert.equal(plan.media, 1);
    workspace.storageRetention.execute(plan.id);
    assert.equal(missing(workspace, media.id), true);
  } finally { workspace.close(); rmSync(root, { recursive: true, force: true }); t.mock.timers.reset(); }
});
test('任务清理中断后的已到期媒体可继续回收；重新使用的同一文件保留', t => workspaceTest(t, async f => {
  const raw = f.workspace.writeMedia(Buffer.from('expired-response'), 'application/octet-stream');
  f.write('ledger-like', {}, [raw.id]); f.tick(16_000);
  f.workspace.storageRetention.retireMedia([raw.id]);
  assert.equal(f.workspace.storageRetention.preview().media, 0);
  f.write('ledger-like', {}, []);
  assert.equal(f.workspace.storageRetention.preview().media, 1);
  f.workspace.writeMedia(Buffer.from('expired-response'), 'application/octet-stream');
  assert.equal(f.workspace.storageRetention.preview().media, 0);
}));
test('存量整理不绕过近期上传保护；新引用和其他保留文件保持可读', t => workspaceTest(t, async f => {
  const media = f.workspace.writeMedia(Buffer.from('recent'), 'image/png');
  assert.equal(f.workspace.storageRetention.preview({ mode: 'organize' }).media, 0);
  f.tick(16_000);
  const plan = f.workspace.storageRetention.preview({ mode: 'organize' });
  assert.equal(plan.media, 1); f.write('keep', {}, [media.id]);
  assert.throws(() => f.workspace.storageRetention.execute(plan.id), { code: 'cleanup_preview_changed' });
  assert.equal(missing(f.workspace, media.id), false);
}));
test('旧分片只删除不可达内容；有效根的旧版存储图保留', t => workspaceTest(t, async f => {
  const first = { format: 'guan-app-fragment.v1', kind: 'json', data: ['保留数据'] };
  const second = { format: 'guan-app-fragment.v1', kind: 'json', data: ['已替代内容'] };
  const live = 'app-part-' + hash(JSON.stringify(first)), old = 'app-part-' + hash(JSON.stringify(second));
  f.write(live, first); f.write(old, second);
  f.write('legacy-root', { format: 'guan-app-storage.v2', head: { id: live } });
  const plan = f.workspace.storageRetention.preview({ mode: 'organize' });
  assert.equal(plan.fragments, 1);
  f.workspace.storageRetention.execute(plan.id);
  assert.ok(f.workspace.readDocument('extension', live)); assert.equal(f.workspace.readDocument('extension', old), null);
}));
test('缺失引用或预览过期不会把损坏数据当空库，也不执行删除', t => workspaceTest(t, async f => {
  const media = f.workspace.writeMedia(Buffer.from('keep-on-error'), 'image/png');
  f.tick(16_000); const plan = f.workspace.storageRetention.preview({ mode: 'organize' });
  f.tick(11 * 60_000);
  assert.throws(() => f.workspace.storageRetention.execute(plan.id), { code: 'cleanup_preview_expired' });
  f.write('broken', { head: { id: 'app-part-' + '0'.repeat(64) } });
  assert.throws(() => f.workspace.storageRetention.preview(), { code: 'retention_reference_invalid' });
  assert.equal(missing(f.workspace, media.id), false);
}));
test('设置可持久保存、非法天数拒绝；关闭自动清理后旧预览不能执行', t => workspaceTest(t, async f => {
  assert.deepEqual(f.workspace.storageRetention.status().policy, { enabled: true, days: 90 });
  await f.maintenance.command({ operation: 'configure', policy: { enabled: true, days: 180 } });
  assert.equal((await f.maintenance.command({ operation: 'status' })).policy.days, 180);
  await assert.rejects(f.maintenance.command({ operation: 'configure', policy: { enabled: true, days: 0 } }));
  const plan = await f.maintenance.command({ operation: 'preview', automatic: true });
  await f.maintenance.command({ operation: 'configure', policy: { enabled: false, days: 180 } });
  await assert.rejects(f.maintenance.command({ operation: 'execute', id: plan.id }), { code: 'cleanup_disabled' });
}));
test('整理服务仅执行已预览候选，任务释放后不把并发新增闲置文件混入删除', t => workspaceTest(t, async f => {
  const media = f.workspace.writeMedia(Buffer.from('approved'), 'image/png'); f.tick(16_000);
  const plan = await f.maintenance.command({ operation: 'preview', mode: 'organize' });
  const later = f.workspace.writeMedia(Buffer.from('later'), 'image/png'); f.tick(16_000);
  const result = await f.maintenance.command({ operation: 'execute', id: plan.id });
  assert.equal(result.media, 1); assert.equal(result.bytes, 8); assert.equal(missing(f.workspace, media.id), true); assert.equal(missing(f.workspace, later.id), false);
}));
test('图片响应按内容共用原图，完整往返保持原始响应字节与空白', t => workspaceTest(t, async f => {
  const image = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(4096, 5)]);
  const bytes = Buffer.from('{\n "data": [{"b64_json": "' + image.toString('base64') + '"}], "note":"保留原文"\n}');
  const result = persistResponseMedia(f.workspace, bytes);
  assert.equal(result.encoding, 'image-references-v1');
  assert.ok(result.size < 1024);
  assert.deepEqual(readResponseMedia(f.workspace, result), bytes);
  assert.equal(f.workspace.writeMedia(image, 'image/png').id, result.mediaIds[0]);
  assert.equal(persistResponseMedia(f.workspace, bytes).id, result.id);
}));
test('真实生成客户端可交付共用图片响应，摘要核验与恢复都通过，未再次调用上游', async () => {
  const f = await generationFixture();
  try {
    const image = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(4096, 8)]);
    f.reply.bytes = Buffer.from(JSON.stringify({ data: [{ b64_json: image.toString('base64') }] }));
    const binding = await f.bind(), task = f.submit(binding.binding);
    await f.tasks.submit(task); await f.tasks.drain();
    const client = createGenerationClient({ command: async value => {
      const result = f.tasks.result(value.id); return { protocol: GENERATION_PROTOCOL, result: { ...result, bytes: result.bytes.toString('base64') } };
    } });
    let applied = false;
    await client.deliver(task, { applyAndSave: async job => { applied = true; assert.deepEqual(Buffer.from(job.bytes, 'base64'), f.reply.bytes); return { deferred: true }; } });
    assert.equal(applied, true);
    await f.tasks.submit(task); assert.equal(f.requests.length, 1);
    assert.equal(f.tasks.result(task.id).result.id, hash(f.reply.bytes));
  } finally { await f.close(); }
});
test('任务响应到期仅释放已确认保存的结果，保留恢复任务、任务摘要与幂等识别', async () => {
  const f = await generationFixture();
  try {
    const b = await f.bind(), task = f.submit(b.binding);
    await f.tasks.submit(task); await f.tasks.drain();
    const job = f.tasks.get(task.id); await f.tasks.confirmApplied(task.id, f.saveCanvas(job));
    const pending = f.submit(b.binding, { nodeId: 'waiting' }); await f.tasks.submit(pending); await f.tasks.drain();
    const cutoff = Date.now(), preview = f.tasks.retentionPreview(cutoff);
    assert.deepEqual(preview.ids, [task.id]);
    const expired = await f.tasks.expireAppliedResults({ cutoff, signature: preview.signature });
    assert.equal(expired.tasks, 1); assert.equal(f.tasks.get(task.id).result.id, job.result.id);
    assert.equal(f.tasks.get(task.id).applied, true);
    const client = createGenerationClient({ command: async value => ({ protocol: GENERATION_PROTOCOL, result: f.tasks.get(value.id) }) });
    assert.equal((await client.confirmSaved(task, { responseHash: job.result.id })).applied, true);
    assert.throws(() => f.tasks.result(task.id), { code: 'generation_result_expired' });
    assert.ok(f.tasks.result(pending.id).bytes.length);
    await f.tasks.submit(task); assert.equal(f.requests.length, 2);
    assert.deepEqual(f.tasks.retentionPreview(cutoff).ids, []);
  } finally { await f.close(); }
});
test('真实HTTP整理接口保留Origin与CSRF校验，预览不删除，执行返回真实清理记录', t => workspaceTest(t, async f => {
  const origin = 'http://localhost:49121', service = await startDataService({ workspace: f.workspace, allowedOrigins: [origin], rateLimit: 0 });
  try {
    const session = service.issueSession(origin), url = `${service.url}/v1/workspaces/${f.workspace.workspaceId}/storage-maintenance`;
    const denied = await fetch(url, { method: 'POST', headers: { Origin: origin, Authorization: 'Bearer ' + session.token, 'Content-Type': 'application/json' }, body: '{"operation":"status"}' });
    assert.equal(denied.status, 403);
    const client = createDataClient({ url: service.url, session, fetchImpl: (url, options) => fetch(url, { ...options, headers: { ...options.headers, Origin: origin } }) });
    const media = f.workspace.writeMedia(Buffer.from('orphan-http'), 'image/png'); f.tick(16_000);
    const plan = await client.storageMaintenance({ operation: 'preview', mode: 'organize' });
    assert.equal(plan.media, 1); assert.equal(missing(f.workspace, media.id), false);
    assert.equal(plan.mediaBytes, Buffer.byteLength('orphan-http'));
    assert.equal(plan.bytes, plan.fragmentBytes + plan.mediaBytes + plan.taskBytes);
    const result = await client.storageMaintenance({ operation: 'execute', id: plan.id });
    assert.equal(result.media, 1); assert.equal(missing(f.workspace, media.id), true);
    assert.equal((await client.storageMaintenance({ operation: 'status' })).lastRun.media, 1);
    client.close();
  } finally { await service.close(); }
}));
test('整理后可单独收回数据库内部空闲空间，保留文件逐字节可读', t => workspaceTest(t, async f => {
  const media = f.workspace.writeMedia(Buffer.alloc(2 * 1024 ** 2, 7), 'image/png');
  const keep = f.workspace.writeMedia(Buffer.from('keep-after-compaction'), 'image/png');
  f.write('active', {}, [keep.id]); f.tick(16_000);
  const preview = await f.maintenance.command({ operation: 'preview', mode: 'organize' });
  await f.maintenance.command({ operation: 'execute', id: preview.id });
  assert.equal(missing(f.workspace, media.id), true);
  assert.ok((await f.maintenance.command({ operation: 'status' })).reusableBytes >= 1024 ** 2);
  const result = await f.maintenance.command({ operation: 'compact' });
  assert.ok(result.bytes >= 1024 ** 2);
  assert.equal(f.workspace.readMedia(keep.id).bytes.toString(), 'keep-after-compaction');
}));
