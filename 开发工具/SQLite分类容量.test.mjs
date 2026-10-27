import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, lstatSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { 根目录 } from './公共.mjs';
import { openWorkspace } from '../扩展功能/本机存储/SQLite工作区.mjs';
import { startDataService } from '../扩展功能/本机服务/数据服务.mjs';
import { createApplicationStorage } from '../扩展功能/本机存储/应用存储适配.mjs';
import { createShardedApplicationStorage } from '../扩展功能/本机存储/分片应用存储.mjs';
import { readCategorizedUsage } from '../扩展功能/本机存储/分类容量统计.mjs';
import { buildFragmentPlan } from '../扩展功能/本机存储/分片值编码.mjs';

// 日常开发验收当前唯一维护来源；旧冻结候选及其布局指纹不再充当存储测试前置。
const candidate = { openWorkspace, startDataService };
const sha = value => createHash('sha256').update(value).digest('hex'), code = value => error => error.code === value;
const category = (usage, name) => usage.databases[0].stores.find(row => row.name === name);
const idFor = namespace => 'app-' + sha(namespace);
const roots = [];
test.after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'guan-usage-')); roots.push(root);
  const workspace = candidate.openWorkspace({ dataRoot: root, initialize: true });
  const client = {
    readDocument: (...args) => workspace.readDocument(...args), writeDocument: input => workspace.writeDocument(input),
    async writeMedia(blob) { return workspace.writeMedia(Buffer.from(await blob.arrayBuffer()), blob.type); },
    readMedia: id => workspace.readMedia(id), readUsage: () => workspace.readDetailedUsage(),
  };
  const apps = [];
  return { root, workspace, client, app(sharded = true, options = {}) { const app = (sharded ? createShardedApplicationStorage : createApplicationStorage)({ client, ...options }); apps.push(app); return app; },
    close() { for (const app of apps) app.close(); workspace.close(); } };
}
async function using(fn) { const f = fixture(); try { await fn(f); } finally { f.close(); } }
const put = (f, collection, id, value, mediaIds = []) => f.workspace.writeDocument({ collection, id, value, mediaIds, expectedRevision: f.workspace.readDocument(collection, id)?.revision ?? 0, operationId: randomUUID() });
function rawEdit(f, fn) { const db = new DatabaseSync(join(f.root, '工作台.sqlite')); try { fn(db); } finally { db.close(); } }
function sums(usage) {
  assert.equal(usage.databases[0].stores.reduce((sum, row) => sum + row.bytes, 0), usage.contentBytes);
  assert.equal(usage.breakdown.currentContentBytes + usage.breakdown.retainedContentBytes, usage.contentBytes);
  assert.equal(usage.usage, usage.breakdown.databaseBytes + usage.breakdown.mediaDiskBytes);
}

test('空库分类为零但SQLite实际占用非零；保留同步旧API，同次扫描复用', () => using(async f => {
  const first = f.workspace.readDetailedUsage(), second = f.workspace.readDetailedUsage();
  assert.equal(first, second);
  const usage = await first;
  assert.equal(usage.contentBytes, 0); assert.ok(usage.usage > 0); assert.equal(usage.quota, null);
  assert.ok(usage.databases[0].stores.every(row => row.records === 0 && row.files === 0 && row.bytes === 0));
  assert.equal(f.workspace.readUsage().quota, null);
  assert.notEqual(f.workspace.readDetailedUsage(), first); await f.workspace.readDetailedUsage(); sums(usage);
}));

test('v1全部八种namespace按逻辑记录统计，不把根文档数当记录数', () => using(async f => {
  const app = f.app(false);
  for (const storeName of ['app_state', 'preferences', 'image_files', 'image_previews', 'media_files', 'prompt_cache', 'image_generation_logs', 'video_generation_logs']) {
    const store = app.createInstance({ storeName }); await store.setItem('one', '甲'); await store.setItem('two', '乙');
  }
  const usage = await f.workspace.readDetailedUsage();
  assert.equal(category(usage, 'workspace').records, 4);
  for (const name of ['images', 'previews', 'media_index', 'prompts', 'image_logs', 'video_logs']) assert.equal(category(usage, name).records, 2);
  assert.equal(category(usage, 'history').blocks, 0); sums(usage);
}));

