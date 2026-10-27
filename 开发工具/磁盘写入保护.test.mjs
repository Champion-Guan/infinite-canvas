import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, existsSync, realpathSync, truncateSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { 创建有界运行日志 } from '../扩展功能/本机服务/有界运行日志.mjs';
import { 检查目录容量, 读取目录字节 } from '../扩展功能/本机服务/目录容量限制.mjs';
import { 清理更新缓存, 检查更新缓存, 更新下载缓存上限 } from '../扩展功能/软件更新/更新缓存限制.mjs';
import { 清理过期安装版本, 清理已完成Web安装 } from '../扩展功能/客户安装/安装版本清理.mjs';
import { 占用Web构建目录 } from './Web构建占用保护.mjs';
import { openWorkspace } from '../扩展功能/本机存储/SQLite工作区.mjs';
import { WAL检查阈值 } from '../扩展功能/本机存储/写入空间保护.mjs';
import { writeState } from '../扩展功能/客户安装/Web安装目录.mjs';
import { WEB_ORIGIN, WEB_APP, WEB_MANIFEST_NAMES } from '../扩展功能/客户安装/Web发布协议.mjs';

function temporary(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), '磁盘写入保护-')));
  t.after(() => rmSync(root, { recursive: true, force: true })); return root;
}

test('日志持续轮换始终最多3份；旧超大日志保留尾部；超阈值后仍能记录新故障', t => {
  const root = temporary(t), file = join(root, '服务.log');
  for (const name of ['服务.log', '服务.log.1', '服务.log.2']) writeFileSync(join(root, name), 'a'.repeat(1024) + 'b'.repeat(1024));
  const log = 创建有界运行日志(file, { maxBytes: 1024, files: 3 });
  assert.equal(读取目录字节(root), 3072);
  assert.equal(readFileSync(file, 'utf8'), 'b'.repeat(1024));
  for (let minute = 0; minute < 50; minute++) {
    for (let i = 0; i < 100; i++) log.write('x'.repeat(64));
    assert.ok(读取目录字节(root) <= 3072);
    assert.ok(statSync(file).size <= 1024);
  }
  log.write('轮换后发生的新故障');
  assert.equal(readdirSync(root).length, 3); assert.equal(log.getStatus().disabled, false);
  assert.equal(log.getStatus().droppedBytes, 0);
  assert.ok(readFileSync(file, 'utf8').endsWith('轮换后发生的新故障'));
});
test('日志或生成目录含链接时拒绝写入，不修改链接目标', t => {
  const root = temporary(t), secret = join(root, '客户数据'); writeFileSync(secret, 'keep');
  symlinkSync(secret, join(root, '服务.log'));
  const log = 创建有界运行日志(join(root, '服务.log')); log.write('overwrite');
  assert.equal(log.getStatus().disabled, true); assert.equal(readFileSync(secret, 'utf8'), 'keep');
  assert.throws(() => 读取目录字节(root), e => e.code === 'disk_budget_unsafe_path');
  unlinkSync(join(root, '服务.log')); log.write('故障恢复后的日志');
  assert.equal(log.getStatus().disabled, false);
  assert.equal(readFileSync(join(root, '服务.log'), 'utf8'), '故障恢复后的日志');
});
test('目录容量和最低磁盘余量在新写入前拒绝，原文件保持', t => {
  const root = temporary(t); writeFileSync(join(root, '原文件'), 'keep');
  assert.throws(() => 检查目录容量(root, { maxBytes: 10, incomingBytes: 7, reserveBytes: 1, availableBytes: 100 }), e => e.code === 'disk_budget_exceeded');
  assert.throws(() => 检查目录容量(root, { maxBytes: 10, incomingBytes: 5, reserveBytes: 10, availableBytes: 14 }), e => e.code === 'disk_space_insufficient');
  assert.equal(readFileSync(join(root, '原文件'), 'utf8'), 'keep');
  assert.equal(检查目录容量(root, { maxBytes: 10, incomingBytes: 5, reserveBytes: 10, availableBytes: 15 }).used, 4);
  assert.throws(() => 检查更新缓存(root, 更新下载缓存上限), e => e.code === 'download_cache_limit');
});

