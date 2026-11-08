import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { 根目录, 上游目录 } from './公共.mjs';
import { 核验日常运行包 } from './日常运行包.mjs';
import { 核验稳定助手 } from './日常助手部署.mjs';
import { 加载SQLite写入协调隔离服务 } from './接入SQLite写入协调隔离服务.mjs';
import { createShardedApplicationStorage } from '../扩展功能/本机存储/分片应用存储.mjs';
import { canvasSemanticSnapshot } from './原画布存储语义比较.mjs';
import { fileMap } from './恢复3100故障现场.mjs';

const output = join(根目录, '.运行/output/SQLite退出恢复-pTuz3S');
const dataRoot = '/Users/guanchengbin/Library/Application Support/AI-Workbench-重建版/工作区';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const save = (name, value) => writeFileSync(join(output, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
const prepared = 核验日常运行包(join(根目录, '.运行/SQLite日常准备-UWriM2/准备清单.json'), 'a44877449e31671952933ddd7a1b5e1f3acaa12aa7479a6395d4aa94d104b1ed');
核验稳定助手(prepared);
assert.equal(process.argv.length, 3);
const option = process.argv[2];
if (option === '--诊断与回归') {
  const diagnostic = JSON.parse(execFileSync('/usr/bin/python3', ['开发工具/控制台断开诊断.py'], { cwd: 根目录, encoding: 'utf8', timeout: 15000 }));
  assert.equal(diagnostic.passed, true); save('终端断开对照诊断.json', diagnostic);
  const tests = ['开发工具/日常命令行.test.mjs', '开发工具/本机存储.test.mjs', '开发工具/SQLite分片故障矩阵.test.mjs', '开发工具/SQLite凭据保管.test.mjs', '开发工具/本机数据服务.test.mjs', '开发工具/本机授权.test.mjs', '开发工具/受控会话.test.mjs', '开发工具/写入协调.test.mjs', '开发工具/自动备份.test.mjs'];
  const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...tests], { cwd: 根目录, encoding: 'utf8', timeout: 180000, maxBuffer: 16 * 1024 * 1024 });
  writeFileSync(join(output, '相关回归.log'), (result.stdout ?? '') + (result.stderr ?? ''), { flag: 'wx', mode: 0o600 });
  assert.equal(result.status, 0, '定向回归未通过，保留日志');
  save('相关回归.json', { passed: true, date: new Date().toISOString(), tests, summary: result.stdout.split('\n').filter(line => /^(ℹ |# (tests|pass|fail|cancelled|skipped|duration))/.test(line)) });
  console.log(JSON.stringify({ passed: true, output, diagnostic: true, summary: result.stdout.split('\n').slice(-10) }));
} else if (option === '--只读访问隔离') {
  const cases = [
    { name: '本机静态资源', url: 'http://localhost:3100/logo.svg', expected: 200 },
    { name: 'IP别名不冒充授权Host', url: 'http://127.0.0.1:3100/logo.svg', expected: 403 },
    { name: '跨Origin拒绝', url: 'http://localhost:3100/logo.svg', headers: { Origin: 'http://untrusted.invalid' }, expected: 403 },
    { name: '跨站请求拒绝', url: 'http://localhost:3100/logo.svg', headers: { 'Sec-Fetch-Site': 'cross-site' }, expected: 403 },
    { name: '普通fetch不签发HTML票据', url: 'http://localhost:3100/', expected: 403 },
  ];
  const results = [];
  for (const item of cases) {
    const response = await fetch(item.url, { headers: item.headers, signal: AbortSignal.timeout(3000), redirect: 'manual' });
    await response.body?.cancel(); assert.equal(response.status, item.expected, item.name);
    results.push({ name: item.name, status: response.status });
  }
  save('正式服务只读访问隔离.json', { passed: true, date: new Date().toISOString(), results, requestedDataAPI: false, credentialsRead: false });
  console.log(JSON.stringify({ passed: true, results }));
} else if (option === '--冷读') {
  assert.equal(spawnSync('lsof', ['-t', '-nP', '-iTCP:3100', '-sTCP:LISTEN']).status, 1);
  assert.ok(!existsSync(join(dataRoot, '.实例锁.json')));
  const storage = await 加载SQLite写入协调隔离服务(prepared.serviceIntegration);
  async function state(workspace) {
    const app = createShardedApplicationStorage({ client: { readDocument: async (...args) => workspace.readDocument(...args), readMedia: async id => { const media = workspace.readMedia(id); return new Blob([media.bytes], { type: media.mime }); } } });
    try {
      const store = app.createInstance();
      return { canvas: await canvasSemanticSnapshot(JSON.parse(await store.getItem('infinite-canvas:canvas_store'))), theme: JSON.parse(await store.getItem('infinite-canvas:theme_store')) };
    } finally { app.close(); }
  }
  const workspace = storage.openWorkspace({ dataRoot }); let before, backup;
  try {
    before = await state(workspace);
    const projects = before.canvas.value.state.projects;
    assert.equal(projects.length, 2);
    const added = projects.find(project => project.id === 'Ew3NQkSh-e3SjwGtK-cUM');
    assert.equal(added.title, '退出恢复持续运行验收（可删除）'); assert.equal(added.nodes.length, 1);
    assert.equal(added.nodes[0].metadata.content, 'SQLite退出恢复后保存验证：2026-10-18');
    const original = projects.find(project => project.id === 'fvOJCwxWYxRQNRJPxnd8X');
    assert.equal(original.title, 'SQLite切换验收（可删除）'); assert.equal(original.nodes.length, 2);
    assert.ok(before.canvas.media.every(media => media.hash === '3001ea48c3902f7460a7072670f91e2b8d6b616a12bd536c79f41ee64985dd46'));
    backup = await workspace.createBackup();
  } finally { workspace.close(); }
  const archive = JSON.parse(readFileSync(join(output, '归档位置修正.json'))).archive;
  const recoveredRoot = join(archive, '编辑后备份恢复'); storage.restoreBackup({ backupRoot: backup.path, targetRoot: recoveredRoot });
  const recovered = storage.openWorkspace({ dataRoot: recoveredRoot });
  try { assert.deepEqual(await state(recovered), before); } finally { recovered.close(); }
  const db = new DatabaseSync(join(dataRoot, '工作台.sqlite'), { readOnly: true }); let documents;
  try { assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok'); assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0); documents = db.prepare('SELECT COUNT(*) AS count FROM documents').get().count; }
  finally { db.close(); }
  save('编辑后冷库验收.json', { passed: true, date: new Date().toISOString(), productCount: 2, nodes: 3, media: before.canvas.media, backup, recoveredRoot, stateSHA256: sha(JSON.stringify(before)), documents, integrity: 'ok', foreignKeys: 0, exactBackupRecovery: true, instanceLockReleased: !existsSync(join(dataRoot, '.实例锁.json')) });
  console.log(JSON.stringify({ passed: true, output, productCount: 2, nodes: 3, documents }));
} else if (/^--结束=\d+$/.test(option)) {
  const pid = Number(option.slice('--结束='.length));
  assert.equal(execFileSync('lsof', ['-t', '-nP', '-iTCP:3100', '-sTCP:LISTEN'], { encoding: 'utf8' }).trim(), String(pid));
  const command = execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' }).trim();
  assert.ok(command.includes('开发工具/日常工作台命令.mjs --启动') && !command.includes('--首次初始化'));
  assert.equal(JSON.parse(readFileSync(join(dataRoot, '.实例锁.json'))).pid, pid);
  const response = await fetch('http://localhost:3100/logo.svg'); assert.equal(response.status, 200);
  assert.equal(sha(Buffer.from(await response.arrayBuffer())), prepared.manifest.web['logo.svg'].sha256);
  const lineage = execFileSync('ps', ['-p', String(pid), '-o', 'pid=,ppid=,tty=,etime=,command='], { encoding: 'utf8' }).trim();
  const events = readFileSync(join(output, '独立终端生命周期.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  const start = events.findLast(event => event.phase === 'service-spawn' && event.pid === pid);
  const samples = events.filter(event => event.pid === pid && event.phase === 'heartbeat');
  assert.ok(start && samples.length >= 40, '至少40次15秒间隔采样');
  assert.ok(samples.every(event => event.http === 200));
  assert.ok(!events.some(event => event.pid === pid && ['service-exit', 'heartbeat-failed'].includes(event.phase)));
  const durationSeconds = (Date.parse(samples.at(-1).date) - Date.parse(start.date)) / 1000; assert.ok(durationSeconds >= 600);
  const before = JSON.parse(readFileSync(join(output, '开始保护.json')));
  const now = fileMap(根目录, ['.git', '.运行', 'node_modules', '.DS_Store']);
  const changed = Object.keys(before.source).filter(path => now[path] !== before.source[path]);
  const added = Object.keys(now).filter(path => !(path in before.source));
  const allowed = new Set(['开发工具/恢复3100故障现场.mjs', '开发工具/独立终端服务观测.mjs', '开发工具/记录3100恢复验收.mjs', '开发工具/控制台断开诊断.py', 'README.md', '开发文档/3100切换SQLite实机验收.md', '开发文档/3100服务退出排查与恢复.md', '开发文档/阶段6扩展边界与SQLite方案.md', '开发文档/架构与开发顺序.md']);
  assert.ok([...changed, ...added].every(path => allowed.has(path)), '有范围外改动');
  const git = (...args) => execFileSync('git', ['-C', 上游目录, ...args], { encoding: 'utf8' });
  assert.equal(git('rev-parse', 'HEAD').trim(), before.upstream.head); assert.equal(git('status', '--porcelain=v1', '-uall'), before.upstream.status);
  save('持续运行与结束保护.json', { passed: true, date: new Date().toISOString(), pid, command, lineage, durationSeconds, successfulSamples: samples.length, staticAssetHashVerified: true, instanceLockPIDVerified: true, sourceBeforeCount: Object.keys(before.source).length, sourceAfterCount: Object.keys(now).length, sourceChanged: changed, sourceAdded: added, sources: now, upstreamUnchanged: true, historicalExitCause: 'unproven', productionBrowserDataMigrated: false, stage6FullyClosed: false });
  console.log(JSON.stringify({ passed: true, pid, durationSeconds, successfulSamples: samples.length }));
} else throw Error('未知操作');