test('产品与Excel回收站按快照归类并带出图片、视频资产', () => using(async f => {
  const app = f.app(false);
  const canvas = {
    state: {
      projects: [],
      deletedProjects: [{ id: 'deleted-product', deletedAt: '2026-01-01', project: { id: 'deleted-product', title: '已删除产品', nodes: [{ id: 'image-node', metadata: { storageKey: 'image:recycled' } }], connections: [] } }],
      guanWorkbooks: {
        version: 1, activeByWorkbook: {}, contract: { schema: 'guan-workbench.v1', workspace: { activeProductSetId: null, activeProductId: null }, productSets: [], products: [] },
        recycledWorkbooks: [{ id: 'deleted-workbook', deletedAt: '2026-01-01', workbook: { id: 'deleted-workbook', source: { fileName: '已删除.xlsx', promptTemplates: [] }, productIds: [] }, products: [],
          projects: [{ id: 'deleted-workbook-product', title: '工作簿产品', nodes: [{ id: 'video-node', metadata: { storageKey: 'video:recycled' } }], connections: [] }], records: {}, activeProductId: null }],
      },
    },
  };
  await app.createInstance({ storeName: 'app_state' }).setItem('infinite-canvas:canvas_store', JSON.stringify(canvas));
  await app.createInstance({ storeName: 'image_files' }).setItem('image:recycled', new Blob(['recycled-image'], { type: 'image/png' }));
  await app.createInstance({ storeName: 'media_files' }).setItem('video:recycled', new Blob(['recycled-video'], { type: 'video/mp4' }));
  const usage = await f.workspace.readDetailedUsage();
  assert.equal(category(usage, 'product_recycle').records, 1);
  assert.equal(category(usage, 'product_recycle').mediaBytes, 14);
  assert.equal(category(usage, 'workbook_recycle').records, 1);
  assert.equal(category(usage, 'workbook_recycle').mediaBytes, 14);
  assert.equal(category(usage, 'images').mediaBytes, 0);
  assert.equal(category(usage, 'videos').mediaBytes, 0);
  sums(usage);
}));

test('v2反复保存只计当前两条业务记录，旧代与未发布分片单列', () => using(async f => {
  const store = f.app().createInstance({ storeName: 'prompt_cache' });
  await store.setItem('one', '第一版'); await store.setItem('two', '第二项'); await store.setItem('one', '修订');
  const orphan = await buildFragmentPlan([['never-published', { tree: ['string', '未发布'], mediaIds: [] }]]);
  for (const step of orphan.fragments.values()) put(f, 'extension', step.id, step.value);
  const usage = await f.workspace.readDetailedUsage();
  assert.equal(category(usage, 'prompts').records, 2); assert.ok(category(usage, 'history').blocks >= 3);
  assert.ok(category(usage, 'history').bytes > 0); assert.equal(category(usage, 'other').records, 0); sums(usage);
}));

test('同图多记录去重；图片与缩略图共享块只在共享内容计一次', () => using(async f => {
  const app = f.app(), images = app.createInstance({ storeName: 'image_files' }), previews = app.createInstance({ storeName: 'image_previews' });
  const blob = new Blob(['same-image-payload'], { type: 'image/png' });
  await images.setItem('a', blob); await images.setItem('b', blob); await previews.setItem('a', blob);
  const usage = await f.workspace.readDetailedUsage();
  assert.equal(category(usage, 'images').records, 2); assert.equal(category(usage, 'images').mediaBytes, 0);
  assert.equal(category(usage, 'previews').mediaBytes, 0);
  assert.equal(category(usage, 'shared').mediaBytes, blob.size); assert.equal(category(usage, 'shared').files, 1);
  assert.equal(usage.breakdown.indexedMediaBytes, blob.size); sums(usage);
}));

