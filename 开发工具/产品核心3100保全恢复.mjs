import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync, backup } from 'node:sqlite';
import { 根目录, 上游目录 } from './公共.mjs';
import { fileMap } from './恢复3100故障现场.mjs';
import { 工作区表摘要 } from './分类容量日常运行.mjs';
import { 核验稳定助手 } from './日常助手部署.mjs';
import { 核验产品日常包, 产品正式数据根 as dataRoot, 产品正式工作区 as uuid } from './产品核心日常运行.mjs';
import { 加载恢复挂载磁盘服务 } from './接入产品恢复挂载隔离副本.mjs';

const expectedLock = { pid: 60988, nonce: '0976a297-8adb-4c85-aa08-4bf5075c0114' };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const save = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
export function 核验本次旧锁(value) { assert.deepEqual(value, expectedLock, '仅允许本次已批准的60988原锁'); }
function idle() {
  assert.equal(spawnSync('lsof', ['-t', '-nP', '-iTCP:3100']).status, 1, '3100仍有连接或监听');
  assert.throws(() => process.kill(expectedLock.pid, 0), { code: 'ESRCH' }, '旧PID仍在，拒绝保全恢复');
  assert.equal(spawnSync('lsof', ['+D', dataRoot]).status, 1, '原数据仍在使用');
  核验本次旧锁(JSON.parse(readFileSync(join(dataRoot, '.实例锁.json'))));
}
// 一次性窄范围保全，绝不删除原锁，不强杀，不执行钥匙串助手。
export async function 产品核心保全恢复(file, digest) {
  idle(); const prepared = 核验产品日常包(file, digest); 核验稳定助手(prepared.baseline);
  assert.equal(lstatSync(dataRoot).mode & 0o777, 0o700);
  const output = mkdtempSync(join(根目录, '.运行/output/产品核心3100保全-'));
  const archive = mkdtempSync('/Users/guanchengbin/Library/Application Support/AI-Workbench-重建版-产品切换保全-');
  const source = fileMap(根目录, ['.git', '.运行', 'node_modules', '.DS_Store']);
  const upstream = { head: git(上游目录, 'rev-parse', 'HEAD').trim(), status: git(上游目录, 'status', '--porcelain=v1', '-uall') };
  const originalFiles = fileMap(dataRoot);
  save(join(output, '开始保护.json'), { date: new Date().toISOString(), source, upstream, originalFiles, archive, dataRoot, oldPID: expectedLock.pid });
  const coldCopy = join(archive, '完整冷拷贝');
  cpSync(dataRoot, coldCopy, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true });
  assert.deepEqual(fileMap(coldCopy), originalFiles); assert.deepEqual(fileMap(dataRoot), originalFiles);
  const snapshot = join(archive, '最新已提交快照'); mkdirSync(snapshot, { mode: 0o700 }); mkdirSync(join(snapshot, '媒体'), { mode: 0o700 });
  // 只打开冷副本，backup读取含WAL的最新已提交事务，不动原数据库。
  const state = 工作区表摘要(coldCopy); assert.equal(state.workspaceId, uuid);
  const db = new DatabaseSync(join(coldCopy, '工作台.sqlite'), { readOnly: true }); let media;
  try {
    media = db.prepare('SELECT * FROM media ORDER BY id').all();
    for (const row of db.prepare('SELECT body,hash FROM documents').all()) assert.equal(hash(row.body), row.hash, '文档SHA不符');
    await backup(db, join(snapshot, '工作台.sqlite'));
  } finally { db.close(); }
  chmodSync(join(snapshot, '工作台.sqlite'), 0o600);
  const files = [{ path: '工作台.sqlite', hash: hash(readFileSync(join(snapshot, '工作台.sqlite'))), size: lstatSync(join(snapshot, '工作台.sqlite')).size }];
  for (const row of media) {
    assert.match(row.id, /^[a-f0-9]{64}$/);
    const bytes = readFileSync(join(coldCopy, '媒体', row.id)); assert.equal(bytes.length, row.size); assert.equal(hash(bytes), row.id);
    writeFileSync(join(snapshot, '媒体', row.id), bytes, { flag: 'wx', mode: 0o600 }); files.push({ path: '媒体/' + row.id, hash: row.id, size: row.size });
  }
  const marker = JSON.parse(readFileSync(join(coldCopy, '.工作区.json'))); assert.equal(marker.workspaceId, uuid);
  save(join(snapshot, '清单.json'), { ...marker, createdAt: new Date().toISOString(), documentCount: state.tables.documents.count, mediaCount: media.length, files });
  const storage = await 加载恢复挂载磁盘服务(prepared.integration), restored = join(archive, '核验恢复工作区');
  storage.restoreBackup({ backupRoot: snapshot, targetRoot: restored });
  const workspace = storage.openWorkspace({ dataRoot: restored, initialize: false }); workspace.close();
  assert.deepEqual(工作区表摘要(restored), state); assert.ok(!existsSync(join(restored, '.实例锁.json')));
  assert.deepEqual(fileMap(join(restored, '媒体')), fileMap(join(snapshot, '媒体')));
  if (existsSync(join(dataRoot, '备份'))) {
    cpSync(join(dataRoot, '备份'), join(restored, '备份'), { recursive: true, errorOnExist: true, force: false });
    chmodSync(join(restored, '备份'), 0o700);
    assert.deepEqual(fileMap(join(restored, '备份')), fileMap(join(dataRoot, '备份')));
  }
  idle(); assert.deepEqual(fileMap(dataRoot), originalFiles);
  assert.deepEqual(fileMap(根目录, ['.git', '.运行', 'node_modules', '.DS_Store']), source);
  assert.deepEqual({ head: git(上游目录, 'rev-parse', 'HEAD').trim(), status: git(上游目录, 'status', '--porcelain=v1', '-uall') }, upstream);
  核验产品日常包(file, digest);
  const original = join(archive, '原工作区含原锁'); renameSync(dataRoot, original);
  try { assert.ok(!existsSync(dataRoot)); renameSync(restored, dataRoot); }
  catch (error) { if (!existsSync(dataRoot)) renameSync(original, dataRoot); throw error; }
  assert.deepEqual(fileMap(original), originalFiles); assert.deepEqual(工作区表摘要(dataRoot), state);
  const receipt = join(output, '恢复验收.json');
  save(receipt, { passed: true, date: new Date().toISOString(), output, archive, original, snapshot, dataRoot, workspaceId: uuid,
    oldPID: expectedLock.pid, originalFiles, state, mediaCount: media.length, manifest: resolve(file), manifestSHA256: digest,
    usedSQLiteBackupIncludingWAL: true, originalLockPreserved: true, credentialsDecryptedByCheck: false, newMasterKeyCreated: false });
  return { passed: true, output, archive, receipt, receiptSHA256: hash(readFileSync(receipt)), documentCount: state.tables.documents.count, mediaCount: media.length };
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  assert.equal(process.argv.length, 5); assert.equal(process.argv[2], '--保全并恢复');
  console.log(JSON.stringify(await 产品核心保全恢复(process.argv[3], process.argv[4])));
}
