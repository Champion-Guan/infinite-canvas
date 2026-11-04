import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync, symlinkSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { openWorkspace, restoreBackup } from '../扩展功能/本机存储/SQLite工作区.mjs';

const roots = [];
function temp() { const path = mkdtempSync(join(tmpdir(), 'guan-stage6-')); roots.push(path); return path; }
const canvas = (id = 'canvas-a', title = '合成画布') => ({ id, title, nodes: [{ id: 'text-a', type: 'text', position: { x: 10, y: 20 }, metadata: { content: '仅为测试' } }], connections: [], viewport: { x: 0, y: 0, k: 1 } });
const put = (store, value = canvas(), expectedRevision = 0, extra = {}) => store.writeDocument({ collection: 'canvas', id: value.id, value, expectedRevision, operationId: randomUUID(), mediaIds: [], ...extra });
const code = expected => error => error.code === expected;

test('初始化、重开、保存ACK、工作区身份不依赖端口', () => {
  const root = temp(); let store = openWorkspace({ dataRoot: root, initialize: true });
  const id = store.workspaceId; const ack = put(store);
  assert.equal(ack.revision, 1); assert.equal(ack.workspaceId, id);
  assert.equal(store.readDocument('canvas', 'canvas-a').value.title, '合成画布');
  store.close(); store = openWorkspace({ dataRoot: root });
  assert.equal(store.workspaceId, id); assert.equal(store.readDocument('canvas', 'canvas-a').revision, 1); store.close();
});

test('乐观锁拒绝覆盖，重试幂等，改内容复用操作ID拒绝', () => {
  const store = openWorkspace({ dataRoot: temp(), initialize: true });
  try {
    const operationId = randomUUID(), value = canvas(); const first = put(store, value, 0, { operationId });
    assert.deepEqual(put(store, value, 0, { operationId }), first);
    assert.throws(() => put(store, canvas('canvas-a', '另一请求'), 0), code('revision_conflict'));
    assert.throws(() => put(store, canvas('canvas-a', '篡改重试'), 0, { operationId }), code('idempotency_conflict'));
    assert.equal(put(store, canvas('canvas-a', '第二版'), 1).revision, 2);
    assert.equal(store.readDocument('canvas', 'canvas-a').value.title, '第二版');
  } finally { store.close(); }
});

test('媒体以单个SQLite BLOB保存、内容去重、引用检查和冷读哈希校验', () => {
  const root = temp(); let store = openWorkspace({ dataRoot: root, initialize: true });
  try {
    const content = Buffer.from('synthetic-media'), media = store.writeMedia(content, 'application/octet-stream');
    assert.equal(store.writeMedia(Buffer.from('synthetic-media'), 'application/octet-stream').id, media.id);
    assert.deepEqual(Buffer.from(store.readMedia(media.id).bytes), Buffer.from('synthetic-media'));
    assert.equal(readdirSync(join(root, '媒体')).includes(media.id), false, '媒体字节只在SQLite中保存一次');
    assert.throws(() => put(store, canvas(), 0, { mediaIds: ['a'.repeat(64)] }), code('media_not_found'));
    assert.equal(put(store, canvas(), 0, { mediaIds: [media.id] }).revision, 1);
    store.close();
    const legacy = new DatabaseSync(join(root, '工作台.sqlite'));
    legacy.prepare('UPDATE media SET content=NULL WHERE id=?').run(media.id); legacy.close();
    writeFileSync(join(root, '媒体', media.id), content);
    store = openWorkspace({ dataRoot: root });
    assert.equal(store.writeMedia(content, 'application/octet-stream').id, media.id, '旧外置媒体再次保存时迁入SQLite');
    assert.equal(readdirSync(join(root, '媒体')).includes(media.id), false, 'BLOB事务提交后移除旧副本');
    store.close();
    const corrupt = new DatabaseSync(join(root, '工作台.sqlite'));
    corrupt.prepare('UPDATE media SET content=? WHERE id=?').run(Buffer.from('corrupt'), media.id); corrupt.close();
    store = openWorkspace({ dataRoot: root });
    assert.throws(() => store.readMedia(media.id), code('media_corrupt'));
  } finally { try { store.close(); } catch (error) { if (error.code !== 'workspace_closed') throw error; } }
});

