import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { 复制独立备份文件, 复用相同数据库快照 } from '../扩展功能/本机存储/备份节省空间.mjs';
import { openWorkspace, restoreBackup } from '../扩展功能/本机存储/SQLite工作区.mjs';

test('节省空间的备份文件独立可写；摘要错误保留原数据；旧副本缺失仍保留新快照', () => {
  const root = mkdtempSync(join(tmpdir(), '备份空间验证-'));
  const source = join(root, '原件'), target = join(root, '副本'), bytes = Buffer.alloc(1024 * 1024, 42);
  const hash = createHash('sha256').update(bytes).digest('hex');
  try {
    writeFileSync(source, bytes, { mode: 0o600 });
    复制独立备份文件(source, target, hash, bytes.length);
    assert.notEqual(statSync(source).ino, statSync(target).ino);
    assert.equal(statSync(target).nlink, 1); assert.equal(statSync(target).mode & 0o777, 0o600);
    writeFileSync(target, 'changed'); assert.deepEqual(readFileSync(source), bytes);
    assert.throws(() => 复制独立备份文件(source, join(root, '坏副本'), '0'.repeat(64), bytes.length));
    assert.deepEqual(readFileSync(source), bytes);
    assert.equal(复用相同数据库快照({ path: join(root, '不存在'), hash, size: bytes.length }, target, hash, bytes.length), false);
    assert.equal(readFileSync(target, 'utf8'), 'changed');
    assert.equal(复用相同数据库快照({ path: source, hash, size: bytes.length }, target, hash, bytes.length), true);
    assert.deepEqual(readFileSync(target), bytes);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('连续 SQLite 快照和媒体均能恢复；删除上一份备份后仍能创建完整新备份', async () => {
  const root = mkdtempSync(join(tmpdir(), '连续备份验证-'));
  const store = openWorkspace({ dataRoot: join(root, '工作区'), initialize: true });
  try {
    const media = store.writeMedia(Buffer.from('synthetic-media'), 'application/octet-stream');
    const put = (title, revision) => store.writeDocument({ collection: 'canvas', id: 'a', value: { id: 'a', title, nodes: [], connections: [] }, mediaIds: [media.id], expectedRevision: revision, operationId: randomUUID() });
    put('first', 0); const first = await store.createBackup(), second = await store.createBackup();
    const manifest = path => JSON.parse(readFileSync(join(path, '清单.json')));
    assert.equal(manifest(first.path).files[0].hash, manifest(second.path).files[0].hash);
    assert.notEqual(statSync(join(first.path, '工作台.sqlite')).ino, statSync(join(second.path, '工作台.sqlite')).ino);
    put('changed', 1); const third = await store.createBackup();
    rmSync(third.path, { recursive: true });
    const fourth = await store.createBackup();
    for (const [receipt, title] of [[first, 'first'], [second, 'first'], [fourth, 'changed']]) {
      const targetRoot = join(root, randomUUID()); restoreBackup({ backupRoot: receipt.path, targetRoot });
      const restored = openWorkspace({ dataRoot: targetRoot });
      try {
        assert.equal(restored.readDocument('canvas', 'a').value.title, title);
        assert.equal(Buffer.from(restored.readMedia(media.id).bytes).toString(), 'synthetic-media');
      } finally { restored.close(); }
    }
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});
