import { DatabaseSync, backup } from 'node:sqlite';
import { constants, chmodSync, closeSync, existsSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, rmSync, statfsSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { COLLECTIONS, MAX_MEDIA_BYTES, MEDIA_TYPES, PROTOCOL, SCHEMA_VERSION, StorageError, requireValue, serializeDocument, validHash, validId, validUUID } from './协议.mjs';

import { 清理独占暂存文件 } from '../本机服务/中断文件清理.mjs';
import { 数据磁盘保留字节, 配置SQLite日志, 检查SQLite写入空间 } from './写入空间保护.mjs';
import { readCategorizedUsage } from './分类容量统计.mjs';
import { 复制独立备份文件, 复用相同数据库快照 } from './备份节省空间.mjs';

const DB_NAME = '工作台.sqlite';
const MARKER = '.工作区.json';
const LOCK = '.实例锁.json';
const APPLICATION_ID = 0x47574149;
const RESERVE = 数据磁盘保留字节;
const sourceRoot = fileURLToPath(new URL('../../', import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const within = (child, parent) => child === parent || (!relative(parent, child).startsWith('..') && !isAbsolute(relative(parent, child)));

// 系统 /var -> /private/var 可以规范化；托管根、文件和子目录本身不能是链接。
function safePath(path, directory, mustExist = true) {
  requireValue(typeof path === 'string' && isAbsolute(path), 'unsafe_path', '必须显式提供绝对路径。');
  if (!existsSync(path)) {
    requireValue(!mustExist, 'unsafe_path', '路径不存在。');
    requireValue(!lstatIfPresent(path), 'unsafe_path', '拒绝悬空链接。');
    return;
  }
  const stat = lstatSync(path);
  requireValue(!stat.isSymbolicLink() && (directory ? stat.isDirectory() : stat.isFile() && stat.nlink === 1), 'unsafe_path', '拒绝链接或非预期文件。');
  requireValue(stat.uid === process.getuid() && (stat.mode & 0o022) === 0, 'unsafe_path', '托管路径必须由当前用户拥有且不可被其他用户修改。');
}
function lstatIfPresent(path) { try { return lstatSync(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
function normalizedRoot(path) {
  requireValue(typeof path === 'string' && isAbsolute(path), 'unsafe_path', '数据根须为显式绝对路径。');
  path = resolve(path);
  safePath(path, true, false);
  const parent = realpathSync(dirname(path));
  const root = join(parent, path.slice(dirname(path).length + 1));
  requireValue(root !== '/' && root !== realpathSync(homedir()), 'unsafe_path', '不能使用系统根或用户主目录。');
  const project = realpathSync(sourceRoot);
  const upstream = resolve(project, '../infinite-canvas-upstream');
  const oldProject = join(homedir(), 'CodexProjects/guan-ai-workbench-projects/guan-ai-workbench');
  requireValue(![project, upstream, oldProject].some(protectedRoot => within(root, protectedRoot) || within(protectedRoot, root)), 'unsafe_path', '数据与代码和旧项目必须独立。');
  return root;
}
function durableWrite(path, bytes) {
  const fd = openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
}
function syncDirectory(path) { const fd = openSync(path, constants.O_RDONLY); try { fsyncSync(fd); } finally { closeSync(fd); } }
function readJSON(path) { safePath(path, false); return JSON.parse(readFileSync(path, 'utf8')); }
function inspectDatabase(path, workspaceId) {
  safePath(path, false);
  for (const suffix of ['-wal', '-shm']) safePath(path + suffix, false, false);
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    requireValue(db.prepare('PRAGMA user_version').get().user_version === SCHEMA_VERSION, 'schema_unsupported', '数据库版本未知，停止而不修改。', 409);
    requireValue(db.prepare('PRAGMA application_id').get().application_id === APPLICATION_ID, 'database_corrupt', '数据库身份不匹配。', 409);
    requireValue(db.prepare('PRAGMA integrity_check').get().integrity_check === 'ok' && db.prepare('PRAGMA foreign_key_check').all().length === 0, 'database_corrupt', '数据库完整性检查失败。', 409);
    requireValue(db.prepare("SELECT value FROM workspace WHERE key='id'").get()?.value === workspaceId, 'database_corrupt', '工作区身份不匹配。', 409);
    return db;
  } catch (error) { db.close(); throw error; }
}
function checkMedia(root, row) {
  requireValue(row && validHash(row.id), 'media_not_found', '媒体不存在。', 404);
  safePath(join(root, '媒体'), true);
  const path = join(root, '媒体', row.id);
  requireValue(existsSync(path), 'media_not_found', '媒体文件缺失。', 404);
  safePath(path, false);
  requireValue(lstatSync(path).size === row.size && row.size <= MAX_MEDIA_BYTES, 'media_corrupt', '媒体大小校验失败。', 409);
  const bytes = readFileSync(path);
  requireValue(sha(bytes) === row.id, 'media_corrupt', '媒体哈希校验失败。', 409);
  return { ...row, bytes };
}

export function openWorkspace({ dataRoot, initialize = false, availableBytes, beforeCommit } = {}) {
  const root = normalizedRoot(dataRoot);
  if (!existsSync(root)) {
    requireValue(initialize, 'unknown_data_root', '工作区不存在，须明确初始化。');
    mkdirSync(root, { mode: 0o700 });
  }
  const markerPath = join(root, MARKER), dbPath = join(root, DB_NAME);
  let workspaceId, db, lockOwned = false, closed = false, maintenance = false;
  let previousBackupDatabase = null;
  const nonce = randomUUID();
  if (!existsSync(markerPath)) {
    requireValue(initialize && readdirSync(root).length === 0, 'unknown_data_root', '拒绝接管未知非空目录。');
    chmodSync(root, 0o700);
  } else {
    const marker = readJSON(markerPath);
    requireValue(marker.protocol === PROTOCOL && marker.schemaVersion === SCHEMA_VERSION && validUUID(marker.workspaceId), 'schema_unsupported', '工作区格式未知。', 409);
    workspaceId = marker.workspaceId;
    inspectDatabase(dbPath, workspaceId).close(); // 必须在任何可写连接之前检查版本。
    safePath(join(root, '媒体'), true);
  }
  const lockPath = join(root, LOCK);
  try {
    try { durableWrite(lockPath, JSON.stringify({ pid: process.pid, nonce })); lockOwned = true; }
    catch (error) { if (error.code === 'EEXIST') throw new StorageError('workspace_locked', '工作区已锁定；不强杀进程或自动清锁。', 409); throw error; }
    if (!workspaceId) {
      workspaceId = randomUUID();
      mkdirSync(join(root, '媒体'), { mode: 0o700 });
      durableWrite(dbPath, Buffer.alloc(0));
      db = new DatabaseSync(dbPath);
      db.exec(`PRAGMA application_id=${APPLICATION_ID}; PRAGMA user_version=${SCHEMA_VERSION}; PRAGMA foreign_keys=ON;
        CREATE TABLE workspace (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
        CREATE TABLE documents (collection TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL, revision INTEGER NOT NULL, hash TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(collection,id)) STRICT;
        CREATE TABLE media (id TEXT PRIMARY KEY, mime TEXT NOT NULL, size INTEGER NOT NULL) STRICT;
        CREATE TABLE document_media (collection TEXT NOT NULL, document_id TEXT NOT NULL, media_id TEXT NOT NULL REFERENCES media(id), PRIMARY KEY(collection,document_id,media_id), FOREIGN KEY(collection,document_id) REFERENCES documents(collection,id)) STRICT;
        CREATE TABLE operations (id TEXT PRIMARY KEY, request_hash TEXT NOT NULL, ack TEXT NOT NULL) STRICT;`);
      db.prepare('INSERT INTO workspace VALUES (?,?)').run('id', workspaceId);
      durableWrite(markerPath, JSON.stringify({ protocol: PROTOCOL, schemaVersion: SCHEMA_VERSION, workspaceId }, null, 2));
      syncDirectory(root);
    } else { db = new DatabaseSync(dbPath); }
    db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=3000;');
    配置SQLite日志(db);
    // 数据库锁已经取得，旧进程不可能仍写本目录；只清理未发布的媒体暂存名。
    清理独占暂存文件(join(root, '媒体'), /^\.暂存-[a-f0-9-]{36}$/);
  } catch (error) { db?.close(); if (lockOwned) unlinkSync(lockPath); throw error; }

  let usagePending;
  function active(write = false) {
    requireValue(!closed, 'workspace_closed', '工作区已关闭。', 503);
    requireValue(!write || !maintenance, 'workspace_busy', '工作区正在备份，请稍后重试。', 503);
    safePath(root, true); safePath(dbPath, false);
    for (const suffix of ['-wal', '-shm']) safePath(dbPath + suffix, false, false);
  }
  function space(bytes = 0) {
    检查SQLite写入空间(db, dbPath, root, bytes, availableBytes);
  }
  function transaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); beforeCommit?.(); db.exec('COMMIT'); return result; }
    catch (error) { if (db.isTransaction) db.exec('ROLLBACK'); throw error; }
  }
  function validDocumentKey(collection, id) { requireValue(COLLECTIONS.includes(collection) && validId(id), 'invalid_document', '集合或文档标识无效。'); }
  const store = {
    dataRoot: root, workspaceId,
    readDetailedUsage() {
      active();
      // 同时打开多个容量面板只做一次扫描；结束后不缓存，不影响保存队列。
      if (!usagePending) usagePending = readCategorizedUsage({ dataRoot: root, workspaceId }).finally(() => { usagePending = null; });
      return usagePending;
    },
    readUsage() {
      active();
      const groups = new Map();
      for (const row of db.prepare('SELECT collection,body,length(CAST(body AS BLOB)) AS bytes FROM documents').all()) {
        const value = JSON.parse(row.body);
        const app = row.collection === 'extension' && value.format === 'guan-app-storage.v1' && typeof value.namespace === 'string' && Array.isArray(value.entries);
        const name = app ? value.namespace : row.collection;
        const group = groups.get(name) ?? { name, records: 0, bytes: 0 };
        group.records += app ? value.entries.length : 1; group.bytes += row.bytes; groups.set(name, group);
      }
      const media = db.prepare('SELECT COUNT(*) AS records,coalesce(sum(size),0) AS bytes FROM media').get();
      const contentBytes = [...groups.values()].reduce((sum, row) => sum + row.bytes, media.bytes);
      const databaseBytes = ['', '-wal', '-shm'].reduce((sum, suffix) => sum + (existsSync(dbPath + suffix) ? lstatSync(dbPath + suffix).size : 0), 0);
      const stores = [...groups.values(), { name: 'media_blobs', ...media }];
      // usage是当前数据库/WAL/SHM及已索引媒体，不含备份/孤儿文件；不是浏览器配额。
      return { protocol: PROTOCOL, workspaceId, usage: databaseBytes + media.bytes, quota: null, contentBytes, databases: [{ name: '工作台.sqlite + 媒体', version: SCHEMA_VERSION, bytes: contentBytes, stores }] };
    },
    readDocument(collection, id) {
      active(); validDocumentKey(collection, id);
      const row = db.prepare('SELECT * FROM documents WHERE collection=? AND id=?').get(collection, id);
      if (!row) return null;
      requireValue(sha(row.body) === row.hash, 'database_corrupt', '文档哈希不匹配。', 409);
      return { collection, id, value: JSON.parse(row.body), revision: row.revision, hash: row.hash, updatedAt: row.updated_at, workspaceId,
        mediaIds: db.prepare('SELECT media_id FROM document_media WHERE collection=? AND document_id=? ORDER BY media_id').all(collection, id).map(row => row.media_id) };
    },
    listDocuments(collection) {
      active(); requireValue(COLLECTIONS.includes(collection), 'invalid_document', '集合无效。');
      const rows = db.prepare('SELECT id, revision, hash, updated_at AS updatedAt FROM documents WHERE collection=? ORDER BY id LIMIT 1001').all(collection);
      requireValue(rows.length <= 1000, 'collection_too_large', '本阶段列表超过1000条，请先实现分页，不能静默漏数据。', 409);
      return rows;
    },
    writeDocument({ collection, id, value, expectedRevision, operationId, mediaIds = [] }) {
      active(true);
      requireValue(validUUID(operationId) && Number.isSafeInteger(expectedRevision) && expectedRevision >= 0, 'invalid_write', '保存必须带操作ID和预期版本。');
      const body = serializeDocument(collection, id, value, mediaIds), hash = sha(body);
      const requestHash = sha(JSON.stringify({ collection, id, body, expectedRevision, mediaIds: [...mediaIds].sort() }));
      space(Buffer.byteLength(body));
      return transaction(() => {
        const previous = db.prepare('SELECT * FROM operations WHERE id=?').get(operationId);
        if (previous) {
          requireValue(previous.request_hash === requestHash, 'idempotency_conflict', '操作ID已用于其他内容。', 409);
          return JSON.parse(previous.ack);
        }
        const revision = db.prepare('SELECT revision FROM documents WHERE collection=? AND id=?').get(collection, id)?.revision ?? 0;
        requireValue(revision === expectedRevision, 'revision_conflict', '内容已被其他会话修改，请重新读取；没有覆盖。', 409);
        for (const mediaId of mediaIds) checkMedia(root, db.prepare('SELECT * FROM media WHERE id=?').get(mediaId));
        const updatedAt = new Date().toISOString();
        db.prepare('INSERT INTO documents VALUES (?,?,?,?,?,?) ON CONFLICT(collection,id) DO UPDATE SET body=excluded.body,revision=excluded.revision,hash=excluded.hash,updated_at=excluded.updated_at').run(collection, id, body, revision + 1, hash, updatedAt);
        db.prepare('DELETE FROM document_media WHERE collection=? AND document_id=?').run(collection, id);
        const insertRef = db.prepare('INSERT INTO document_media VALUES (?,?,?)');
        for (const mediaId of mediaIds) insertRef.run(collection, id, mediaId);
        const ack = { protocol: PROTOCOL, workspaceId, collection, id, operationId, revision: revision + 1, hash, updatedAt, persisted: true };
        db.prepare('INSERT INTO operations VALUES (?,?,?)').run(operationId, requestHash, JSON.stringify(ack));
        return ack;
      });
    },
    writeMedia(bytes, mime) {
      active(true);
      requireValue(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= MAX_MEDIA_BYTES && MEDIA_TYPES.includes(mime), 'invalid_media', '媒体类型或大小不支持。');
      space(bytes.length);
      const id = sha(bytes), row = db.prepare('SELECT * FROM media WHERE id=?').get(id);
      if (row) { checkMedia(root, row); return row; }
      const folder = join(root, '媒体'); safePath(folder, true);
      const target = join(folder, id), staging = join(folder, `.暂存-${randomUUID()}`);
      let created = false;
      try {
        // 已有相同字节时直接验证并建索引，避免重复写出一整份媒体。
        if (!existsSync(target)) {
          try {
            durableWrite(staging, bytes);
            try { linkSync(staging, target); created = true; } catch (error) { if (error.code !== 'EEXIST') throw error; }
          } finally { if (lstatIfPresent(staging)) unlinkSync(staging); }
          syncDirectory(folder);
        }
        checkMedia(root, { id, mime, size: bytes.length });
        transaction(() => db.prepare('INSERT INTO media VALUES (?,?,?)').run(id, mime, bytes.length));
      } catch (error) {
        // 仅回收本次创建且索引未提交的文件；不触碰之前已有的媒体。
        if (created && !db.prepare('SELECT 1 FROM media WHERE id=?').get(id)) { unlinkSync(target); syncDirectory(folder); }
        throw error;
      }
      return { id, mime, size: bytes.length };
    },
    readMedia(id) { active(); requireValue(validHash(id), 'invalid_media', '媒体标识无效。'); return checkMedia(root, db.prepare('SELECT * FROM media WHERE id=?').get(id)); },
    async createBackup() {
      active(true); space(); maintenance = true;
      let backupTarget = null, backupComplete = false;
      try {
        const parent = join(root, '备份');
        if (!existsSync(parent)) mkdirSync(parent, { mode: 0o700 });
        safePath(parent, true);
        const target = join(parent, randomUUID()); mkdirSync(target, { mode: 0o700 }); backupTarget = target; mkdirSync(join(target, '媒体'), { mode: 0o700 });
        const media = db.prepare('SELECT * FROM media ORDER BY id').all();
        space(media.reduce((sum, row) => sum + row.size, lstatSync(dbPath).size));
        await backup(db, join(target, DB_NAME));
        // SQLite备份创建权限跟随umask，收紧为0600再发布备份清单。
        chmodSync(join(target, DB_NAME), 0o600);
        const snapshot = readFileSync(join(target, DB_NAME));
        const snapshotHash = sha(snapshot);
        复用相同数据库快照(previousBackupDatabase, join(target, DB_NAME), snapshotHash, snapshot.length);
        const dbFd = openSync(join(target, DB_NAME), constants.O_RDONLY); try { fsyncSync(dbFd); } finally { closeSync(dbFd); }
        const files = [{ path: DB_NAME, hash: snapshotHash, size: snapshot.length }];
        for (const row of media) {
          checkMedia(root, row);
          复制独立备份文件(join(root, '媒体', row.id), join(target, '媒体', row.id), row.id, row.size);
          files.push({ path: `媒体/${row.id}`, hash: row.id, size: row.size });
        }
        const manifest = { protocol: PROTOCOL, schemaVersion: SCHEMA_VERSION, workspaceId, createdAt: new Date().toISOString(), documentCount: db.prepare('SELECT COUNT(*) AS count FROM documents').get().count, mediaCount: media.length, files };
        durableWrite(join(target, '清单.json'), JSON.stringify(manifest, null, 2)); syncDirectory(join(target, '媒体')); syncDirectory(target); syncDirectory(parent);
        previousBackupDatabase = { path: join(target, DB_NAME), hash: snapshotHash, size: snapshot.length };
        backupComplete = true;
        return { path: target, workspaceId, documentCount: manifest.documentCount, mediaCount: media.length };
      } finally {
        try { if (backupTarget && !backupComplete) rmSync(backupTarget, { recursive: true, force: true }); }
        finally { maintenance = false; }
      }
    },
    close() {
      if (closed) return;
      requireValue(!maintenance, 'workspace_busy', '备份期间不能关闭。', 503);
      db.close(); closed = true;
      if (readJSON(lockPath).nonce === nonce) { unlinkSync(lockPath); syncDirectory(root); }
    },
  };
  return store;
}

export function restoreBackup({ backupRoot, targetRoot }) {
  const target = normalizedRoot(targetRoot);
  requireValue(!lstatIfPresent(target), 'restore_target_exists', '恢复只能写入全新目录，不覆盖已有数据。', 409);
  let manifest;
  try {
    safePath(backupRoot, true); safePath(join(backupRoot, '媒体'), true);
    manifest = readJSON(join(backupRoot, '清单.json'));
    requireValue(manifest.protocol === PROTOCOL && manifest.schemaVersion === SCHEMA_VERSION && validUUID(manifest.workspaceId) && Array.isArray(manifest.files), 'backup_corrupt', '备份清单无效。');
    const paths = new Set();
    for (const file of manifest.files) {
      requireValue(file.path === DB_NAME || /^媒体\/[0-9a-f]{64}$/.test(file.path), 'backup_corrupt', '备份路径无效。');
      requireValue(!paths.has(file.path) && validHash(file.hash) && Number.isSafeInteger(file.size) && file.size >= 0, 'backup_corrupt', '重复或无效备份条目。'); paths.add(file.path);
      const path = join(backupRoot, file.path); safePath(path, false);
      requireValue(lstatSync(path).size === file.size && sha(readFileSync(path)) === file.hash, 'backup_corrupt', '备份文件校验失败。');
    }
    requireValue(paths.has(DB_NAME), 'backup_corrupt', '备份缺数据库。');
    const db = inspectDatabase(join(backupRoot, DB_NAME), manifest.workspaceId);
    try {
      const media = db.prepare('SELECT * FROM media').all();
      requireValue(media.length === manifest.mediaCount && paths.size === media.length + 1 && db.prepare('SELECT COUNT(*) AS count FROM documents').get().count === manifest.documentCount, 'backup_corrupt', '备份条数不一致。');
      for (const row of media) { requireValue(paths.has(`媒体/${row.id}`), 'backup_corrupt', '备份缺媒体索引。'); checkMedia(backupRoot, row); }
      for (const row of db.prepare('SELECT * FROM documents').all()) {
        requireValue(sha(row.body) === row.hash, 'backup_corrupt', '文档损坏。');
        serializeDocument(row.collection, row.id, JSON.parse(row.body), db.prepare('SELECT media_id FROM document_media WHERE collection=? AND document_id=?').all(row.collection, row.id).map(ref => ref.media_id));
      }
    } finally { db.close(); }
  } catch { throw new StorageError('backup_corrupt', '备份损坏或格式未知，未创建恢复目标。', 409); }
  const fs = statfsSync(dirname(target));
  requireValue(fs.bavail * fs.bsize >= RESERVE + manifest.files.reduce((sum, file) => sum + file.size * 2, 0), 'insufficient_space', '恢复空间不足。', 507);
  // 验证全部成功才创建；中途I/O失败也保留目标，不删除任何数据。
  mkdirSync(target, { mode: 0o700 }); mkdirSync(join(target, '媒体'), { mode: 0o700 });
  for (const file of manifest.files) durableWrite(join(target, file.path), readFileSync(join(backupRoot, file.path)));
  durableWrite(join(target, MARKER), JSON.stringify({ protocol: PROTOCOL, schemaVersion: SCHEMA_VERSION, workspaceId: manifest.workspaceId }, null, 2));
  syncDirectory(join(target, '媒体')); syncDirectory(target); syncDirectory(dirname(target));
  return { workspaceId: manifest.workspaceId, dataRoot: target };
}
