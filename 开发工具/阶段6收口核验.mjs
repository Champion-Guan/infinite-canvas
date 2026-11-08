import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { 根目录, 上游目录 } from './公共.mjs';
import { 核验日常运行包 } from './日常运行包.mjs';
import { fileMap } from './恢复3100故障现场.mjs';

const manifestPath = join(根目录, '.运行/SQLite日常准备-UWriM2/准备清单.json');
const manifestSHA256 = 'a44877449e31671952933ddd7a1b5e1f3acaa12aa7479a6395d4aa94d104b1ed';
const lifecyclePath = join(根目录, '.运行/output/SQLite退出恢复-pTuz3S/独立终端生命周期.jsonl');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
const save = (output, name, value) => writeFileSync(join(output, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
const sources = () => fileMap(根目录, ['.git', '.运行', 'node_modules', '.DS_Store']);
function upstream() { return { head: git(上游目录, 'rev-parse', 'HEAD').trim(), status: git(上游目录, 'status', '--porcelain=v1', '-uall') }; }
function live() {
  const pid = Number(execFileSync('lsof', ['-t', '-nP', '-iTCP:3100', '-sTCP:LISTEN'], { encoding: 'utf8' }).trim());
  assert.ok(Number.isSafeInteger(pid) && pid > 1);
  const command = execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' }).trim();
  assert.ok(command.includes('开发工具/日常工作台命令.mjs --启动') && !command.includes('--首次初始化'));
  const events = readFileSync(lifecyclePath, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  const start = events.findLast(event => event.phase === 'service-spawn' && event.pid === pid);
  const samples = events.filter(event => event.pid === pid && event.phase === 'heartbeat');
  assert.ok(start && samples.length >= 40 && samples.every(event => event.http === 200));
  assert.ok(!events.some(event => event.pid === pid && ['service-exit', 'heartbeat-failed'].includes(event.phase)));
  const latest = samples.at(-1), durationSeconds = (Date.parse(latest.date) - Date.parse(start.date)) / 1000;
  assert.ok(durationSeconds >= 600 && Date.now() - Date.parse(latest.date) < 60_000);
  return { pid, command, startedAt: start.date, latestAt: latest.date, durationSeconds, successfulSamples: samples.length };
}
function evidencePath(value) {
  const output = resolve(value ?? '');
  assert.ok(output.startsWith(join(根目录, '.运行/output/阶段6最终收口-')) && !relative(join(根目录, '.运行/output'), output).includes('/'));
  return output;
}
const [mode, target] = process.argv.slice(2);
assert.ok(process.argv.length === (mode === '--开始' ? 3 : 4));
const prepared = 核验日常运行包(manifestPath, manifestSHA256);
if (mode === '--开始') {
  const output = mkdtempSync(join(根目录, '.运行/output/阶段6最终收口-'));
  save(output, '开始保护.json', { date: new Date().toISOString(), sources: sources(), upstream: upstream(), branch: git(根目录, 'branch', '--show-current').trim(),
    gitStatus: git(根目录, '-c', 'core.quotepath=false', 'status', '--porcelain=v1', '-uall'), live: live(), manifestPath, manifestSHA256,
    approvedSource: prepared.integration.副本, productionDataRead: false, realKeychainAccessed: false });
  console.log(output);
} else if (mode === '--覆盖') {
  const output = evidencePath(target), root = prepared.integration.副本;
  const ts = createRequire(join(root, 'web/package.json'))('typescript');
  const paths = [];
  function walk(path) {
    for (const name of readdirSync(join(root, path)).sort()) {
      const next = path + '/' + name, stat = lstatSync(join(root, next));
      assert.ok(!stat.isSymbolicLink());
      if (stat.isDirectory()) walk(next);
      else if (/\.(?:tsx?|m?js|html)$/.test(name)) paths.push(next);
    }
  }
  walk('web/src'); walk('web/public'); paths.push('web/index.html');
  const forbidden = [], persist = [], instances = [], bridgeImports = [], preferences = [], inventory = [];
  function script(path, text, offset = 0) {
    const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, /\.tsx$/.test(path) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const entry = node => ({ path: path.replace(/\.inline\.js$/, ''), line: offset + source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1 });
    const identifiers = new Map();
    function visit(node) {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const from = node.moduleSpecifier.text;
        if (from === 'localforage') forbidden.push({ ...entry(node), type: 'direct-localforage-import' });
        if (from.includes('上游浏览器存储桥') || from.includes('localforage-storage')) bridgeImports.push({ ...entry(node), from });
      }
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) identifiers.set(node.name.text, node.initializer.getText(source));
      if (ts.isIdentifier(node) && /^(?:localStorage|sessionStorage|indexedDB|cookieStore|caches|openDatabase)$/.test(node.text)) {
        const parent = node.parent;
        const property = (ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent)) && parent.name === node;
        const declaration = ts.isVariableDeclaration(parent) && parent.name === node;
        if (!property && !declaration) forbidden.push({ ...entry(node), type: 'browser-storage-reference', identifier: node.text });
      }
      if (ts.isPropertyAccessExpression(node) && node.expression.getText(source) === 'document' && node.name.text === 'cookie') forbidden.push({ ...entry(node), type: 'document-cookie' });
      if (ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression) && /^(?:localStorage|sessionStorage|indexedDB|cookie|cookieStore|caches)$/.test(node.argumentExpression.text)) forbidden.push({ ...entry(node), type: 'computed-browser-storage-reference' });
      if (ts.isCallExpression(node)) {
        const expression = node.expression.getText(source);
        if (expression === 'persist') {
          const options = node.arguments[1];
          const storage = options && ts.isObjectLiteralExpression(options) ? options.properties.find(item => item.name?.getText(source) === 'storage') : undefined;
          const name = options && ts.isObjectLiteralExpression(options) ? options.properties.find(item => item.name?.getText(source) === 'name') : undefined;
          const record = { ...entry(node), key: name?.initializer?.getText(source), storage: storage?.initializer?.getText(source) };
          persist.push(record);
          if (!storage) forbidden.push({ ...entry(node), type: 'implicit-zustand-browser-storage' });
        }
        if (/\.createInstance$/.test(expression) && !path.startsWith('web/src/guan/sqlite/')) instances.push({ ...entry(node), expression, options: node.arguments.map(item => item.getText(source)).join(',') });
        if (/^(?:sqlitePreferences|sessionMemory)\./.test(expression)) preferences.push({ ...entry(node), expression, key: node.arguments[0]?.getText(source) });
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
    inventory.push({ path, sha256: sha(text), constants: Object.fromEntries([...identifiers].filter(([key]) => /(?:STORE_KEY|WIDTH_KEY|OPEN_KEY|VIEW_KEY|STORAGE_KEY)$/.test(key))) });
  }
  for (const path of paths) {
    const text = readFileSync(join(root, path), 'utf8');
    if (path.endsWith('.html')) {
      for (const match of text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
        const start = match.index + match[0].indexOf('>') + 1;
        script(path + '.inline.js', match[1], text.slice(0, start).split('\n').length - 1);
      }
    } else script(path, text);
  }
  const { APP_NAMESPACES } = await import('../扩展功能/本机存储/应用存储适配.mjs');
  const outputValue = { passed: forbidden.length === 0, date: new Date().toISOString(), source: root, manifestSHA256, scannedFiles: paths.length,
    forbidden, persist, instances, bridgeImports, preferences, appNamespaces: APP_NAMESPACES, inventory,
    limitation: '静态检查覆盖当前批准Web源码、public脚本和HTML；不能单独证明第三方依赖及任意动态脚本零存储，须结合禁止Storage/IndexedDB的实际UI和HTTP冷重开。' };
  save(output, '存储覆盖.json', outputValue);
  assert.equal(forbidden.length, 0, '存在未覆盖存储入口，停止收口');
  console.log(JSON.stringify({ passed: true, scannedFiles: paths.length, persist: persist.length, namespaces: APP_NAMESPACES, bridgeImportFiles: bridgeImports.length, preferenceCalls: preferences.length }));
} else if (mode === '--回归') {
  const output = evidencePath(target);
  const tests = readdirSync(join(根目录, '开发工具')).filter(name => name.endsWith('.test.mjs') && /^(?:SQLite|本机存储|本机数据服务|扩展存储边界|应用存储替换|存储启动边界|受控会话|受限工作台启动器|本机授权|自动备份|写入协调|日常命令行|钥匙串主密钥|钥匙串实机验收防护|原画布存储语义比较)/.test(name)).sort().map(name => '开发工具/' + name);
  const chunks = [], startedAt = new Date().toISOString();
  const child = spawn(process.execPath, ['--test', '--test-concurrency=1', ...tests], { cwd: 根目录, stdio: ['ignore', 'pipe', 'pipe'] });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { chunks.push(data); process.stdout.write(data); });
  const result = await new Promise((done, reject) => { child.on('error', reject); child.on('close', (code, signal) => done({ code, signal })); });
  const log = Buffer.concat(chunks).toString();
  writeFileSync(join(output, '完整存储回归.log'), log, { flag: 'wx', mode: 0o600 });
  save(output, '完整存储回归.json', { passed: result.code === 0 && !result.signal, startedAt, date: new Date().toISOString(), ...result, tests,
    summary: log.split('\n').filter(line => /^(?:ℹ |# (?:tests|pass|fail|cancelled|skipped|duration))/.test(line)) });
  assert.equal(result.code, 0, '存储回归失败，保留日志且不收口');
} else if (mode === '--结束') {
  const output = evidencePath(target), before = JSON.parse(readFileSync(join(output, '开始保护.json'))), after = sources();
  const added = Object.keys(after).filter(path => !(path in before.sources));
  const removed = Object.keys(before.sources).filter(path => !(path in after));
  const changed = Object.keys(before.sources).filter(path => path in after && before.sources[path] !== after[path]);
  const allowed = new Set(['开发工具/阶段6收口核验.mjs', '开发工具/阶段6全命名空间验收.mjs', '开发工具/阶段6补充界面验收.mjs', '开发工具/阶段6冷重开补测.mjs', '开发工具/阶段6界面验收汇总.mjs', '开发文档/阶段6最终验收报告.md', '开发文档/阶段6存储覆盖清单.md', '开发文档/SQLite日常使用与备份恢复.md', '开发文档/阶段6扩展边界与SQLite方案.md', '开发文档/阶段6本机存储验收.md', '开发文档/架构与开发顺序.md', '开发文档/3100服务退出排查与恢复.md', 'README.md']);
  assert.equal(removed.length, 0); assert.ok([...added, ...changed].every(path => allowed.has(path)), '范围外文件变更');
  assert.deepEqual(upstream(), before.upstream);
  const current = live(); assert.equal(current.pid, before.live.pid, '正式服务被替换');
  for (const name of ['存储覆盖.json', '完整存储回归.json', existsSync(join(output, '全命名空间复验.json')) ? '全命名空间复验.json' : '全命名空间验收.json', '补充界面最终汇总.json']) assert.equal(JSON.parse(readFileSync(join(output, name))).passed, true, name);
  save(output, '最终保护与持续运行.json', { passed: true, date: new Date().toISOString(), upstreamUnchanged: true, approvedRuntimeVerified: true,
    live: current, priorTurnEvidence: JSON.parse(readFileSync(join(根目录, '.运行/output/SQLite退出恢复-pTuz3S/持续运行与结束保护.json'))).date,
    added, changed, removed, sources: after, real3100Restarted: false, realKeychainAccessed: false, oldDataMigrated: false, pushed: false });
  console.log(JSON.stringify({ passed: true, live: current, added, changed, removed }));
} else throw Error('只支持开始、覆盖、回归或结束；不启动/停止正式服务，不清锁，不读Keychain。');
