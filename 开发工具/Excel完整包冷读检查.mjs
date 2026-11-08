// 只读本轮独立合成工作区，不打开正式工作区或读取主密钥。
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { readFreshRevealCanvas } from './视区跟随原画布夹具.mjs';

const root = resolve(process.argv[2] ?? ''), output = resolve(process.argv[3] ?? '');
if (realpathSync(root) !== root || dirname(root) !== realpathSync(tmpdir()) || !/^guan-excel-visual-workbench-[A-Za-z0-9]+$/.test(basename(root))) throw Error('仅接受本轮合成工作区');
const data = join(root, '数据');
if (existsSync(join(data, '.实例锁.json'))) throw Error('先正常停止服务再冷读');
const db = new DatabaseSync(join(data, '工作台.sqlite'), { readOnly: true });
try {
  const integrity = db.prepare('PRAGMA integrity_check').get().integrity_check;
  const foreignKeys = db.prepare('PRAGMA foreign_key_check').all().length;
  assert.equal(integrity, 'ok'); assert.equal(foreignKeys, 0);
  const documents = db.prepare('SELECT * FROM documents ORDER BY collection,id').all();
  for (const row of documents) assert.equal(createHash('sha256').update(row.body).digest('hex'), row.hash);
  const canvas = await readFreshRevealCanvas({
    async readDocument(collection, id) {
      const row = db.prepare('SELECT * FROM documents WHERE collection=? AND id=?').get(collection, id);
      return row ? { collection, id, value: JSON.parse(row.body), revision: row.revision, hash: row.hash, updatedAt: row.updated_at, mediaIds: [] } : null;
    },
    async readMedia() { throw Error('本轮合成工作区不含媒体'); },
  });
  const state = canvas.state;
  assert.equal(state.guanWorkbooks.contract.productSets.length, 3);
  assert.equal(state.projects.length, 8);
  assert.equal(state.deletedProjects.length, 0);
  const original = state.projects.find(project => project.id === 'excel-existing');
  assert.equal(original.nodes[0].metadata.content, '仅合成数据；导入不能覆盖原有画布。');
  assert.deepEqual(original.nodes[0].position, { x: 100, y: 100 });
  assert.deepEqual(original.viewport, { x: 0, y: 0, k: 1 });
  const restored = state.projects.find(project => project.title === '未命名产品3');
  assert.equal(restored.nodes.length, 1); assert.equal(restored.nodes[0].type, 'text');
  for (const book of state.guanWorkbooks.contract.productSets) {
    const remembered = state.guanWorkbooks.activeByWorkbook[book.id];
    assert.equal(state.projects.find(project => project.id === remembered)?.productSetId, book.id);
  }
  const evidence = { integrity, foreignKeys, documentCount: documents.length,
    documents: documents.map(({ collection, id, hash, revision }) => ({ collection, id, hash, revision })),
    projects: state.projects, deletedProjects: state.deletedProjects, workbooks: state.guanWorkbooks };
  writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ integrity, foreignKeys, documentCount: documents.length, projects: state.projects.length,
    workbooks: state.guanWorkbooks.contract.productSets.map(book => book.source.fileName), restoredNode: restored.nodes[0].id, output }));
} finally { db.close(); }
