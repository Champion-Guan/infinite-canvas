import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, realpathSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createShardedApplicationStorage } from '../扩展功能/本机存储/分片应用存储.mjs';

// 独立进程、只读 SQLite 连接；仅接受本轮临时夹具目录，不初始化/接管任何工作区。
const input = process.argv[2], root = input && realpathSync(input);
assert.ok(root && resolve(input) === root && dirname(root) === realpathSync(tmpdir()) && /^guan-product-restore-original-[A-Za-z0-9]+$/.test(basename(root)), '仅接受本轮真实临时根');
const dataRoot = join(root, '数据'), sha = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(existsSync(join(dataRoot, '.实例锁.json')), false, '必须正常停止后冷读');
const db = new DatabaseSync(join(dataRoot, '工作台.sqlite'), { readOnly: true });
let app;
try {
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
  const mediaRows = db.prepare('SELECT * FROM media ORDER BY id').all();
  const client = {
    readDocument(collection, id) {
      const row = db.prepare('SELECT * FROM documents WHERE collection=? AND id=?').get(collection, id);
      if (!row) return null;
      assert.equal(sha(row.body), row.hash);
      return { collection, id, value: JSON.parse(row.body), revision: row.revision, hash: row.hash,
        mediaIds: db.prepare('SELECT media_id FROM document_media WHERE collection=? AND document_id=? ORDER BY media_id').all(collection, id).map(item => item.media_id) };
    },
    readMedia(id) {
      const row = mediaRows.find(item => item.id === id);
      assert.ok(row);
      const bytes = readFileSync(join(dataRoot, '媒体', id));
      assert.equal(bytes.length, row.size); assert.equal(sha(bytes), id);
      return new Blob([bytes], { type: row.mime });
    },
  };
  app = createShardedApplicationStorage({ client });
  const canvas = JSON.parse(await app.createInstance().getItem('infinite-canvas:canvas_store'));
  const a = canvas.state.projects.find(item => item.id === 'restore-product-A'), b = canvas.state.projects.find(item => item.id === 'restore-product-B');
  assert.ok(a && b); assert.equal(canvas.state.deletedProjects.length, 0);
  assert.equal(a.nodes.length, 2); assert.equal(a.connections.length, 1); assert.equal(a.chatSessions[0].messages[0].text, '仅隔离测试，不调用生成服务。');
  assert.deepEqual(a.viewport, { x: 50, y: 90, k: 0.9 }); assert.deepEqual(b.viewport, { x: -35, y: 20, k: 1.1 });
  assert.equal(b.nodes[0].metadata.content, 'B内容不得被恢复A覆盖。');
  const pngHash = 'a8ce2cc55a1e98af548750444969d3645ea4ef893522886e1693c7cc16f12c63';
  const blob = await client.readMedia(pngHash); assert.equal(blob.size, 360);
  const preference = await app.createInstance({ storeName: 'preferences' }).getItem('guan-products:active:v1');
  assert.equal(preference, 'restore-product-B');
  console.log(JSON.stringify({ status: 'pass', independentProcess: true, readOnly: true, integrity: 'ok', foreignKeys: 0,
    activeIds: canvas.state.projects.map(item => item.id), deleted: canvas.state.deletedProjects.length,
    aNodes: a.nodes.length, aConnections: a.connections.length, aChatSessions: a.chatSessions.length, aViewport: a.viewport, bViewport: b.viewport,
    activePreference: preference, mediaBytes: blob.size, mediaSHA256: pngHash }));
} finally { app?.close(); db.close(); }
