// 只检查本批浏览器生成的临时合成SQLite，拒绝正式数据根。
import assert from 'node:assert/strict';
import { existsSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { readFreshRevealCanvas } from './视区跟随原画布夹具.mjs';
import { createShardedApplicationStorage } from '../扩展功能/本机存储/分片应用存储.mjs';

const root = resolve(process.argv[2] ?? ''), output = resolve(process.argv[3] ?? '');
if (realpathSync(root) !== root || dirname(root) !== realpathSync(tmpdir()) || !/^guan-excel-card-workbench-[A-Za-z0-9]+$/.test(basename(root))) throw Error('只接受本批合成工作区');
const data = join(root, '数据');
if (existsSync(join(data, '.实例锁.json'))) throw Error('必须先正常停止隔离服务');
const db = new DatabaseSync(join(data, '工作台.sqlite'), { readOnly: true });
try {
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
  const documents = db.prepare('SELECT * FROM documents ORDER BY collection,id').all();
  for (const row of documents) assert.equal(createHash('sha256').update(row.body).digest('hex'), row.hash);
  const client = { async readDocument(collection, id) {
    const row = db.prepare('SELECT * FROM documents WHERE collection=? AND id=?').get(collection, id);
    return row ? { collection, id, value: JSON.parse(row.body), revision: row.revision, hash: row.hash, updatedAt: row.updated_at, mediaIds: [] } : null;
  }, async readMedia() { throw Error('合成数据不含媒体'); } };
  const canvas = await readFreshRevealCanvas(client), state = canvas.state;
  assert.equal(state.projects.length, 2); assert.equal(state.guanWorkbooks.contract.productSets.length, 1);
  const app = createShardedApplicationStorage({ client }), prefs = app.createInstance({ name: 'infinite-canvas', storeName: 'preferences' });
  try {
    for (const project of state.projects) {
      assert.equal(project.nodes.length, 5); assert.equal(project.connections.length, 4);
      const parameter = project.nodes.find(n => n.type === 'guan:prompt-variables'); assert.ok(parameter);
      const expected = project.title.includes('铝合金') ? { '[SIZE]': '12×24cm', '[WIDTH]': '10cm', '[HEIGHT]': '20cm' } : { '[BENEFIT]': '加强耐用', '[MATERIAL]': '塑料' };
      assert.deepEqual(parameter.metadata.promptVariableValues, expected);
      assert.deepEqual(JSON.parse(await prefs.getItem('guan-canvas-parameter-values:' + encodeURIComponent(project.id))), expected);
      const ids = new Set(project.nodes.map(n => n.id));
      for (const edge of project.connections) { assert.ok(ids.has(edge.fromNodeId)); assert.ok(ids.has(edge.toNodeId)); }
      for (const node of project.nodes.filter(n => n.metadata?.promptVariablePreviewOf)) {
        assert.ok(ids.has(node.metadata.promptVariablePreviewOf)); assert.ok(ids.has(node.metadata.promptVariableSourceNodeId));
        assert.equal(node.metadata.promptVariablePreviewOf, parameter.id);
        assert.doesNotMatch(node.metadata.content, /\[[A-Z]+\]/);
      }
    }
  } finally { app.close(); }
  const evidence = { integrity: 'ok', foreignKeys: 0, documentCount: documents.length,
    projects: state.projects, workbook: state.guanWorkbooks.contract.productSets[0].source,
    documentHashes: documents.map(({ collection, id, hash, revision }) => ({ collection, id, hash, revision })) };
  writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ integrity: 'ok', foreignKeys: 0, documentCount: documents.length, projects: 2, nodes: 10, connections: 8, parameterMemoryVerified: true, output }));
} finally { db.close(); }
