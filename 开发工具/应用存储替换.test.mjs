import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { openWorkspace, restoreBackup } from '../扩展功能/本机存储/SQLite工作区.mjs';
import { startDataService } from '../扩展功能/本机服务/数据服务.mjs';
import { createDataClient } from '../扩展功能/本机存储/浏览器适配.mjs';
import { createApplicationStorage } from '../扩展功能/本机存储/应用存储适配.mjs';

const roots = [], origin = 'http://localhost:43201';
const code = value => error => error.code === value;
async function fixture(options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'guan-stage6-app-')); roots.push(root);
  const workspace = openWorkspace({ dataRoot: root, initialize: true });
  const service = await startDataService({ workspace, allowedOrigins: [origin], rateLimit: 1000 });
  const fetchImpl = (url, init) => fetch(url, { ...init, headers: { ...init.headers, Origin: origin } });
  const client = createDataClient({ url: service.url, session: service.issueSession(origin), fetchImpl });
  const app = createApplicationStorage({ client, ...options });
  return { root, workspace, service, client, app, async close() { await service.close(); client.close(); workspace.close(); } };
}
const store = (app, storeName = 'app_state') => app.createInstance({ storeName });

test('真实SQLite保存、重开、迭代提前返回，命名空间不会串数据', async () => {
  const f = await fixture();
  try {
    const a = store(f.app), b = store(f.app, 'prompt_cache');
    assert.equal(await a.getItem('missing'), null);
    assert.equal(f.client.getStatus().state, 'idle', '正常缺项不是读取失败');
    await a.setItem('one', { title: '合成画布', unknown: { retained: true } });
    await b.setItem('one', { title: '缓存' });
    await a.setItem('two', [1, null, undefined, new Date('2026-01-01T00:00:00Z')]);
    assert.deepEqual(await a.keys(), ['one', 'two']); assert.equal(await a.length(), 2);
    assert.equal(await a.iterate((value, key, index) => key === 'one' ? index : undefined), 1);
    const reopened = createApplicationStorage({ client: f.client });
    assert.equal((await store(reopened).getItem('one')).unknown.retained, true);
    assert.equal((await store(reopened, 'prompt_cache').getItem('one')).title, '缓存');
    assert.deepEqual(await store(reopened).getItem('two'), [1, null, undefined, new Date('2026-01-01T00:00:00Z')]);
    assert.equal((await f.app.flush()).state, 'saved');
    const usage = await f.client.readUsage();
    assert.equal(usage.quota, null); assert.ok(usage.usage > 0);
    // /usage已按业务类别统计，app_state归入画布与应用配置。
    assert.equal(usage.databases[0].stores.find(row => row.name === 'workspace').records, 2);
    assert.equal(JSON.stringify(usage).includes(f.root), false);
  } finally { await f.close(); }
});

test('同一命名空间并行写按顺序提交，调用后原地修改不漂移', async () => {
  const f = await fixture();
  try {
    const a = store(f.app), value = { title: '最初快照' };
    const first = a.setItem('one', value); value.title = '调用后修改';
    await Promise.all([first, a.setItem('two', '第二项'), a.setItem('three', '第三项')]);
    assert.equal((await a.getItem('one')).title, '最初快照');
    assert.equal(await a.length(), 3); await f.app.flush();
  } finally { await f.close(); }
});

