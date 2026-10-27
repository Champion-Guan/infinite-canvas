import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, readdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openWorkspace } from '../扩展功能/本机存储/SQLite工作区.mjs';
import { 清理升级历史备份 } from '../扩展功能/本机服务/升级遗留清理.mjs';

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), '升级清理-')));
  const dataRoot = join(root, '工作区'), store = openWorkspace({ dataRoot, initialize: true });
  t.after(() => { try { store.close(); } finally { rmSync(root, { recursive: true, force: true }); } });
  store.writeDocument({ collection: 'canvas', id: 'canvas-a', value: { id: 'canvas-a', title: '产品数据保留', nodes: [], connections: [], viewport: { x: 0, y: 0, k: 1 } }, mediaIds: [], expectedRevision: 0, operationId: randomUUID() });
  const media = store.writeMedia(Buffer.from('原有素材'), 'application/octet-stream');
  return { root, store, dataRoot, workspaceId: store.workspaceId, media };
}
test('首次升级清历史备份，数据库和素材保持；之后手动备份不再清理', async t => {
  const f = fixture(t), backup = await f.store.createBackup();
  const bytes = readFileSync(join(f.dataRoot, '工作台.sqlite'));
  const result = await 清理升级历史备份(f);
  assert.equal(result.removed, 1); assert.equal(existsSync(backup.path), false);
  assert.deepEqual(readFileSync(join(f.dataRoot, '工作台.sqlite')), bytes);
  assert.equal(f.store.readDocument('canvas', 'canvas-a').value.title, '产品数据保留');
  assert.equal(f.store.readMedia(f.media.id).bytes.toString(), '原有素材');
  const manual = await f.store.createBackup();
  assert.equal((await 清理升级历史备份(f)).alreadyCompleted, true);
  assert.equal(existsSync(manual.path), true);
});
test('其他工作区备份、链接、未知文件与非备份目录保留', async t => {
  const f = fixture(t);
  const foreign = await f.store.createBackup(), manifest = join(foreign.path, '清单.json');
  const value = JSON.parse(readFileSync(manifest)); value.workspaceId = randomUUID(); writeFileSync(manifest, JSON.stringify(value));
  const unknown = await f.store.createBackup(); writeFileSync(join(unknown.path, '客户文件'), '保留');
  const linked = join(f.dataRoot, '备份', randomUUID()); symlinkSync(foreign.path, linked);
  assert.equal((await 清理升级历史备份(f)).removed, 0);
  for (const folder of [foreign.path, unknown.path, linked]) assert.equal(existsSync(folder), true);
});
test('删除中断后继续回收半份目录，回执不提前标记完成', async t => {
  const f = fixture(t); await f.store.createBackup();
  await assert.rejects(清理升级历史备份({ ...f, async remove(path) { unlinkSync(join(path, '清单.json')); throw Error('模拟中断'); } }));
  assert.equal(existsSync(join(f.dataRoot, '.历史备份清理-v1.json')), false);
  assert.equal((await 清理升级历史备份(f)).removed, 1);
  assert.deepEqual(readdirSync(join(f.dataRoot, '备份')), []);
});
test('未创建过备份的工作区完成一次标记，不删除后来的手动备份', async t => {
  const f = fixture(t);
  assert.equal((await 清理升级历史备份(f)).removed, 0);
  const manual = await f.store.createBackup(); await 清理升级历史备份(f);
  assert.equal(existsSync(manual.path), true);
});
