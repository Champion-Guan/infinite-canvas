import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync, backup } from 'node:sqlite';
import { 根目录, 上游目录 } from './公共.mjs';
import { 检查运行副本 } from './检查运行副本.mjs';
import { 工作区表摘要 } from './分类容量日常运行.mjs';
import { 核验Excel完整日常包 } from './Excel完整日常运行.mjs';
import { 加载Excel删除字体平滑磁盘服务 } from './接入Excel删除字体平滑隔离副本.mjs';
import { 核验稳定助手 } from './日常助手部署.mjs';
import { fileMap } from './恢复3100故障现场.mjs';
import { 安全目录, 安全文件 } from './日常运行包.mjs';

// 一次性授权目标，不提供任意PID/数据路径，不作为通用强杀或清锁入口。
assert.ok(process.argv.length === 3 && ['--预检', '--已批准仅保全停机2017'].includes(process.argv[2]));
const pid = 2017, digest = '203c61ecc3a062279b750dc32524397d6b73d3b194330b62dd2d610e26b09d0e';
const expectedLock = { pid, nonce: 'f8c74d0d-ffc5-4904-8701-3df04c734bd8' };
const dataRoot = '/Users/guanchengbin/Library/Application Support/AI-Workbench-重建版/工作区';
const uuid = '931e75c3-5f4d-4152-ab4b-6b63478fb1c0';
const sha = value => createHash('sha256').update(value).digest('hex');
const exec = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8' });
const save = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
const manifest = join(根目录, '.运行/SQLiteExcel完整日常准备-xJQ3kI/准备清单.json');
const prepared = 核验Excel完整日常包(manifest, digest);
核验稳定助手(prepared.baseline); 检查运行副本();
function identity() {
  安全目录(dataRoot, true); 安全文件(join(dataRoot, '.实例锁.json'));
  assert.equal(exec('lsof', ['-t', '-nP', '-iTCP:3100', '-sTCP:LISTEN']).trim(), String(pid));
  const cmd = exec('ps', ['-p', String(pid), '-o', 'command=']).trim();
  assert.equal(cmd, "/opt/homebrew/Cellar/node@24/24.16.0/bin/node /Users/guanchengbin/Desktop/AI-Workbench/Guan二次开发/开发工具/Excel日常运行.mjs --启动 /Users/guanchengbin/Desktop/AI-Workbench/Guan二次开发/.运行/SQLiteExcel日常准备-8jnfqt/准备清单.json 6bcdb241e40a0615d61698131681f13b863b566575d929ba250d85d347d5342b /Users/guanchengbin/Desktop/AI-Workbench/Guan二次开发/.运行/output/Excel3100切换-UUWIDv/切换前备份.json 9843f9cbfba38f538e7b5d742f1a2c1078eb239ea12b4d48f38cfb8ee4aaeac4 --已保存并关闭");
  assert.equal(exec('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn']).split('\n').find(line => line.startsWith('n')), 'n' + resolve(根目录));
  assert.ok(exec('lsof', ['-a', '-p', String(pid), '-d', '0']).includes('(revoked)'));
  assert.ok(!exec('lsof', ['-nP', '-iTCP:3100']).includes('ESTABLISHED'));
  assert.equal(exec('ps', ['-p', String(pid), '-o', 'lstart=']).trim(), 'Mon Oct 19 20:49:24 2026');
  assert.deepEqual(JSON.parse(readFileSync(join(dataRoot, '.实例锁.json'))), expectedLock);
  return cmd;
}
const command = identity();
if (process.argv[2] === '--预检') { console.log(JSON.stringify({ passed: true, pid, command, manifest, manifestSHA256: digest, revokedInput: true, activeConnections: 0, killed: false, helperExecuted: false })); process.exit(0); }
const output = mkdtempSync(join(根目录, '.运行/output/Excel完整3100保全-'));
const sourceBefore = fileMap(根目录, ['.git', '.运行', 'node_modules', '.DS_Store']);
const upstreamBefore = { head: exec('git', ['-C', 上游目录, 'rev-parse', 'HEAD']).trim(), status: exec('git', ['-C', 上游目录, 'status', '--porcelain=v1', '-uall']) };
save(join(output, '停机授权核验.json'), { date: new Date().toISOString(), pid, command, currentSavedClosedConfirmed: true, revokedInput: true, exceptionExplicitlyApproved: true });
identity(); process.kill(pid, 'SIGKILL');
for (let i = 0; i < 50; i++) {
  if (spawnSync('lsof', ['-t', '-nP', '-iTCP:3100', '-sTCP:LISTEN']).status === 1) break;
  await new Promise(resolve => setTimeout(resolve, 100));
}
assert.equal(spawnSync('lsof', ['-t', '-nP', '-iTCP:3100', '-sTCP:LISTEN']).status, 1);
assert.equal(spawnSync('lsof', ['+D', dataRoot]).status, 1);
const archive = mkdtempSync('/Users/guanchengbin/Library/Application Support/AI-Workbench-重建版-Excel完整切换保全-');
chmodSync(archive, 0o700);
const originalFiles = fileMap(dataRoot), coldCopy = join(archive, '完整冷拷贝');
save(join(output, '原现场文件指纹.json'), { archive, originalFiles });
cpSync(dataRoot, coldCopy, { recursive: true, force: false, errorOnExist: true, preserveTimestamps: true });
assert.deepEqual(fileMap(coldCopy), originalFiles); assert.deepEqual(fileMap(dataRoot), originalFiles);
const state = 工作区表摘要(coldCopy); assert.equal(state.workspaceId, uuid);
const snapshot = join(archive, '已提交快照'); mkdirSync(snapshot, { mode: 0o700 }); mkdirSync(join(snapshot, '媒体'), { mode: 0o700 });
const db = new DatabaseSync(join(coldCopy, '工作台.sqlite'), { readOnly: true }); let media;
try {
  for (const row of db.prepare('SELECT body,hash FROM documents').all()) assert.equal(sha(row.body), row.hash);
  media = db.prepare('SELECT * FROM media ORDER BY id').all();
  await backup(db, join(snapshot, '工作台.sqlite'));
} finally { db.close(); }
chmodSync(join(snapshot, '工作台.sqlite'), 0o600);
const bytes = readFileSync(join(snapshot, '工作台.sqlite'));
const files = [{ path: '工作台.sqlite', hash: sha(bytes), size: bytes.length }];
for (const row of media) {
  assert.match(row.id, /^[a-f0-9]{64}$/);
  const content = readFileSync(join(coldCopy, '媒体', row.id));
  assert.equal(content.length, row.size); assert.equal(sha(content), row.id);
  writeFileSync(join(snapshot, '媒体', row.id), content, { flag: 'wx', mode: 0o600 });
  files.push({ path: '媒体/' + row.id, hash: row.id, size: row.size });
}
const marker = JSON.parse(readFileSync(join(coldCopy, '.工作区.json'))); assert.equal(marker.workspaceId, uuid);
save(join(snapshot, '清单.json'), { ...marker, createdAt: new Date().toISOString(), documentCount: state.tables.documents.count, mediaCount: media.length, files });
const storage = await 加载Excel删除字体平滑磁盘服务(prepared.integration), recovered = join(archive, '核验恢复工作区');
storage.restoreBackup({ backupRoot: snapshot, targetRoot: recovered });
assert.deepEqual(工作区表摘要(recovered), state);
const workspace = storage.openWorkspace({ dataRoot: recovered, initialize: false }); let usage;
try { usage = await workspace.readDetailedUsage(); } finally { workspace.close(); }
assert.equal(usage.breakdown.format, 'guan-sqlite-usage.v1'); assert.ok(!existsSync(join(recovered, '.实例锁.json')));
assert.deepEqual(工作区表摘要(recovered), state);
assert.deepEqual(fileMap(join(recovered, '媒体')), fileMap(join(snapshot, '媒体')));
if (existsSync(join(dataRoot, '备份'))) {
  cpSync(join(dataRoot, '备份'), join(recovered, '备份'), { recursive: true, force: false, errorOnExist: true });
  chmodSync(join(recovered, '备份'), 0o700);
  assert.deepEqual(fileMap(join(recovered, '备份')), fileMap(join(dataRoot, '备份')));
}
assert.deepEqual(fileMap(dataRoot), originalFiles);
assert.equal(spawnSync('lsof', ['-t', '-nP', '-iTCP:3100', '-sTCP:LISTEN']).status, 1);
assert.equal(spawnSync('lsof', ['+D', dataRoot]).status, 1);
assert.deepEqual(fileMap(根目录, ['.git', '.运行', 'node_modules', '.DS_Store']), sourceBefore);
assert.deepEqual({ head: exec('git', ['-C', 上游目录, 'rev-parse', 'HEAD']).trim(), status: exec('git', ['-C', 上游目录, 'status', '--porcelain=v1', '-uall']) }, upstreamBefore);
核验Excel完整日常包(manifest, digest);
const original = join(archive, '原工作区含原锁');
renameSync(dataRoot, original);
try { renameSync(recovered, dataRoot); }
catch (error) { if (!existsSync(dataRoot)) renameSync(original, dataRoot); throw error; }
assert.deepEqual(fileMap(original), originalFiles); assert.deepEqual(工作区表摘要(dataRoot), state);
save(join(output, '保全恢复结果.json'), { passed: true, date: new Date().toISOString(), output, archive, original, snapshot, dataRoot,
  workspaceId: uuid, oldPID: pid, manifest, manifestSHA256: digest, state, mediaCount: media.length, originalLockPreserved: true, originalFilesUnchanged: true, credentialsDecryptedByCheck: false,
  masterKeyChanged: false, instanceLockAbsent: !existsSync(join(dataRoot, '.实例锁.json')), categorizedUsageValid: true });
console.log(JSON.stringify({ passed: true, output, archive, workspaceId: uuid, documents: state.tables.documents.count, media: media.length, originalLockPreserved: true }));