test('33MiB视频重复16MiB块去重，按描述MIME分类而不是octet-stream索引', () => using(async f => {
  const bytes = new Uint8Array(33 * 1024 * 1024 + 7); bytes[bytes.length - 1] = 92;
  await f.app().createInstance({ storeName: 'media_files' }).setItem('video', new Blob([bytes], { type: 'video/mp4' }));
  const usage = await f.workspace.readDetailedUsage(), video = category(usage, 'videos');
  assert.equal(video.files, 1); assert.equal(video.blocks, 2); assert.equal(video.mediaBytes, 17 * 1024 * 1024 + 7);
  assert.equal(category(usage, 'media_index').records, 1); assert.equal(category(usage, 'other_media').bytes, 0); sums(usage);
}));

test('音频、空Blob与无类型二进制保留独立分类', () => using(async f => {
  const store = f.app(false).createInstance({ storeName: 'media_files' });
  await store.setItem('audio', new Blob(['sound'], { type: 'audio/ogg' })); await store.setItem('binary', new Blob(['raw'])); await store.setItem('empty', new Blob([]));
  const usage = await f.workspace.readDetailedUsage();
  assert.equal(category(usage, 'audio').mediaBytes, 5); assert.equal(category(usage, 'audio').files, 1);
  assert.equal(category(usage, 'other_media').mediaBytes, 3); assert.equal(category(usage, 'other_media').files, 2); sums(usage);
}));

test('混合v1/v2读取且不解密secret，不输出标题、正文、引用或数据根', () => using(async f => {
  let reads = 0;
  await f.app(false, { secretPort: { async store() { return 'secret:' + 'a'.repeat(64); }, async inspect() { reads++; throw Error('统计不可解密'); } } }).createInstance({ storeName: 'preferences' }).setItem('config', { apiKey: 'synthetic-secret', title: 'private-unique-title' });
  await f.app().createInstance({ storeName: 'prompt_cache' }).setItem('cache', 'private-unique-prompt');
  const usage = await f.workspace.readDetailedUsage(), text = JSON.stringify(usage);
  assert.equal(reads, 0); assert.equal(category(usage, 'workspace').records, 1); assert.equal(category(usage, 'prompts').records, 1);
  for (const forbidden of [f.root, 'private-unique-title', 'private-unique-prompt', 'secret:synthetic', 'synthetic-secret']) assert.equal(text.includes(forbidden), false);
}));

for (const sharded of [false, true]) test(`${sharded ? 'v2分片' : 'v1整值'}配置含渠道绑定时正常统计，不访问凭据端口或输出引用`, () => using(async f => {
  const binding = 'provider:' + 'b'.repeat(64), privateKey = 'synthetic-channel-private-key';
  let credentialCalls = 0;
  const secretPort = {
    async store() { assert.fail('渠道凭据应绑定，不另存密钥'); },
    async inspect() { credentialCalls++; assert.fail('渠道绑定不解密旧凭据'); },
    async bindChannel() { credentialCalls++; return binding; },
    async describeChannel() { credentialCalls++; return { binding }; },
  };
  const store = f.app(sharded, { secretPort }).createInstance({ storeName: 'preferences' });
  await store.setItem('saved-config', { channels: [{ apiKey: privateKey, baseUrl: 'https://synthetic.example.invalid', apiFormat: 'openai' }] });
  const callsBefore = credentialCalls, documentsBefore = f.workspace.listDocuments('extension');
  const usage = await f.workspace.readDetailedUsage();
  assert.equal(category(usage, 'workspace').records, 1);
  assert.ok(category(usage, 'workspace').documentBytes > 0);
  assert.equal(usage.breakdown.indexedMediaBytes, 0);
  assert.equal(credentialCalls, callsBefore, '只读统计不得检查、解密或重新绑定凭据');
  assert.deepEqual(f.workspace.listDocuments('extension'), documentsBefore);
  for (const value of [binding, privateKey, 'synthetic.example.invalid', f.root]) assert.equal(JSON.stringify(usage).includes(value), false);
  sums(usage);
}));

test('损坏的渠道绑定和未知值标签仍拒绝，不当作零容量略过', () => using(async f => {
  for (const tree of [['provider', 'provider:bad'], ['provider', 'provider:' + 'G'.repeat(64)], ['provider', null], ['future-value', 'opaque']]) {
    put(f, 'extension', idFor('preferences'), { format: 'guan-app-storage.v1', namespace: 'preferences', entries: [['config', { tree, mediaIds: [] }]] });
    await assert.rejects(f.workspace.readDetailedUsage(), code('usage_invalid_data'));
  }
}));

test('直接画布及其媒体引用兼容，不将节点数量当作记录数量', () => using(async f => {
  const image = f.workspace.writeMedia(Buffer.from('direct-image'), 'image/png');
  put(f, 'canvas', 'canvas-one', { id: 'canvas-one', title: '合成', nodes: [], connections: [] }, [image.id]);
  const usage = await f.workspace.readDetailedUsage();
  assert.equal(category(usage, 'workspace').records, 1); assert.equal(category(usage, 'images').mediaBytes, image.size); assert.equal(category(usage, 'retained_media').bytes, 0);
}));

test('清空逻辑记录不删除媒体：当前未引用媒体归保留内容', () => using(async f => {
  const store = f.app().createInstance({ storeName: 'image_files' });
  await store.setItem('one', new Blob(['retained-image'], { type: 'image/png' })); await store.clear();
  const usage = await f.workspace.readDetailedUsage();
  assert.equal(category(usage, 'images').records, 0); assert.equal(category(usage, 'retained_media').mediaBytes, 14);
  assert.ok(category(usage, 'history').bytes > 0); sums(usage);
}));

test('大对象拆字段、深图与分页数组的当前记录数正确', () => using(async f => {
  const store = f.app().createInstance({ storeName: 'app_state' });
  await store.setItem('large', { title: '合成', text: 'x'.repeat(1100 * 1024), nested: { values: Array.from({ length: 300 }, (_, i) => i) } });
  const usage = await f.workspace.readDetailedUsage(); assert.equal(category(usage, 'workspace').records, 1);
  assert.ok(category(usage, 'workspace').documentBytes > 0); assert.ok(category(usage, 'workspace').documentBytes < 1100 * 1024, '重复文本分片也按唯一物理文档去重');
  assert.equal(category(usage, 'history').bytes, 0); sums(usage);
}));

test('只读事务快照不被并行新写入串代，结束后的新扫描可见新数据', () => using(async f => {
  const store = f.app(false).createInstance({ storeName: 'prompt_cache' }); await store.setItem('one', '旧');
  const pending = f.workspace.readDetailedUsage(); await store.setItem('two', '新');
  assert.equal(category(await pending, 'prompts').records, 1);
  assert.equal(category(await f.workspace.readDetailedUsage(), 'prompts').records, 2);
}));

test('缺当前分片明确失败，不当作空库或历史碎片略过', () => using(async f => {
  await f.app().createInstance({ storeName: 'prompt_cache' }).setItem('one', 'one');
  const head = f.workspace.readDocument('extension', idFor('prompt_cache')).value.head.id;
  rawEdit(f, db => db.prepare('DELETE FROM documents WHERE id=?').run(head));
  await assert.rejects(f.workspace.readDetailedUsage(), code('usage_invalid_data'));
}));

test('当前根哈希损坏明确失败且后续读取可重试', () => using(async f => {
  await f.app(false).createInstance({ storeName: 'app_state' }).setItem('one', 'one');
  const document = f.workspace.readDocument('extension', idFor('app_state'));
  rawEdit(f, db => db.prepare("UPDATE documents SET hash=? WHERE id=?").run('0'.repeat(64), document.id));
  await assert.rejects(f.workspace.readDetailedUsage(), code('usage_invalid_data'));
  rawEdit(f, db => db.prepare('UPDATE documents SET hash=? WHERE id=?').run(document.hash, document.id));
  assert.equal(category(await f.workspace.readDetailedUsage(), 'workspace').records, 1);
}));

test('根媒体引用与描述不符时不输出不准确容量', () => using(async f => {
  const media = f.workspace.writeMedia(Buffer.from('unmatched'), 'image/png');
  put(f, 'extension', idFor('image_files'), { format: 'guan-app-storage.v1', namespace: 'image_files', entries: [['one', { tree: ['string', 'no-media'], mediaIds: [media.id] }]] }, [media.id]);
  await assert.rejects(f.workspace.readDetailedUsage(), code('usage_invalid_data'));
}));

test('未知根版本停止统计，不静默归为其他或空库', () => using(async f => {
  put(f, 'extension', idFor('app_state'), { format: 'guan-app-storage.v99', namespace: 'app_state' });
  await assert.rejects(f.workspace.readDetailedUsage(), code('usage_invalid_data'));
}));

test('媒体文件长度损坏明确失败；不会读取正文进行哈希或自动修复', () => using(async f => {
  const media = f.workspace.writeMedia(Buffer.from('payload'), 'image/png');
  writeFileSync(join(f.root, '媒体', media.id), 'short');
  await assert.rejects(f.workspace.readDetailedUsage(), code('usage_invalid_data'));
  assert.equal(readFileSync(join(f.root, '媒体', media.id), 'utf8'), 'short');
}));

test('媒体目录链接拒绝访问，错误不泄露外部目标路径', () => using(async f => {
  const target = join(f.root, 'synthetic-external'); writeFileSync(target, 'test', { mode: 0o600 });
  symlinkSync(target, join(f.root, '媒体', 'linked'));
  await assert.rejects(f.workspace.readDetailedUsage(), error => error.code === 'usage_unsafe_path' && !error.message.includes(target));
}));

test('未索引媒体纳入实际占用，备份排除；只读扫描不改逻辑记录或DB正文', () => using(async f => {
  await f.app().createInstance({ storeName: 'prompt_cache' }).setItem('one', 'one');
  await f.workspace.createBackup();
  writeFileSync(join(f.root, '媒体', 'synthetic-unindexed'), '123456789', { mode: 0o600 });
  const dbPath = join(f.root, '工作台.sqlite'), before = sha(readFileSync(dbPath));
  const docsBefore = f.workspace.listDocuments('extension'), usage = await f.workspace.readDetailedUsage();
  assert.equal(usage.breakdown.unindexedMediaBytes, 9); assert.equal(usage.breakdown.unindexedMediaFiles, 1); assert.equal(usage.breakdown.backupsIncluded, false);
  assert.equal(sha(readFileSync(dbPath)), before); assert.deepEqual(f.workspace.listDocuments('extension'), docsBefore);
  assert.equal(usage.breakdown.databaseFileBytes, lstatSync(dbPath).size); sums(usage);
}));

test('工作区身份不符与已关闭工作区均拒绝', async () => {
  const f = fixture();
  try { await assert.rejects(readCategorizedUsage({ dataRoot: f.root, workspaceId: randomUUID() }), code('usage_invalid_data')); }
  finally { f.close(); }
  assert.throws(() => f.workspace.readDetailedUsage(), code('workspace_closed'));
});

test('真实HTTP分类统计保持Origin、Bearer、撤销、限流，不提供匿名入口', () => using(async f => {
  const origin = 'http://localhost:49101', service = await candidate.startDataService({ workspace: f.workspace, allowedOrigins: [origin], rateLimit: 2 });
  try {
    const session = service.issueSession(origin), headers = { Origin: origin, Authorization: 'Bearer ' + session.token };
    assert.equal((await fetch(service.url + '/usage')).status, 403);
    assert.equal((await fetch(service.url + '/usage', { headers: { Origin: origin } })).status, 401);
    assert.equal((await fetch(service.url + '/usage', { headers: { ...headers, Origin: 'http://localhost:49102' } })).status, 403);
    const first = await fetch(service.url + '/usage', { headers }); assert.equal(first.status, 200); sums(await first.json());
    assert.equal((await fetch(service.url + '/usage', { headers })).status, 200);
    assert.equal((await fetch(service.url + '/usage', { headers })).status, 429);
    service.revokeSession(session.token); assert.equal((await fetch(service.url + '/usage', { headers })).status, 401);
  } finally { await service.close(); }
}));

test('统计等待期间会话到期或被撤销，结果不会再交付给失效会话', () => using(async f => {
  let clock = Date.now(), resume, reached;
  const entered = new Promise(resolve => { reached = resolve; });
  const wait = new Promise(resolve => { resume = resolve; });
  const origin = 'http://localhost:49103';
  const service = await candidate.startDataService({ workspace: { workspaceId: f.workspace.workspaceId, async readDetailedUsage() { reached(); await wait; return f.workspace.readDetailedUsage(); } }, allowedOrigins: [origin], sessionTTL: 1000, now: () => clock });
  try {
    const session = service.issueSession(origin), response = fetch(service.url + '/usage', { headers: { Origin: origin, Authorization: 'Bearer ' + session.token } });
    await entered; clock += 1001; service.revokeSession(session.token); resume();
    assert.equal((await response).status, 401);
  } finally { resume(); await service.close(); }
}));

test('相同跨namespace分片的正文容量只计一次，不重复叠加', () => using(async f => {
  const app = f.app();
  await app.createInstance({ storeName: 'app_state' }).setItem('one', 'identical-value');
  await app.createInstance({ storeName: 'prompt_cache' }).setItem('one', 'identical-value');
  const usage = await f.workspace.readDetailedUsage();
  assert.ok(category(usage, 'shared').documentBytes > 0);
  assert.equal(category(usage, 'workspace').records, 1); assert.equal(category(usage, 'prompts').records, 1); sums(usage);
}));

test('历史分片超过旧列表1000条上限仍完整统计，不静默遗漏', () => using(async f => {
  await f.app(false).createInstance({ storeName: 'prompt_cache' }).setItem('one', '当前缓存');
  for (let i = 0; i < 1005; i++) {
    const value = { format: 'guan-app-fragment.v1', kind: 'json', data: i };
    put(f, 'extension', 'app-part-' + sha(JSON.stringify(value)), value);
  }
  assert.throws(() => f.workspace.listDocuments('extension'), code('collection_too_large'));
  const usage = await f.workspace.readDetailedUsage(); assert.equal(category(usage, 'prompts').records, 1);
  assert.equal(category(usage, 'history').blocks, 1005); sums(usage);
}));

test('同大小媒体正文不会被读取：这里只统计，完整内容验签属于读取/备份流程', () => using(async f => {
  const media = f.workspace.writeMedia(Buffer.from('payload'), 'image/png');
  writeFileSync(join(f.root, '媒体', media.id), 'changed');
  const usage = await f.workspace.readDetailedUsage();
  assert.equal(usage.breakdown.mediaContentVerified, false); assert.equal(usage.breakdown.indexedMediaBytes, 7);
  assert.throws(() => f.workspace.readMedia(media.id), code('media_corrupt'));
}));

test('当前服务分类统计仍在响应前复核原会话，工作区使用根目录统计实现', () => {
  const service = readFileSync(join(根目录, '扩展功能/本机服务/数据服务.mjs'), 'utf8');
  assert.match(service, /await workspace\.readDetailedUsage\(\); requireValue\(sessions\.get\(token\) === session && session\.expiresAt > now\(\)/);
  assert.match(readFileSync(join(根目录, '扩展功能/本机存储/SQLite工作区.mjs'), 'utf8'), /import \{ readCategorizedUsage \} from '\.\/分类容量统计\.mjs'/);
});