test('单体与批量媒体请求超时会中止底层请求，释放等待状态并允许后续上传', async () => {
  const f = await fixture();
  const hangingPaths = new Set(['/media', '/media/batch']), hangingBodyPaths = new Set(), aborts = new Map(), bodyAborts = new Map();
  const waitForAbort = (signal, counts, endpoint) => new Promise((resolve, reject) => {
    const abort = () => {
      counts.set(endpoint, (counts.get(endpoint) ?? 0) + 1);
      reject(signal.reason);
    };
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
  const client = createDataClient({
    url: f.service.url,
    session: f.service.issueSession(origin),
    mediaRequestTimeoutMs: 25,
    async fetchImpl(url, init) {
      const pathname = new URL(url).pathname;
      const endpoint = pathname.endsWith('/media/batch') ? '/media/batch' : pathname.endsWith('/media') ? '/media' : null;
      if (endpoint && hangingPaths.delete(endpoint)) {
        return waitForAbort(init.signal, aborts, endpoint);
      }
      const response = await fetch(url, { ...init, headers: { ...init.headers, Origin: origin } });
      if (endpoint && hangingBodyPaths.delete(endpoint)) {
        return {
          ok: response.ok,
          status: response.status,
          json: () => waitForAbort(init.signal, bodyAborts, endpoint),
        };
      }
      return response;
    },
  });
  try {
    const blob = new Blob(['超时后仍可安全重试的合成图片'], { type: 'image/png' });
    await assert.rejects(client.writeMedia(blob), error => error.code === 'request_timeout' && error.status === 504);
    assert.equal(aborts.get('/media'), 1, '媒体请求的AbortSignal必须真正触发');
    assert.equal(client.getStatus().pending, 0, '超时请求必须退出活动请求计数');
    assert.equal(client.getStatus().errors[0]?.code, 'request_timeout');
    const media = await client.writeMedia(blob);
    assert.equal(media.size, blob.size, '新请求在前一笔超时后可成功上传');
    assert.equal(client.getStatus().pending, 0);
    assert.equal(client.getStatus().errors.length, 0, '成功重试清除对应失败状态');

    hangingBodyPaths.add('/media');
    await assert.rejects(client.writeMedia(blob), error => error.code === 'request_timeout' && error.status === 504);
    assert.equal(bodyAborts.get('/media'), 1, '响应体读取同样必须受截止时间和AbortSignal保护');
    assert.equal(client.getStatus().pending, 0);
    assert.equal((await client.writeMedia(blob)).size, blob.size, '响应体超时后相同媒体可重新上传并取得回执');

    await assert.rejects(client.writeMediaBatch([{ blob }]), error => error.code === 'request_timeout' && error.status === 504);
    assert.equal(aborts.get('/media/batch'), 1, '批量媒体请求同样必须中止');
    assert.equal(client.getStatus().pending, 0);
    const batch = await client.writeMediaBatch([{ blob }]);
    assert.equal(batch.length, 1);
    assert.equal(batch[0].size, blob.size);
    assert.equal(client.getStatus().errors.length, 0);
  } finally { client.close(); await f.close(); }
});

test('嵌套Blob、空Blob、ArrayBuffer、临时URL重新生成，不保存失效URL', async () => {
  const f = await fixture({ readBlobUrl: async () => new Blob(['transient-picture'], { type: 'image/png' }) });
  try {
    const a = store(f.app, 'image_previews');
    await a.setItem('image:one', { version: 1, blob: new Blob(['synthetic-picture'], { type: 'image/webp' }), empty: new Blob([]), buffer: new Uint8Array([1, 2, 3]).buffer, url: 'blob:synthetic-old-url' });
    const value = await a.getItem('image:one');
    assert.equal(await value.blob.text(), 'synthetic-picture'); assert.equal(value.blob.type, 'image/webp');
    assert.equal(value.empty.size, 0); assert.deepEqual([...new Uint8Array(value.buffer)], [1, 2, 3]);
    assert.equal(await (await fetch(value.url)).text(), 'transient-picture');
    const doc = f.workspace.readDocument('extension', f.workspace.listDocuments('extension')[0].id);
    assert.equal(JSON.stringify(doc.value).includes('blob:synthetic-old-url'), false);
    assert.equal(doc.mediaIds.length, 3); f.app.close();
    await assert.rejects(fetch(value.url));
  } finally { await f.close(); }
});

test('超过原32MiB上限的视频以单个SQLite媒体BLOB保存和读取', async () => {
  const f = await fixture();
  try {
    const a = store(f.app, 'media_files'), bytes = new Uint8Array(33 * 1024 * 1024 + 7); bytes[bytes.length - 1] = 92;
    await a.setItem('video:large', new Blob([bytes], { type: 'video/mp4' }));
    const blob = await a.getItem('video:large');
    assert.equal(blob.type, 'video/mp4'); assert.equal(blob.size, bytes.length);
    assert.equal(new Uint8Array(await blob.slice(-1).arrayBuffer())[0], 92);
    const document = f.workspace.readDocument('extension', f.workspace.listDocuments('extension')[0].id);
    assert.equal(document.mediaIds.length, 1, '单个视频保持一个完整媒体标识');
    assert.equal(f.workspace.readMedia(document.mediaIds[0]).bytes.length, bytes.length);
  } finally { await f.close(); }
});

test('实际画布JSON中的临时图片：缺读取端口拒绝，有端口后保存引用并重开恢复', async () => {
  const key = 'infinite-canvas:canvas_store', originalURL = URL.createObjectURL(new Blob(['synthetic-canvas-picture'], { type: 'image/png' }));
  const value = JSON.stringify({ state: { projects: [{ id: 'synthetic', nodes: [{ type: 'image', metadata: { content: originalURL, storageKey: 'image:synthetic' } }] }] }, version: 0 });
  const missing = await fixture(), supplied = await fixture({ readBlobUrl: async url => (await fetch(url)).blob() });
  try {
    await assert.rejects(store(missing.app).setItem(key, value), code('transient_url_unresolved'));
    assert.equal(missing.workspace.listDocuments('extension').length, 0, '不能只因界面有图片就声称画布已保存');
    await store(supplied.app).setItem(key, value); await supplied.app.flush();
    const doc = supplied.workspace.readDocument('extension', supplied.workspace.listDocuments('extension')[0].id);
    assert.equal(doc.mediaIds.length, 1); assert.equal(JSON.stringify(doc.value).includes(originalURL), false);
    URL.revokeObjectURL(originalURL);
    const reopened = createApplicationStorage({ client: supplied.client });
    try {
      const node = JSON.parse(await store(reopened).getItem(key)).state.projects[0].nodes[0];
      assert.equal(node.metadata.storageKey, 'image:synthetic'); assert.notEqual(node.metadata.content, originalURL);
      assert.equal(await (await fetch(node.metadata.content)).text(), 'synthetic-canvas-picture');
      await reopened.flush();
    } finally { reopened.close(); }
  } finally { URL.revokeObjectURL(originalURL); supplied.app.close(); await missing.close(); await supplied.close(); }
});

test('remove和clear原子更新命名空间，但不物理销毁共享媒体', async () => {
  const f = await fixture();
  try {
    const a = store(f.app, 'image_files'), b = store(f.app, 'media_files');
    const value = new Blob(['same-content']);
    await a.setItem('a', value); await a.setItem('b', value); await b.setItem('a', value);
    await a.removeItem('a'); assert.equal(await a.getItem('a'), null); assert.equal(await a.length(), 1);
    await a.clear(); assert.equal(await a.length(), 0);
    assert.equal(await (await b.getItem('a')).text(), 'same-content');
    assert.equal(readdirSync(join(f.root, '媒体')).length, 0, '共享媒体仍保存在SQLite BLOB中，没有外置文件副本');
    assert.equal(f.workspace.readUsage().databases[0].stores.find(row => row.name === 'media_blobs').records, 1);
  } finally { await f.close(); }
});

test('丢失ACK后拒绝后续写，显式同操作重试不重复提交', async () => {
  const f = await fixture();
  try {
    let lose = true;
    const wrapper = { readDocument: (...args) => f.client.readDocument(...args), writeMedia: (...args) => f.client.writeMedia(...args), readMedia: (...args) => f.client.readMedia(...args), async writeDocument(input) { const ack = await f.client.writeDocument(input); if (lose) { lose = false; throw Error('synthetic lost ACK'); } return ack; } };
    const app = createApplicationStorage({ client: wrapper }), a = store(app);
    await assert.rejects(a.setItem('one', '已落盘但响应丢失'));
    await assert.rejects(a.setItem('two', '不能越过未确认操作'), code('pending_write_unresolved'));
    await assert.rejects(app.flush(), code('save_not_confirmed'));
    assert.throws(() => app.close(), code('save_not_confirmed'));
    await app.retry('app_state'); assert.equal(await a.getItem('one'), '已落盘但响应丢失');
    assert.equal(f.workspace.readDocument('extension', f.workspace.listDocuments('extension')[0].id).revision, 1);
    await a.setItem('two', '重试后可继续'); await app.flush();
  } finally { await f.close(); }
});

test('多窗口冲突不覆盖；断线、坏响应及失败读取不伪装成空库', async () => {
  const f = await fixture();
  try {
    const other = createApplicationStorage({ client: f.client }), a = store(f.app), b = store(other);
    assert.equal(await a.getItem('x'), null); assert.equal(await b.getItem('x'), null);
    await a.setItem('x', 'A的版本');
    await assert.rejects(b.setItem('x', 'B不能覆盖'), code('revision_conflict'));
    const fresh = createApplicationStorage({ client: f.client }); assert.equal(await store(fresh).getItem('x'), 'A的版本');
    const offline = createApplicationStorage({ client: { async readDocument() { throw Error('offline'); } } });
    await assert.rejects(store(offline).getItem('x')); await assert.rejects(offline.flush(), code('save_not_confirmed'));
    const bad = createApplicationStorage({ client: { async readDocument() { return { value: {}, revision: 1 }; } } });
    await assert.rejects(store(bad).getItem('x'), code('invalid_namespace'));
  } finally { await f.close(); }
});

test('配置JSON内的凭据必须使用显式安全端口，不明文入库、不丢字段', async () => {
  const f = await fixture();
  try {
    const key = 'infinite-canvas:ai_config_store', value = JSON.stringify({ state: { config: { channels: [{ apiKey: 'synthetic-not-real', name: '测试渠道' }], apiKey: '' }, webdav: { password: '' } }, version: 0 });
    await assert.rejects(store(f.app).setItem(key, value), code('secret_port_required'));
    await assert.rejects(store(f.app, 'preferences').setItem('canvas-agent-token', 'synthetic-token'), code('secret_port_required'));
    assert.equal(f.workspace.listDocuments('extension').length, 0);
    const secrets = new Map();
    const secretPort = { async store(secret) { const ref = 'secret:' + createHash('sha256').update(secret).digest('hex'); secrets.set(ref, secret); return ref; }, async inspect(ref) { return secrets.has(ref) ? 'guan-vault:' + ref : undefined; } };
    // 仅测试用内存凭据端口，不冒充Keychain或已交付的生产密钥网关。
    const app = createApplicationStorage({ client: f.client, secretPort });
    await store(app).setItem(key, value);
    const expected = JSON.parse(value); expected.state.config.channels[0].apiKey = 'guan-vault:secret:' + createHash('sha256').update('synthetic-not-real').digest('hex');
    assert.deepEqual(JSON.parse(await store(app).getItem(key)), expected);
    const doc = f.workspace.readDocument('extension', f.workspace.listDocuments('extension')[0].id);
    assert.equal(JSON.stringify(doc.value).includes('synthetic-not-real'), false);
    const noVault = createApplicationStorage({ client: f.client });
    await assert.rejects(store(noVault).getItem(key), code('secret_port_required'));
    secrets.clear();
    const fresh = createApplicationStorage({ client: f.client, secretPort });
    await assert.rejects(store(fresh).getItem(key), code('secret_not_found'));
  } finally { await f.close(); }
});

test('对象特殊键不污染原型，未知字段保留；循环和插件拒绝，32MiB以上数据可保存', async () => {
  const f = await fixture();
  try {
    const a = store(f.app);
    await a.setItem('object', JSON.parse('{"__proto__":{"polluted":true},"futureField":42}'));
    const value = await a.getItem('object'); assert.equal(Object.getPrototypeOf(value), Object.prototype); assert.equal(Object.hasOwn(value, '__proto__'), true); assert.equal({}.polluted, undefined);
    assert.equal(value.futureField, 42);
    const circular = {}; circular.self = circular;
    await assert.rejects(a.setItem('cycle', circular), code('invalid_value'));
    const large = 'x'.repeat(3 * 1024 * 1024);
    await a.setItem('large', large);
    assert.equal(await store(createApplicationStorage({ client: f.client })).getItem('large'), large);
    assert.throws(() => f.app.createInstance({ name: 'infinite-canvas-plugins', storeName: 'arbitrary' }), code('namespace_denied'));
    const overLimit = 'x'.repeat(32 * 1024 * 1024 + 1);
    await a.setItem('over-limit', overLimit);
    assert.equal((await store(createApplicationStorage({ client: f.client })).getItem('over-limit')), overLimit);
  } finally { await f.close(); }
});

test('SQLite完整备份恢复包括命名空间、Blob及删除结果', async () => {
  const f = await fixture();
  try {
    const a = store(f.app), media = store(f.app, 'image_files');
    await a.setItem('kept', { title: '保留项' }); await a.setItem('removed', '即将移除'); await a.removeItem('removed');
    await media.setItem('image:one', new Blob(['backup-picture'], { type: 'image/png' }));
    const backup = await f.workspace.createBackup(), target = join(mkdtempSync(join(tmpdir(), 'guan-stage6-app-restore-')), '恢复');
    roots.push(target); restoreBackup({ backupRoot: backup.path, targetRoot: target });
    const restored = openWorkspace({ dataRoot: target });
    try {
      assert.equal(restored.workspaceId, f.workspace.workspaceId);
      assert.equal(restored.listDocuments('extension').length, 2);
      const values = restored.listDocuments('extension').map(row => restored.readDocument('extension', row.id));
      assert.equal(JSON.stringify(values).includes('保留项'), true); assert.equal(JSON.stringify(values).includes('即将移除'), false);
      assert.equal(Buffer.from(restored.readMedia(values.flatMap(row => row.mediaIds)[0]).bytes).toString(), 'backup-picture');
      assert.equal(readFileSync(join(backup.path, '清单.json'), 'utf8').includes('token'), false);
    } finally { restored.close(); }
  } finally { await f.close(); }
});

test.after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });
