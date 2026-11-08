import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { 核验产品恢复收据, 核验产品日常包 } from './产品核心日常运行.mjs';
import { fileMap } from './恢复3100故障现场.mjs';

const [file, digest] = process.argv.slice(2); assert.equal(process.argv.length, 4);
const { root, receipt } = 核验产品恢复收据(file, digest), prepared = 核验产品日常包(receipt.manifest, receipt.manifestSHA256);
const { createShardedApplicationStorage } = await import(pathToFileURL(join(prepared.integration.副本, 'web/src/guan/sqlite/分片应用存储.mjs')).href);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function read(root) {
  const db = new DatabaseSync(join(root, '工作台.sqlite'), { readOnly: true }); let app;
  try {
    db.exec('BEGIN');
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok'); assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
    assert.equal(db.prepare("SELECT value FROM workspace WHERE key='id'").get().value, receipt.workspaceId);
    for (const row of db.prepare('SELECT body,hash FROM documents').all()) assert.equal(sha(row.body), row.hash);
    const media = db.prepare('SELECT * FROM media ORDER BY id').all();
    for (const row of media) { const bytes = readFileSync(join(root, '媒体', row.id)); assert.equal(bytes.length, row.size); assert.equal(sha(bytes), row.id); }
    const client = {
      readDocument(collection, id) {
        const row = db.prepare('SELECT * FROM documents WHERE collection=? AND id=?').get(collection, id);
        return row ? { collection, id, value: JSON.parse(row.body), revision: row.revision, hash: row.hash,
          mediaIds: db.prepare('SELECT media_id FROM document_media WHERE collection=? AND document_id=? ORDER BY media_id').all(collection, id).map(item => item.media_id) } : null;
      },
      readMedia(id) { const row = media.find(item => item.id === id); assert.ok(row); return new Blob([readFileSync(join(root, '媒体', id))], { type: row.mime }); },
    };
    app = createShardedApplicationStorage({ client });
    const canvas = JSON.parse(await app.createInstance().getItem('infinite-canvas:canvas_store'));
    const normalize = value => {
      if (Array.isArray(value)) return value.map(normalize);
      if (!value || typeof value !== 'object') return value;
      // Blob临时URL由编码器每次读取生成，不是业务正文；时间戳允许页面正常保存更新。
      return Object.fromEntries(Object.entries(value).filter(([key, child]) => key !== 'updatedAt' && !(key === 'content' && typeof child === 'string' && child.startsWith('blob:'))).map(([key, child]) => [key, normalize(child)]));
    };
    const projects = canvas.state.projects.map(project => ({ id: project.id, nodes: project.nodes.length, connections: project.connections.length,
      viewport: project.viewport, businessSHA256: sha(JSON.stringify(normalize(project))) }));
    const value = { projects, deleted: (canvas.state.deletedProjects ?? []).map(normalize), media: media.map(item => ({ id: item.id, size: item.size })), documents: db.prepare('SELECT count(*) AS count FROM documents').get().count };
    app.close(); app = null; db.exec('ROLLBACK'); return value;
  } finally { app?.close(); db.close(); }
}
const before = await read(receipt.snapshot), after = await read(receipt.dataRoot);
assert.deepEqual(after.projects, before.projects, '正式产品、节点、连线及视区发生非预期变化');
assert.deepEqual(after.deleted, before.deleted); assert.deepEqual(after.media, before.media);
assert.deepEqual(fileMap(receipt.original), receipt.originalFiles, '保全原现场有变化');
const result = { passed: true, date: new Date().toISOString(), workspaceId: receipt.workspaceId, projects: after.projects, deletedCount: after.deleted.length,
  media: after.media, beforeDocuments: before.documents, afterDocuments: after.documents, allDocumentHashesValid: true, originalFilesUnchanged: true,
  credentialsDecryptedByCheck: false, ignoredForSemanticCompare: ['updatedAt', 'image content blob URL'] };
writeFileSync(join(root, '数据复核-' + Date.now() + '.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify(result));
