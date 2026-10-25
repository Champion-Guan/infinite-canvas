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

test('媒体文件与索引、内容去重、引用检查和哈希校验', () => {
  const root = temp(), store = openWorkspace({ dataRoot: root, initialize: true });
  try {
    const media = store.writeMedia(Buffer.from('synthetic-media'), 'application/octet-stream');
    assert.equal(store.writeMedia(Buffer.from('synthetic-media'), 'application/octet-stream').id, media.id);
    assert.deepEqual(store.readMedia(media.id).bytes, Buffer.from('synthetic-media'));
    assert.throws(() => put(store, canvas(), 0, { mediaIds: ['a'.repeat(64)] }), code('media_not_found'));
    assert.equal(put(store, canvas(), 0, { mediaIds: [media.id] }).revision, 1);
    writeFileSync(join(root, '媒体', media.id), 'corrupt');
    assert.throws(() => store.readMedia(media.id), code('media_corrupt'));
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

test('完整备份恢复到新目录，坏备份与已有目标均不覆盖', async () => {
  const root = temp(), store = openWorkspace({ dataRoot: root, initialize: true });
  const media = store.writeMedia(Buffer.from('backup-media'), 'application/octet-stream');
  put(store, canvas(), 0, { mediaIds: [media.id] });
  const backup = await store.createBackup();
  const target = join(temp(), '恢复工作区');
  const result = restoreBackup({ backupRoot: backup.path, targetRoot: target });
  assert.equal(result.workspaceId, store.workspaceId);
  const restored = openWorkspace({ dataRoot: target });
  assert.equal(restored.readDocument('canvas', 'canvas-a').value.title, '合成画布');
  assert.deepEqual(restored.readMedia(media.id).bytes, Buffer.from('backup-media')); restored.close();
  assert.throws(() => restoreBackup({ backupRoot: backup.path, targetRoot: target }), code('restore_target_exists'));
  writeFileSync(join(backup.path, '媒体', media.id), 'bad');
  const rejected = join(temp(), '不应创建');
  assert.throws(() => restoreBackup({ backupRoot: backup.path, targetRoot: rejected }), code('backup_corrupt'));
  assert.equal(readdirSync(join(rejected, '..')).includes('不应创建'), false);
  assert.equal(store.readDocument('canvas', 'canvas-a').revision, 1); store.close();
});

test('数据根、数据库、媒体、备份权限；备份期间拒绝写入或关闭', async () => {
  const root = temp(), store = openWorkspace({ dataRoot: root, initialize: true });
  try {
    const media = store.writeMedia(Buffer.from('private-synthetic'), 'application/octet-stream');
    put(store);
    const pending = store.createBackup();
    assert.throws(() => put(store, canvas('canvas-a', '备份时不写'), 1), code('workspace_busy'));
    assert.throws(() => store.close(), code('workspace_busy'));
    const backup = await pending;
    for (const folder of [root, join(root, '媒体'), backup.path, join(backup.path, '媒体')]) assert.equal(statSync(folder).mode & 0o777, 0o700);
    for (const file of [join(root, '工作台.sqlite'), join(root, '.工作区.json'), join(root, '媒体', media.id), join(backup.path, '工作台.sqlite'), join(backup.path, '清单.json')]) assert.equal(statSync(file).mode & 0o777, 0o600);
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
