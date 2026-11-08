// 只读检查本轮已正常停止的合成工作区，不打开正式工作区或凭据。
import assert from 'node:assert/strict';
import { existsSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { readFreshRevealCanvas } from './视区跟随原画布夹具.mjs';
import { 根目录 } from './公共.mjs';

const root = resolve(process.argv[2] ?? ''), output = resolve(process.argv[3] ?? '');
if (realpathSync(root) !== root || dirname(root) !== realpathSync(tmpdir()) || !/^guan-delete-visual-[A-Za-z0-9]+$/.test(basename(root))) throw Error('仅接受本批合成工作区');
if (dirname(output) !== join(根目录, '.运行/output/playwright/Excel删除视觉-20261019')) throw Error('输出必须在本批证据目录');
const data = join(root, '数据');
if (existsSync(join(data, '.实例锁.json'))) throw Error('须先正常停止隔离服务');
const db = new DatabaseSync(join(data, '工作台.sqlite'), { readOnly: true });
try {
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
  const documents = db.prepare('SELECT * FROM documents ORDER BY collection,id').all();
  for (const row of documents) assert.equal(createHash('sha256').update(row.body).digest('hex'), row.hash);
  const client = { async readDocument(collection, id) {
    const row = db.prepare('SELECT * FROM documents WHERE collection=? AND id=?').get(collection, id);
    return row ? { collection, id, value: JSON.parse(row.body), revision: row.revision, hash: row.hash,
      mediaIds: db.prepare('SELECT media_id FROM document_media WHERE collection=? AND document_id=? ORDER BY media_id').all(collection, id).map(row => row.media_id) } : null;
  }, async readMedia() { throw Error('本批浏览器合成数据没有媒体'); } };
  const canvas = await readFreshRevealCanvas(client), state = canvas.state, contract = state.guanWorkbooks.contract;
  assert.equal(state.projects.length, 2); assert.equal(state.deletedProjects.length, 0);
  const ids = state.projects.map(p => p.id).sort();
  assert.deepEqual(ids, ['prod_33a98945-f883-458d-aa7f-219017dc3c9e', 'prod_867f286f-5641-42b2-b3e3-3b1b4f86aac3']);
  assert.equal(contract.productSets.length, 1);
  assert.equal(contract.productSets[0].id, 'set_8cd4c464-bf0e-4ffa-b8d8-6264c430065c');
  assert.equal(contract.productSets[0].source.fileName, '同名路线.xlsx');
  assert.equal(contract.tasks.length, 0); assert.equal(contract.products.length, 2);
  assert.equal(contract.workspace.activeProductId, 'prod_33a98945-f883-458d-aa7f-219017dc3c9e');
  const evidence = { integrity: 'ok', foreignKeys: 0, documentCount: documents.length, canvas,
    documentHashes: documents.map(({ collection, id, hash, revision }) => ({ collection, id, hash, revision })),
    冷重开UI验收: false, 原因: '发现字体平滑差异后停止后续验收，仅正常停机并只读保全核验' };
  writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ integrity: 'ok', foreignKeys: 0, documentCount: documents.length, projects: 2, workbooks: 1, syntheticDataIntact: true, output }));
} finally { db.close(); }

