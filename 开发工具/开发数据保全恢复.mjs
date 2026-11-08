// 开发工作区崩溃恢复：只处理确已退出的实例，原目录含锁/WAL整体保留。
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync, backup } from 'node:sqlite';
import { restoreBackup } from '../.运行/3100源/服务包/扩展功能/本机存储/SQLite工作区.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dataRoot = '/Users/guanchengbin/Library/Application Support/AI-Workbench-重建版/工作区';
const workspaceId = '931e75c3-5f4d-4152-ab4b-6b63478fb1c0';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function inventory(directory) {
  const files = {};
  const walk = (relative = '') => { for (const name of readdirSync(join(directory, relative)).sort()) {
    const path = relative ? relative + '/' + name : name, stat = lstatSync(join(directory, path));
    assert.ok(!stat.isSymbolicLink());
    if (stat.isDirectory()) walk(path);
    else { assert.ok(stat.isFile() && stat.nlink === 1); files[path] = sha(readFileSync(join(directory, path))); }
  } };
  walk(); return files;
}
function summarize(db) {
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
  assert.equal(db.prepare("SELECT value FROM workspace WHERE key='id'").get().value, workspaceId);
  const tables = {};
  for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()) {
    assert.match(name, /^[A-Za-z_][A-Za-z0-9_]*$/);
    const rows = db.prepare('SELECT * FROM "' + name + '"').all().map(row => JSON.stringify(row)).sort();
    tables[name] = { count: rows.length, sha256: sha(JSON.stringify(rows)) };
  }
  return { workspaceId, tables };
}
export async function 保全恢复遗留锁() {
  const lockPath = join(dataRoot, '.实例锁.json');
  if (!existsSync(lockPath)) return { recovered: false, reason: '没有遗留锁' };
  const lockBytes = readFileSync(lockPath), lock = JSON.parse(lockBytes);
  assert.ok(Number.isSafeInteger(lock.pid) && lock.pid > 0);
  const idle = () => {
    assert.equal(spawnSync('lsof', ['-t', '-nP', '-iTCP:3100', '-sTCP:LISTEN']).status, 1, '3100仍有监听');
    assert.equal(spawnSync('lsof', ['+D', dataRoot]).status, 1, '数据仍被使用');
    assert.throws(() => process.kill(lock.pid, 0), { code: 'ESRCH' }, '原实例仍在运行');
    assert.ok(readFileSync(lockPath).equals(lockBytes), '锁身份发生变化');
  };
  idle();
  const archive = mkdtempSync('/Users/guanchengbin/Library/Application Support/AI-Workbench-重建版-开发模式保全-');
  chmodSync(archive, 0o700);
  const before = inventory(dataRoot), cold = join(archive, '完整冷拷贝');
  cpSync(dataRoot, cold, { recursive: true, preserveTimestamps: true, force: false, errorOnExist: true });
  assert.deepEqual(inventory(cold), before); assert.deepEqual(inventory(dataRoot), before);
  const snapshot = join(archive, '已提交快照'); mkdirSync(snapshot, { mode: 0o700 }); mkdirSync(join(snapshot, '媒体'), { mode: 0o700 });
  const db = new DatabaseSync(join(cold, '工作台.sqlite'), { readOnly: true }); let state, media;
  try {
    state = summarize(db); media = db.prepare('SELECT * FROM media ORDER BY id').all();
    for (const row of db.prepare('SELECT body,hash FROM documents').all()) assert.equal(sha(row.body), row.hash);
    await backup(db, join(snapshot, '工作台.sqlite'));
  } finally { db.close(); }
  chmodSync(join(snapshot, '工作台.sqlite'), 0o600);
  const bytes = readFileSync(join(snapshot, '工作台.sqlite'));
  const files = [{ path: '工作台.sqlite', hash: sha(bytes), size: bytes.length }];
  for (const row of media) {
    assert.match(row.id, /^[a-f0-9]{64}$/);
    const content = readFileSync(join(cold, '媒体', row.id));
    assert.equal(content.length, row.size); assert.equal(sha(content), row.id);
    writeFileSync(join(snapshot, '媒体', row.id), content, { flag: 'wx', mode: 0o600 });
    files.push({ path: '媒体/' + row.id, hash: row.id, size: row.size });
  }
  const marker = JSON.parse(readFileSync(join(cold, '.工作区.json'))); assert.equal(marker.workspaceId, workspaceId);
  writeFileSync(join(snapshot, '清单.json'), JSON.stringify({ ...marker, createdAt: new Date().toISOString(), documentCount: state.tables.documents.count, mediaCount: media.length, files }), { flag: 'wx', mode: 0o600 });
  const recovered = join(archive, '核验恢复工作区'); restoreBackup({ backupRoot: snapshot, targetRoot: recovered });
  const check = new DatabaseSync(join(recovered, '工作台.sqlite'), { readOnly: true });
  try { assert.deepEqual(summarize(check), state); } finally { check.close(); }
  if (existsSync(join(dataRoot, '备份'))) cpSync(join(dataRoot, '备份'), join(recovered, '备份'), { recursive: true, force: false, errorOnExist: true });
  assert.ok(!existsSync(join(recovered, '.实例锁.json')));
  assert.deepEqual(inventory(join(recovered, '媒体')), inventory(join(snapshot, '媒体')));
  idle(); assert.deepEqual(inventory(dataRoot), before);
  const original = join(archive, '原工作区含原锁'); renameSync(dataRoot, original);
  try { renameSync(recovered, dataRoot); }
  catch (error) { if (!existsSync(dataRoot)) renameSync(original, dataRoot); throw error; }
  assert.deepEqual(inventory(original), before);
  const receipt = { recovered: true, date: new Date().toISOString(), dataRoot, archive, original, snapshot,
    workspaceId, previousPID: lock.pid, originalLockPreserved: true, state, masterKeyChanged: false };
  writeFileSync(join(archive, '保全恢复记录.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  mkdirSync(join(root, '.运行/开发版3100'), { recursive: true, mode: 0o700 });
  writeFileSync(join(root, '.运行/开发版3100/数据恢复记录.json'), JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
  return { recovered: true, archive, workspaceId, documents: state.tables.documents.count, media: media.length };
}
if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) console.log(JSON.stringify(await 保全恢复遗留锁()));