test('多张完整媒体在单个SQLite事务中原子保存并按内容去重', () => {
  let commits = 0, failCommit = false;
  const root = temp(), store = openWorkspace({ dataRoot: root, initialize: true, beforeCommit: () => {
    commits++;
    if (failCommit) throw new Error('synthetic batch interruption');
  } });
  try {
    const first = Buffer.from('batch-image-a'), second = Buffer.from('batch-image-b');
    const ack = store.writeMediaBatch([
      { bytes: first, mime: 'image/png' },
      { bytes: second, mime: 'image/jpeg' },
      { bytes: Buffer.from(first), mime: 'image/png' },
    ]);
    assert.equal(commits, 1);
    assert.equal(new Set(ack.map(item => item.id)).size, 2);
    assert.equal(ack[0].id, ack[2].id);
    assert.deepEqual(Buffer.from(store.readMedia(ack[1].id).bytes), second);
    failCommit = true;
    assert.throws(() => store.writeMediaBatch([{ bytes: Buffer.from('batch-image-c'), mime: 'image/png' }]), /synthetic batch interruption/);
    assert.equal(store.readUsage().databases[0].stores.find(item => item.name === 'media_blobs').records, 2);
  } finally { store.close(); }
});

test('保存文档只读取媒体索引与长度，不把已存图片BLOB复制到JavaScript', () => {
  const store = openWorkspace({ dataRoot: temp(), initialize: true });
  const prepare = DatabaseSync.prototype.prepare;
  let checks = 0;
  try {
    const media = store.writeMedia(Buffer.alloc(4 * 1024 * 1024, 17), 'image/png');
    DatabaseSync.prototype.prepare = function (sql) {
      const statement = prepare.call(this, sql);
      if (!/^SELECT\b/i.test(sql) || !/\bFROM media\b/i.test(sql)) return statement;
      return new Proxy(statement, { get(target, key) {
        const method = Reflect.get(target, key);
        if (key !== 'get') return typeof method === 'function' ? method.bind(target) : method;
        return (...args) => {
          const row = method.apply(target, args);
          checks++;
          assert.equal(Object.values(row).some(value => ArrayBuffer.isView(value)), false,
            '每次任务状态/画布保存都不能复制历史图片字节');
          return row;
        };
      } });
    };
    assert.equal(put(store, canvas(), 0, { mediaIds: [media.id] }).revision, 1);
    assert.equal(checks, 1);
  } finally { DatabaseSync.prototype.prepare = prepare; store.close(); }
});

test('媒体引用轻量校验仍拒绝损坏BLOB及缺失、长度错误的旧外置文件', () => {
  const root = temp(); let store = openWorkspace({ dataRoot: root, initialize: true });
  try {
    const content = Buffer.from('synthetic-reference'), media = store.writeMedia(content, 'image/png');
    store.close();
    const raw = new DatabaseSync(join(root, '工作台.sqlite'));
    raw.prepare('UPDATE media SET content=? WHERE id=?').run(Buffer.from('truncated'), media.id);
    raw.close();
    store = openWorkspace({ dataRoot: root });
    assert.throws(() => put(store, canvas(), 0, { mediaIds: [media.id] }), code('media_corrupt'));
    store.close();
    const legacy = new DatabaseSync(join(root, '工作台.sqlite'));
    legacy.prepare('UPDATE media SET content=NULL WHERE id=?').run(media.id);
    legacy.close();
    store = openWorkspace({ dataRoot: root });
    assert.throws(() => put(store, canvas(), 0, { mediaIds: [media.id] }), code('media_not_found'));
    writeFileSync(join(root, '媒体', media.id), Buffer.from('truncated'));
    assert.throws(() => put(store, canvas(), 0, { mediaIds: [media.id] }), code('media_corrupt'));
    writeFileSync(join(root, '媒体', media.id), content);
    assert.equal(put(store, canvas(), 0, { mediaIds: [media.id] }).revision, 1);
    assert.deepEqual(Buffer.from(store.readMedia(media.id).bytes), content);
  } finally { store.close(); }
});