test('历史重复下载及半成品收敛为一个包，安装成功清零，其他目录不受影响', async t => {
  const root = temporary(t), names = ['清单.json', '清单.sig'];
  const downloads = [];
  for (let i = 0; i < 5; i++) {
    const id = 'verified-' + randomUUID(), folder = join(root, id); mkdirSync(folder, { mode: 0o700 });
    writeFileSync(join(folder, names[0]), JSON.stringify({ version: i ? '2.0.0' : '1.0.0' }));
    writeFileSync(join(folder, 'package.zip'), 'synthetic-package'); downloads.push(id);
  }
  const partial = join(root, 'verified-' + randomUUID()); mkdirSync(partial, { mode: 0o700 }); writeFileSync(join(partial, 'package.part'), 'partial');
  mkdirSync(join(root, '客户数据')); writeFileSync(join(root, '客户数据/文件'), 'keep');
  await 清理更新缓存(root, { keep: downloads[1] });
  assert.deepEqual(readdirSync(root).sort(), [downloads[1], '客户数据'].sort());
  // 安装后清理只淘汰已安装版本，保护可能正在下载的新版本半成品。
  mkdirSync(partial, { mode: 0o700 }); writeFileSync(join(partial, 'package.part'), 'new-download');
  await 清理更新缓存(root, { currentVersion: '2.0.0', manifestNames: names, installedOnly: true });
  assert.equal(existsSync(join(root, downloads[1])), false); assert.equal(existsSync(partial), true);
  await 清理更新缓存(root, { currentVersion: '2.0.0', manifestNames: names });
  assert.deepEqual(readdirSync(root), ['客户数据']);
  assert.equal(readFileSync(join(root, '客户数据/文件'), 'utf8'), 'keep');
});

test('仅保留当前、回退与待安装版本；启动回收中断解压，不触及外部数据', async t => {
  const root = temporary(t), paths = { root, versions: join(root, '版本'), state: join(root, '当前版本.json') }; mkdirSync(paths.versions, { mode: 0o700 });
  const identity = n => ({ name: `2.0.${n}-${String(n).repeat(40)}`, version: `2.0.${n}`, commit: String(n).repeat(40), origin: WEB_ORIGIN, dataSchema: 1 });
  for (let n = 1; n <= 4; n++) mkdirSync(join(paths.versions, identity(n).name), { mode: 0o700 });
  mkdirSync(join(paths.versions, '暂存-' + randomUUID()), { mode: 0o700 });
  await writeState(paths.state, { app: WEB_APP, phase: 'committed', current: identity(3), previous: identity(2) });
  await writeState(join(root, '待安装版本.json'), { next: identity(4) });
  assert.equal((await 清理过期安装版本(paths, { clearInterrupted: true })).removed, 2);
  assert.deepEqual(readdirSync(paths.versions).sort(), [2, 3, 4].map(n => identity(n).name));
});

test('客户包构建互斥；下次构建回收中断半成品，释放后可再次构建', t => {
  const root = temporary(t), parent = join(root, 'Web客户包'); mkdirSync(parent);
  mkdirSync(join(parent, '构建-Ab1234/构建缓存'), { recursive: true }); writeFileSync(join(parent, '构建-Ab1234/构建缓存/遗留'), 'partial');
  const release = 占用Web构建目录(parent);
  try { assert.equal(existsSync(join(parent, '构建-Ab1234')), false); assert.throws(() => 占用Web构建目录(parent), /已有客户包构建/); }
  finally { release(); }
  assert.equal(existsSync(join(parent, '.构建锁.json')), false);
  const again = 占用Web构建目录(parent); again();
});

