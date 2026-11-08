// 仅检查本轮已停止的合成工作区，不读取正式数据或凭据。
import assert from 'node:assert/strict';
import { existsSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { readFreshRevealCanvas } from './视区跟随原画布夹具.mjs';
import { 根目录 } from './公共.mjs';

const root = resolve(process.argv[2] ?? ''), output = resolve(process.argv[3] ?? '');
if (realpathSync(root) !== root || dirname(root) !== realpathSync(tmpdir()) || !/^guan-delete-smoothing-[A-Za-z0-9]+$/.test(basename(root))) throw Error('仅接受本轮合成工作区');
if (dirname(output) !== join(根目录, '.运行/output/playwright/Excel删除字体平滑-20261020')) throw Error('输出必须在本轮证据目录');
const data = join(root, '数据');
if (existsSync(join(data, '.实例锁.json'))) throw Error('须先正常停止隔离服务');
const db = new DatabaseSync(join(data, '工作台.sqlite'), { readOnly: true });
try {
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
  const documents = db.prepare('SELECT * FROM documents ORDER BY collection,id').all();
  for (const row of documents) assert.equal(createHash('sha256').update(row.body).digest('hex'), row.hash);
  const canvas = await readFreshRevealCanvas({ async readDocument(collection, id) {
    const row = db.prepare('SELECT * FROM documents WHERE collection=? AND id=?').get(collection, id);
    return row ? { collection, id, value: JSON.parse(row.body), revision: row.revision, hash: row.hash,
      mediaIds: db.prepare('SELECT media_id FROM document_media WHERE collection=? AND document_id=? ORDER BY media_id').all(collection, id).map(row => row.media_id) } : null;
  }, async readMedia() { throw Error('本批合成数据没有媒体'); } });
  const state = canvas.state, contract = state.guanWorkbooks.contract;
  assert.deepEqual(state.projects, []); assert.deepEqual(state.deletedProjects, []);
  for (const key of ['products', 'productSets', 'importRecords', 'slots', 'prompts', 'tasks', 'runs', 'providerAttempts', 'assets']) assert.deepEqual(contract[key], [], key);
  assert.equal(contract.workspace.activeProductId, null); assert.equal(contract.workspace.activeProductSetId, null);
  const evidence = { integrity: 'ok', foreignKeys: 0, documentCount: documents.length, canvas,
    documentHashes: documents.map(({ collection, id, hash, revision }) => ({ collection, id, hash, revision })),
    note: '只读冷检；冷重开界面证据另见浏览器日志，不以本工具替代真实UI验收' };
  writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ integrity: 'ok', foreignKeys: 0, documentCount: documents.length, projects: 0, workbooks: 0, output }));
} finally { db.close(); }