test('空间不足与中途事务失败不能产生成功ACK或半条文档', () => {
  const root = temp(); let noSpace = false, failCommit = false;
  const store = openWorkspace({ dataRoot: root, initialize: true, availableBytes: () => noSpace ? 0 : 1e12, beforeCommit: () => { if (failCommit) throw new Error('synthetic interruption'); } });
  try {
    put(store); noSpace = true;
    assert.throws(() => put(store, canvas('canvas-a', '不能落盘'), 1), code('insufficient_space'));
    assert.throws(() => store.writeMedia(Buffer.from('x'), 'application/octet-stream'), code('insufficient_space'));
    noSpace = false; failCommit = true;
    assert.throws(() => put(store, canvas('canvas-a', '中断'), 1), /synthetic interruption/);
    assert.equal(store.readDocument('canvas', 'canvas-a').revision, 1);
    assert.equal(store.readDocument('canvas', 'canvas-a').value.title, '合成画布');
  } finally { store.close(); }
});

test('拒绝未知目录、符号链接、凭据、临时URL和非法引用', () => {
  const unknown = temp(); writeFileSync(join(unknown, '私人文件'), 'keep');
  assert.throws(() => openWorkspace({ dataRoot: unknown, initialize: true }), code('unknown_data_root'));
  assert.equal(readFileSync(join(unknown, '私人文件'), 'utf8'), 'keep');
  const store = openWorkspace({ dataRoot: temp(), initialize: true });
  try {
    assert.throws(() => put(store, { ...canvas(), apiKey: 'synthetic-not-real' }), code('credential_field_rejected'));
    assert.throws(() => put(store, { ...canvas(), url: 'blob:synthetic' }), code('transient_media_url'));
    assert.throws(() => put(store, { ...canvas(), connections: [{ id: 'edge', fromNodeId: 'text-a', toNodeId: 'missing' }] }), code('invalid_canvas'));
    assert.throws(() => store.readMedia('../outside'), code('invalid_media'));
    const other = temp(); symlinkSync(store.dataRoot, join(other, '链接'));
    assert.throws(() => openWorkspace({ dataRoot: join(other, '链接') }), code('unsafe_path'));
    assert.throws(() => openWorkspace({ dataRoot: store.dataRoot }), code('workspace_locked'));
  } finally { store.close(); }
});

test('未知schema安全停止，主数据库不被自动降级或重建', () => {
  const root = temp(), store = openWorkspace({ dataRoot: root, initialize: true }); put(store); store.close();
  const db = new DatabaseSync(join(root, '工作台.sqlite')); db.exec('PRAGMA user_version=999'); db.close();
  const before = readFileSync(join(root, '工作台.sqlite'));
  assert.throws(() => openWorkspace({ dataRoot: root }), code('schema_unsupported'));
  assert.deepEqual(readFileSync(join(root, '工作台.sqlite')), before);
});

