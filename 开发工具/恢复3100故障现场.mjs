import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync, backup } from 'node:sqlite';
import { 根目录, 上游目录 } from './公共.mjs';
import { 核验日常运行包 } from './日常运行包.mjs';
import { 核验稳定助手 } from './日常助手部署.mjs';
import { 加载SQLite写入协调隔离服务 } from './接入SQLite写入协调隔离服务.mjs';

// 一次故障的保全恢复，不作为自动清锁机制；原目录连同锁/WAL整体保留。
const dataRoot = '/Users/guanchengbin/Library/Application Support/AI-Workbench-重建版/工作区';
const digest = 'a44877449e31671952933ddd7a1b5e1f3acaa12aa7479a6395d4aa94d104b1ed';
const uuid = '931e75c3-5f4d-4152-ab4b-6b63478fb1c0';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const save = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
export function fileMap(root, exclude = []) {
  const result = {};
  function walk(relative = '') {
    for (const name of readdirSync(join(root, relative)).sort()) {
      if (exclude.includes(name)) continue;
      const path = relative ? relative + '/' + name : name, stat = lstatSync(join(root, path));
      assert.ok(!stat.isSymbolicLink(), '不接受链接');
      if (stat.isDirectory()) walk(path);
      else { assert.ok(stat.isFile() && stat.nlink === 1); result[path] = hash(readFileSync(join(root, path))); }
    }
  }
  walk(); return result;
}
function idle() {
  assert.equal(spawnSync('lsof', ['-t', '-nP', '-iTCP:3100', '-sTCP:LISTEN']).status, 1, '3100有监听');
  assert.throws(() => process.kill(59758, 0), { code: 'ESRCH' }, '故障PID仍在');
  const opened = spawnSync('lsof', ['+D', dataRoot], { encoding: 'utf8' });
  assert.equal(opened.status, 1, '数据目录仍有使用者');
}
function databaseState(db) {
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
  assert.equal(db.prepare("SELECT value FROM workspace WHERE key='id'").get().value, uuid);
  const state = {};
  for (const table of ['workspace', 'documents', 'media', 'document_media', 'operations']) {
    const rows = db.prepare('SELECT * FROM ' + table).all().map(row => JSON.stringify(row)).sort();
    state[table] = { count: rows.length, sha256: hash(JSON.stringify(rows)) };
  }
  return state;
}
export async function recover() {
  assert.deepEqual(process.argv.slice(2), ['--保全并恢复']); idle();
  const prepared = 核验日常运行包(join(根目录, '.运行/SQLite日常准备-UWriM2/准备清单.json'), digest);
  核验稳定助手(prepared);
  assert.equal(lstatSync(dataRoot).mode & 0o777, 0o700);
  assert.deepEqual(JSON.parse(readFileSync(join(dataRoot, '.实例锁.json'))), { pid: 59758, nonce: 'f4699d3e-56e3-42e4-af58-1c27c9a35644' });
  const evidence = mkdtempSync(join(根目录, '.运行/output/SQLite退出恢复-'));
  const source = fileMap(根目录, ['.git', '.运行', 'node_modules', '.DS_Store']);
  const upstream = { head: git(上游目录, 'rev-parse', 'HEAD').trim(), status: git(上游目录, 'status', '--porcelain=v1', '-uall') };
  const archive = mkdtempSync('/Users/guanchengbin/Library/Application Support/AI-Workbench-重建版-故障保全-');
  chmodSync(archive, 0o700);
  const originalFiles = fileMap(dataRoot);
  save(join(evidence, '开始保护.json'), { date: new Date().toISOString(), source, upstream, gitStatus: git(根目录, 'status', '--porcelain=v1', '-uall'), originalFiles, archive });
  const coldCopy = join(archive, '完整冷拷贝');
  cpSync(dataRoot, coldCopy, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true });
  assert.deepEqual(fileMap(coldCopy), originalFiles);
  assert.deepEqual(fileMap(dataRoot), originalFiles);
  // 仅打开副本，由SQLite备份API读取WAL中的已提交事务；原现场不打开数据库。
  const snapshot = join(archive, '最新已提交快照'); mkdirSync(snapshot, { mode: 0o700 }); mkdirSync(join(snapshot, '媒体'), { mode: 0o700 });
  const db = new DatabaseSync(join(coldCopy, '工作台.sqlite'), { readOnly: true });
  let state, media, documentCount;
  try {
    state = databaseState(db); media = db.prepare('SELECT * FROM media ORDER BY id').all(); documentCount = state.documents.count;
    for (const row of db.prepare('SELECT body,hash FROM documents').all()) assert.equal(hash(row.body), row.hash);
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
  save(join(snapshot, '清单.json'), { ...marker, createdAt: new Date().toISOString(), documentCount, mediaCount: media.length, files });
  const storage = await 加载SQLite写入协调隔离服务(prepared.serviceIntegration);
  const restored = join(archive, '核验恢复工作区'); storage.restoreBackup({ backupRoot: snapshot, targetRoot: restored });
  const workspace = storage.openWorkspace({ dataRoot: restored }); workspace.close();
  const check = new DatabaseSync(join(restored, '工作台.sqlite'), { readOnly: true });
  try { assert.deepEqual(databaseState(check), state); } finally { check.close(); }
  assert.ok(!existsSync(join(restored, '.实例锁.json')));
  // 历史备份不丢失，原工作区整个原子归档；不删除或覆盖任何锁。
  if (existsSync(join(dataRoot, '备份'))) {
    cpSync(join(dataRoot, '备份'), join(restored, '备份'), { recursive: true, errorOnExist: true, force: false });
    chmodSync(join(restored, '备份'), lstatSync(join(dataRoot, '备份')).mode & 0o777);
  }
  idle(); assert.deepEqual(fileMap(dataRoot), originalFiles);
  assert.deepEqual(fileMap(根目录, ['.git', '.运行', 'node_modules', '.DS_Store']), source);
  const original = join(archive, '原工作区含原锁'); renameSync(dataRoot, original);
  assert.ok(!existsSync(dataRoot)); renameSync(restored, dataRoot);
  assert.deepEqual(fileMap(original), originalFiles);
  save(join(evidence, '恢复验收.json'), { passed: true, date: new Date().toISOString(), evidence, archive, original, snapshot, dataRoot, workspaceId: uuid, state, mediaCount: media.length, usedSQLiteBackupIncludingWAL: true, originalLockPreserved: true, oldCredentialsRead: false, newMasterKeyCreated: false });
  console.log(JSON.stringify({ passed: true, evidence, archive, documentCount, mediaCount: media.length, originalLockPreserved: true }));
}
if (process.argv[1]?.endsWith('/恢复3100故障现场.mjs') || process.argv[1] === '开发工具/恢复3100故障现场.mjs') {
  if (process.argv[2] === '--修正归档位置') {
    assert.equal(process.argv.length, 3); idle();
    const oldArchive = '/Users/guanchengbin/Library/Application Support/AI-Workbench-重建版/故障保全-LzjUIz';
    const archive = '/Users/guanchengbin/Library/Application Support/AI-Workbench-重建版-故障保全-LzjUIz';
    assert.ok(!existsSync(archive)); assert.ok(!existsSync(join(dataRoot, '.实例锁.json')));
    const before = fileMap(oldArchive); renameSync(oldArchive, archive); assert.deepEqual(fileMap(archive), before);
    save(join(根目录, '.运行/output/SQLite退出恢复-pTuz3S/归档位置修正.json'), { date: new Date().toISOString(), oldArchive, archive, reason: '日常容器只允许工作区子目录，归档改放同级独立目录；原启动失败安全释放监听且未读取Keychain。', allFilesUnchanged: true });
    console.log(JSON.stringify({ archive, allFilesUnchanged: true }));
  } else await recover();
}
