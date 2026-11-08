import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { 根目录 } from './公共.mjs';
import { fileMap } from './恢复3100故障现场.mjs';
import { 核验分类容量日常包 } from './分类容量日常运行.mjs';
import { APP_NAMESPACES } from '../扩展功能/本机存储/应用存储适配.mjs';

// 本次切换的只读收据。不会发写请求、操作页面、关闭浏览器或停止服务。
assert.equal(process.argv.length, 2);
const evidence = join(根目录, '.运行/output/分类容量3100保全-q4YM4E');
const recovery = JSON.parse(readFileSync(join(evidence, '保全恢复结果.json')));
const digest = '544d53cac893990a797aeafc39bb8aa6d98a8428f22e8932d08588240e65a9e3';
核验分类容量日常包(join(根目录, '.运行/SQLite分类日常准备-l1LOQN/准备清单.json'), digest);
const exec = (command, args, cwd = 根目录) => execFileSync(command, args, { encoding: 'utf8', cwd, maxBuffer: 4 * 1024 * 1024 });
const cli = args => exec(join(根目录, 'node_modules/.bin/playwright-cli'),
  ['--session', 'guan-production-usage-20261018', '--raw', ...args], join(根目录, '.运行'));
const pid = Number(exec('lsof', ['-t', '-nP', '-iTCP:3100', '-sTCP:LISTEN']).trim());
assert.equal(pid, 29634);
const command = exec('ps', ['-p', String(pid), '-o', 'command=']).trim();
assert.ok(command.includes('开发工具/分类容量日常运行.mjs --启动 .运行/SQLite分类日常准备-l1LOQN/准备清单.json ' + digest));
const input = exec('lsof', ['-a', '-p', String(pid), '-d', '0']);
assert.ok(/\/dev\/ttys\w+/.test(input) && !input.includes('(revoked)'));
assert.deepEqual(fileMap(recovery.original), JSON.parse(readFileSync(join(evidence, '原现场文件指纹.json'))).originalFiles);
const requests = cli(['requests']).split('\n').map(line => line.match(/^\d+\. \[(\w+)\] (\S+) => \[(\d+)\]/))
  .filter(Boolean).map(match => ({ method: match[1], url: match[2], status: Number(match[3]) }));
const probes = requests.filter(row => row.status === 404);
const roots = new Set(APP_NAMESPACES.map(name => 'app-' + createHash('sha256').update(name).digest('hex')));
// load明确allowMissing的八个命名空间可以尚未建立；已有分片缺失不能按空库忽略。
const emptyRoot = row => roots.has(row.url.split('/').at(-1)) && row.url.includes('/documents/extension/');
assert.ok(requests.filter(row => row.url.endsWith('/usage') && row.status === 200).length >= 3);
assert.ok(requests.filter(row => row.status >= 400).every(row => row.status === 404 && row.method === 'GET' &&
  (emptyRoot(row) || /\/documents\/extension\/app-part-[a-f0-9]{64}$/.test(row.url) &&
  requests.some(next => next.method === 'PUT' && next.url === row.url && next.status === 200))));
const consoleErrors = cli(['console', 'error']);
assert.ok(!/Uncaught|Unhandled|TypeError|ReferenceError|Content Security Policy|Invalid hook/i.test(consoleErrors));
const page = JSON.parse(cli(['run-code', `async page=>({origin:new URL(page.url()).origin,
  internalMaterialRemoved:await page.locator('meta[name=guan-local-bootstrap]').count()===0,
  bannerCount:await page.getByRole('banner',{name:'工作台顶栏',exact:true}).count(),
  nodeCount:await page.locator('[data-node-id]').count()})`]));
assert.equal(page.origin, 'http://localhost:3100'); assert.equal(page.internalMaterialRemoved, true); assert.equal(page.bannerCount, 1);
const db = new DatabaseSync(join(recovery.dataRoot, '工作台.sqlite'), { readOnly: true });
const sha = value => createHash('sha256').update(value).digest('hex');
let current;
try {
  db.exec('BEGIN');
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
  assert.equal(db.prepare("SELECT value FROM workspace WHERE key='id'").get().value, recovery.workspaceId);
  const documents = db.prepare('SELECT body,hash FROM documents').all();
  for (const row of documents) assert.equal(sha(row.body), row.hash);
  const media = db.prepare('SELECT * FROM media').all();
  for (const row of media) {
    assert.match(row.id, /^[a-f0-9]{64}$/);
    const bytes = readFileSync(join(recovery.dataRoot, '媒体', row.id));
    assert.equal(bytes.length, row.size); assert.equal(sha(bytes), row.id);
  }
  current = { documents: documents.length, media: media.length, operations: db.prepare('SELECT count(*) AS n FROM operations').get().n };
  db.exec('COMMIT');
} finally { db.close(); }
assert.equal(JSON.parse(readFileSync(join(recovery.dataRoot, '.实例锁.json'))).pid, pid);
const report = { passed: true, date: new Date().toISOString(), pid, command, workspaceId: recovery.workspaceId,
  current, page, interactiveConsoleValid: true, originalArchiveUnchanged: true,
  usageRequestsSucceeded: requests.filter(row => row.url.endsWith('/usage') && row.status === 200).length,
  missingShardProbes: probes.filter(row => !emptyRoot(row)).length,
  emptyNamespaceProbes: probes.filter(emptyRoot).length, allMissingShardProbesLaterCreated: true,
  unhandledScriptErrorFound: false, integrity: 'ok', foreignKeyErrors: 0,
  allDocumentHashesValid: true, allMediaHashesValid: true, credentialsDecryptedByCheck: false,
  writesPerformedByVerifier: false, browserClosedByVerifier: false,
  note: '浏览器打开前已另行逐表验证与恢复快照完全一致。验收期间出现持续卡片编辑，因此停止页面点击；本收据保留新编辑，不再要求当前表与维护快照相等。正式菜单不执行整理；避让创建行为使用此前隔离19步验收证据。' };
writeFileSync(join(evidence, '生产只读验收.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ passed: true, pid, origin: page.origin, current, evidence, writesPerformedByVerifier: false }));