test('完整备份直接包含SQLite媒体BLOB；损坏备份与已有目标均不覆盖', async () => {
  const root = temp(), store = openWorkspace({ dataRoot: root, initialize: true });
  const media = store.writeMedia(Buffer.from('backup-media'), 'application/octet-stream');
  put(store, canvas(), 0, { mediaIds: [media.id] });
  const backup = await store.createBackup();
  const manifest = JSON.parse(readFileSync(join(backup.path, '清单.json'), 'utf8'));
  assert.equal(manifest.mediaCount, 1);
  assert.equal(manifest.files.some(file => file.path === `媒体/${media.id}`), false, 'BLOB媒体不再另存外置媒体副本');
  assert.equal(readdirSync(join(backup.path, '媒体')).length, 0);
  const target = join(temp(), '恢复工作区');
  const result = restoreBackup({ backupRoot: backup.path, targetRoot: target });
  assert.equal(result.workspaceId, store.workspaceId);
  const restored = openWorkspace({ dataRoot: target });
  assert.equal(restored.readDocument('canvas', 'canvas-a').value.title, '合成画布');
  assert.deepEqual(Buffer.from(restored.readMedia(media.id).bytes), Buffer.from('backup-media')); restored.close();
  assert.throws(() => restoreBackup({ backupRoot: backup.path, targetRoot: target }), code('restore_target_exists'));
  const damaged = new DatabaseSync(join(backup.path, '工作台.sqlite'));
  damaged.prepare('UPDATE media SET content=? WHERE id=?').run(Buffer.from('bad'), media.id); damaged.close();
  const rejected = join(temp(), '不应创建');
  assert.throws(() => restoreBackup({ backupRoot: backup.path, targetRoot: rejected }), code('backup_corrupt'));
  assert.equal(readdirSync(join(rejected, '..')).includes('不应创建'), false);
  assert.equal(store.readDocument('canvas', 'canvas-a').revision, 1); store.close();
});

test('数据根、数据库和备份权限；备份期间拒绝写入或关闭', async () => {
  const root = temp(), store = openWorkspace({ dataRoot: root, initialize: true });
  try {
    const media = store.writeMedia(Buffer.from('private-synthetic'), 'application/octet-stream');
    put(store);
    const pending = store.createBackup();
    assert.throws(() => put(store, canvas('canvas-a', '备份时不写'), 1), code('workspace_busy'));
    assert.throws(() => store.close(), code('workspace_busy'));
    const backup = await pending;
    for (const folder of [root, join(root, '媒体'), backup.path, join(backup.path, '媒体')]) assert.equal(statSync(folder).mode & 0o777, 0o700);
    assert.equal(readdirSync(join(root, '媒体')).includes(media.id), false);
    assert.equal(readdirSync(join(backup.path, '媒体')).includes(media.id), false);
    for (const file of [join(root, '工作台.sqlite'), join(root, '.工作区.json'), join(backup.path, '工作台.sqlite'), join(backup.path, '清单.json')]) assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.equal(put(store, canvas('canvas-a', '备份后继续'), 1).revision, 2);
  } finally { store.close(); }
});

test('隔离子进程事务中崩溃：无半条提交，残留锁安全停止，备份可恢复', async () => {
  const root = temp(), store = openWorkspace({ dataRoot: root, initialize: true });
  put(store); const backup = await store.createBackup(); store.close();
  const source = `import{openWorkspace}from ${JSON.stringify(new URL('../扩展功能/本机存储/SQLite工作区.mjs', import.meta.url).href)};
    const s=openWorkspace({dataRoot:${JSON.stringify(root)},beforeCommit:()=>process.kill(process.pid,'SIGKILL')});
    s.writeDocument({collection:'canvas',id:'canvas-a',value:${JSON.stringify(canvas('canvas-a', '绝不提交'))},expectedRevision:1,operationId:${JSON.stringify(randomUUID())}});`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', source], { encoding: 'utf8', timeout: 10_000 });
  assert.equal(child.signal, 'SIGKILL');
  assert.throws(() => openWorkspace({ dataRoot: root }), code('workspace_locked'));
  const raw = new DatabaseSync(join(root, '工作台.sqlite'), { readOnly: true });
  try { const row = raw.prepare('SELECT body,revision FROM documents').get(); assert.equal(row.revision, 1); assert.equal(JSON.parse(row.body).title, '合成画布'); }
  finally { raw.close(); }
  const restored = restoreBackup({ backupRoot: backup.path, targetRoot: join(temp(), '崩溃恢复') });
  const recovered = openWorkspace({ dataRoot: restored.dataRoot });
  assert.equal(recovered.readDocument('canvas', 'canvas-a').revision, 1); recovered.close();
});

// 临时数据保留，便于失败诊断；全部由mkdtemp创建，不访问或清理真实目录。
test.after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });
