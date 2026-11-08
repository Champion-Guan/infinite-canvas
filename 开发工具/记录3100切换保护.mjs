import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { 根目录, 上游目录 } from './公共.mjs';
import { 哈希, 检查运行副本, 运行目录 } from './检查运行副本.mjs';
import { 配置合并源码指纹, 读取配置合并复验记录 } from './接入SQLite配置合并隔离副本.mjs';
import { 核验日常运行包 } from './日常运行包.mjs';
import { 核验稳定助手 } from './日常助手部署.mjs';
import { 加载SQLite写入协调隔离服务 } from './接入SQLite写入协调隔离服务.mjs';
import { createShardedApplicationStorage } from '../扩展功能/本机存储/分片应用存储.mjs';
import { canvasSemanticSnapshot } from './原画布存储语义比较.mjs';

// 本轮独立保护：授权变化仅为3100服务身份与新增正式数据根，不放宽历史保护器。
const output = join(根目录, '.运行/output/SQLite日常启动批准接入-l8qrkS');
const before = JSON.parse(readFileSync(join(output, '开始保护.json')));
const digest = 'a44877449e31671952933ddd7a1b5e1f3acaa12aa7479a6395d4aa94d104b1ed';
const dataRoot = '/Users/guanchengbin/Library/Application Support/AI-Workbench-重建版/工作区';
const exec = (command, args) => execFileSync(command, args, { encoding: 'utf8' });
const git = (root, ...args) => exec('git', ['-C', root, ...args]);
const option = process.argv[2];
assert.equal(process.argv.length, 3);
assert.ok(['--预检', '--冷库'].includes(option) || /^--结束=\d+$/.test(option));
检查运行副本();
const prepared = 核验日常运行包(join(根目录, '.运行/SQLite日常准备-UWriM2/准备清单.json'), digest);
const helper = 核验稳定助手(prepared);
if (option === '--冷库') {
  assert.ok(!existsSync(join(output, '正式冷库验收.json')), '本轮冷库记录已存在，不重复执行');
  assert.equal(spawnSync('lsof', ['-t', '-nP', '-iTCP:3100', '-sTCP:LISTEN']).status, 1, '3100仍有监听');
  assert.ok(!existsSync(join(dataRoot, '.实例锁.json')), '实例锁未正常释放');
  const storage = await 加载SQLite写入协调隔离服务(prepared.serviceIntegration);
  async function readState(workspace) {
    const app = createShardedApplicationStorage({ client: {
      readDocument: async (...args) => workspace.readDocument(...args),
      readMedia: async id => { const media = workspace.readMedia(id); return new Blob([media.bytes], { type: media.mime }); },
    } });
    try {
      const store = app.createInstance();
      const canvas = JSON.parse(await store.getItem('infinite-canvas:canvas_store'));
      const theme = JSON.parse(await store.getItem('infinite-canvas:theme_store'));
      return { canvas: await canvasSemanticSnapshot(canvas), theme };
    } finally { app.close(); }
  }
  const workspace = storage.openWorkspace({ dataRoot });
  let state, backup;
  try {
    state = await readState(workspace);
    const project = state.canvas.value.state.projects[0];
    assert.equal(state.canvas.value.state.projects.length, 1);
    assert.equal(project.id, 'fvOJCwxWYxRQNRJPxnd8X');
    assert.equal(project.title, 'SQLite切换验收（可删除）');
    assert.equal(project.nodes.length, 2);
    assert.deepEqual(project.nodes.map(node => node.type).sort(), ['image', 'text']);
    assert.ok(state.canvas.media.length >= 1);
    backup = await workspace.createBackup();
  } finally { workspace.close(); }
  assert.ok(!existsSync(join(dataRoot, '.实例锁.json')));
  const temporary = mkdtempSync(join(realpathSync(tmpdir()), 'guan-3100-cold-'));
  const recoveredRoot = join(temporary, '恢复验证');
  storage.restoreBackup({ backupRoot: backup.path, targetRoot: recoveredRoot });
  const recovered = storage.openWorkspace({ dataRoot: recoveredRoot });
  try { assert.deepEqual(await readState(recovered), state); } finally { recovered.close(); }
  const db = new DatabaseSync(join(dataRoot, '工作台.sqlite'), { readOnly: true });
  let integrity, foreignKeys;
  try { integrity = db.prepare('PRAGMA integrity_check').get().integrity_check; foreignKeys = db.prepare('PRAGMA foreign_key_check').all().length; }
  finally { db.close(); }
  assert.equal(integrity, 'ok'); assert.equal(foreignKeys, 0);
  const report = { passed: true, date: new Date().toISOString(), dataRoot, workspaceId: backup.workspaceId,
    projectCount: 1, nodeCount: 2, media: state.canvas.media, stateSHA256: 哈希(JSON.stringify(state)),
    exactBackupRecovery: true, backup, recoveredRoot, integrity, foreignKeys, realKeychainAccessedByCheck: false,
    instanceLockReleased: !existsSync(join(dataRoot, '.实例锁.json')) };
  writeFileSync(join(output, '正式冷库验收.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify(report)); process.exit(0);
}
const previous = 读取配置合并复验记录('.运行/SQLite配置合并-CPXu7b/配置合并接入记录.json');
const protectedState = {
  upstreamHEAD: git(上游目录, 'rev-parse', 'HEAD').trim(),
  upstreamStatus: git(上游目录, 'status', '--porcelain=v1', '-uall'),
  dailySource: Object.fromEntries(配置合并源码指纹(运行目录)),
  prerequisiteSource: Object.fromEntries(配置合并源码指纹(previous.副本)),
};
for (const [name, value] of Object.entries(protectedState)) assert.deepEqual(value, before.protection[name], name + '发生变化');
const files = {};
function walk(path = '') {
  for (const name of readdirSync(join(根目录, path))) {
    if (['.git', '.运行', 'node_modules', '.DS_Store'].includes(name)) continue;
    const relative = path ? path + '/' + name : name, stat = lstatSync(join(根目录, relative));
    assert.ok(!stat.isSymbolicLink(), '源码存在链接');
    if (stat.isDirectory()) walk(relative);
    else files[relative] = 哈希(readFileSync(join(根目录, relative)));
  }
}
walk();
const added = Object.keys(files).filter(path => !(path in before.sources));
const changed = Object.keys(before.sources).filter(path => path in files && before.sources[path] !== files[path]);
const removed = Object.keys(before.sources).filter(path => !(path in files));
assert.deepEqual(removed, []);
const allowed = new Set(['AGENTS.md', 'README.md', '开发工具/记录3100切换保护.mjs', '开发文档/3100切换SQLite实机验收.md']);
assert.ok([...added, ...changed].every(path => allowed.has(path)), '存在本轮范围外源码变化');
const listener = exec('lsof', ['-nP', '-iTCP:3100']);
const pid = option === '--预检' ? '39070' : option.slice('--结束='.length);
assert.equal(exec('lsof', ['-t', '-nP', '-iTCP:3100', '-sTCP:LISTEN']).trim(), pid);
const command = exec('ps', ['-p', pid, '-o', 'command=']).trim();
assert.equal(exec('lsof', ['-a', '-p', pid, '-d', 'cwd', '-Fn']).split('\n').find(line => line.startsWith('n')), 'n' + resolve(根目录));
if (option === '--预检') {
  assert.equal(command, 'node 开发工具/受限样式扫描诊断.mjs');
  assert.ok(!listener.includes('ESTABLISHED'), '3100存在活动连接');
  assert.throws(() => lstatSync(dataRoot), { code: 'ENOENT' });
} else {
  assert.equal(command, 'node 开发工具/日常工作台命令.mjs --启动 --运行包=.运行/SQLite日常准备-UWriM2/准备清单.json --清单指纹=' + digest + ' --已保存并关闭');
  const stat = lstatSync(dataRoot);
  assert.ok(stat.isDirectory() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0);
}
const report = { passed: true, date: new Date().toISOString(), added, changed, removed, beforeCount: Object.keys(before.sources).length,
  afterCount: Object.keys(files).length, protectedState, listener, pid, command, manifestSHA256: digest, helperPath: helper.helperPath,
  dataRoot, rollbackCommand: 'node 开发工具/受限样式扫描诊断.mjs',
  gitStatus: git(根目录, '-c', 'core.quotepath=false', 'status', '--short', '--branch', '-uall') };
writeFileSync(join(output, option === '--预检' ? '切换预检.json' : '切换结束保护.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ passed: true, output, added, changed, removed, pid }));
