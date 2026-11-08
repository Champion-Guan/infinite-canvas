// 本轮四画布、两工作簿的合成数据断言；不接受正式数据根，不读取凭据主密钥。
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { readFreshRevealCanvas } from './视区跟随原画布夹具.mjs';

const root = resolve(process.argv[2] ?? ''), output = resolve(process.argv[3] ?? '');
if (realpathSync(root) !== root || dirname(root) !== realpathSync(tmpdir()) || !/^guan-excel-visual-workbench-[A-Za-z0-9]+$/.test(basename(root))) throw Error('仅接受隔离合成工作区');
const data = join(root, '数据');
if (existsSync(join(data, '.实例锁.json'))) throw Error('必须先正常停止隔离服务');
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
    async readMedia() { throw Error('合成数据不含媒体'); },
  });
  const state = canvas.state, books = state.guanWorkbooks.contract.productSets;
  assert.equal(books.length, 2); assert.equal(state.projects.length, 4); assert.equal(state.deletedProjects.length, 0);
  assert.deepEqual(books.map(book => book.source.fileName).sort(), ['B.xlsx', '同名路线.xls']);
  const xls = books.find(book => book.source.fileName === '同名路线.xls');
  assert.equal(xls.source.kind, 'xls');
  assert.equal(xls.source.fileSha256, '92666740a58a3028ef7a15537e6ce36eb68e912dc24f88db6fee2800072e8576');
  assert.deepEqual(xls.source.promptTemplates.map(template => template.route), ['同名 | 铝合金 | 尺寸展示', '同名 | 塑料 | 核心卖点']);
  const products = state.guanWorkbooks.contract.products.filter(product => product.productSetId === xls.id);
  assert.equal(products.length, 2); assert.equal(new Set(products.map(product => product.id)).size, 2);
  const expected = [
    ['同名 | 铝合金 | 尺寸展示', '仅铝合金尺寸路线', 'Aluminium size [SIZE]'],
    ['同名 | 塑料 | 核心卖点', '仅塑料卖点路线', 'Plastic benefit [BENEFIT]'],
  ];
  for (const [title, text, prompt] of expected) {
    const project = state.projects.find(project => project.title === title);
    assert.ok(project); assert.equal(project.productSetId, xls.id);
    assert.equal(project.nodes.length, 1); assert.equal(project.nodes[0].metadata.content, text);
    assert.equal(products.find(product => product.id === project.id)?.attributes['Main Prompt'], prompt);
  }
  const original = state.projects.find(project => project.id === 'excel-existing');
  assert.equal(original.nodes[0].metadata.content, '仅合成数据；导入不能覆盖原有画布。');
  assert.deepEqual(original.nodes[0].position, { x: 100, y: 100 });
  assert.deepEqual(original.viewport, { x: 0, y: 0, k: 1 });
  const bookB = books.find(book => book.source.fileName === 'B.xlsx');
  assert.equal(bookB.productIds.length, 1);
  assert.equal(state.projects.find(project => project.id === bookB.productIds[0]).title, '独立产品B');
  assert.equal(books.some(book => book.source.fileName === 'A.xlsx'), false);
  for (const book of books) {
    const remembered = state.guanWorkbooks.activeByWorkbook[book.id];
    assert.equal(state.projects.find(project => project.id === remembered)?.productSetId, book.id);
  }
  const evidence = { integrity, foreignKeys, documentCount: documents.length,
    documents: documents.map(({ collection, id, hash, revision }) => ({ collection, id, hash, revision })),
    projects: state.projects, workbooks: state.guanWorkbooks };
  writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ integrity, foreignKeys, documentCount: documents.length, projects: state.projects.length,
    workbooks: books.map(book => book.source.fileName), distinctRoutesPreserved: true, cancelledAAbsent: true, output }));
} finally { db.close(); }