test('SQLite长读事务阻止日志回收时停止扩张，释放后可继续保存且旧数据保留', t => {
  const root = temporary(t), store = openWorkspace({ dataRoot: root, initialize: true });
  const dbPath = join(root, '工作台.sqlite');
  let revision = 0;
  const put = () => store.writeDocument({ collection: 'extension', id: 'bounded-wal', value: { content: String.fromCharCode(65 + revision % 20).repeat(1024 * 1024), step: revision }, expectedRevision: revision, operationId: randomUUID() });
  revision = put().revision;
  const reader = new DatabaseSync(dbPath, { readOnly: true });
  try {
    reader.exec('BEGIN'); reader.prepare('SELECT count(*) FROM documents').get();
    let blocked = false;
    for (let i = 0; i < 40; i++) {
      try { revision = put().revision; }
      catch (error) { assert.equal(error.code, 'workspace_busy'); blocked = true; break; }
    }
    assert.equal(blocked, true);
    const size = statSync(dbPath + '-wal').size;
    assert.ok(size < WAL检查阈值 + 8 * 1024 ** 2);
    assert.equal(store.readDocument('extension', 'bounded-wal').revision, revision);
    reader.exec('ROLLBACK');
    revision = put().revision;
    assert.equal(store.readDocument('extension', 'bounded-wal').revision, revision);
    assert.ok(statSync(dbPath + '-wal').size < WAL检查阈值);
  } finally { if (reader.isTransaction) reader.exec('ROLLBACK'); reader.close(); store.close(); }
});


test('客户包累计超过预算拒绝新构建，锁释放且旧安装包保留', t => {
  const root = temporary(t), parent = join(root, 'Web客户包'); mkdirSync(parent);
  const archive = join(parent, '已有安装包.zip'); writeFileSync(archive, '');
  // 稀疏文件只占逻辑长度，用于容量门禁，不实际写入数GiB数据。
  truncateSync(archive, 3 * 1024 ** 3);
  assert.throws(() => 占用Web构建目录(parent), e => e.code === 'disk_budget_exceeded');
  assert.equal(existsSync(join(parent, '.构建锁.json')), false);
  assert.equal(statSync(archive).size, 3 * 1024 ** 3);
});


test('升级未提交时保留包；健康确认提交后自动删除包与待安装状态，保留当前及上一运行版本', async t => {
  const root = temporary(t), paths = { root, versions: join(root, '版本'), state: join(root, '当前版本.json') };
  mkdirSync(paths.versions, { mode: 0o700 });
  const identity = n => ({ name: `2.0.${n}-${String(n).repeat(40)}`, version: `2.0.${n}`, commit: String(n).repeat(40), origin: WEB_ORIGIN, dataSchema: 1 });
  for (const n of [1, 2]) mkdirSync(join(paths.versions, identity(n).name), { mode: 0o700 });
  const downloads = join(root, '下载'); mkdirSync(downloads, { mode: 0o700 });
  const cache = join(downloads, 'verified-' + randomUUID()); mkdirSync(cache, { mode: 0o700 });
  writeFileSync(join(cache, WEB_MANIFEST_NAMES[0]), JSON.stringify({ version: '2.0.2' }));
  writeFileSync(join(cache, 'package.zip'), 'signed-package');
  await writeState(join(root, '待安装版本.json'), { next: identity(2) });
  await writeState(paths.state, { app: WEB_APP, phase: 'switching', current: identity(1), target: identity(2) });
  await assert.rejects(清理已完成Web安装(paths, downloads), e => e.code === 'update_activation_unconfirmed');
  assert.equal(existsSync(cache), true);
  await writeState(paths.state, { app: WEB_APP, phase: 'committed', current: identity(2), previous: identity(1) });
  await 清理已完成Web安装(paths, downloads);
  assert.deepEqual(readdirSync(downloads), []);
  assert.equal(existsSync(join(root, '待安装版本.json')), false);
  assert.equal(readdirSync(paths.versions).length, 2);
});
