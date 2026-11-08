import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { 根目录 } from './公共.mjs';
import { 核验日常运行包, 安全文件, 安全目录 } from './日常运行包.mjs';
import { 核验稳定助手 } from './日常助手部署.mjs';
import { 加载SQLite写入协调隔离服务 } from './接入SQLite写入协调隔离服务.mjs';

const protocol = 'guan-keychain-live-test.v1';
const recordName = '新建测试项.json';
export const 冷子进程环境 = () => ({ PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8', TMPDIR: realpathSync(tmpdir()) });
export function 解析实机参数(args) {
  if (args.length !== 3 || args[2] !== '--批准新建测试项' || !args[0].startsWith('--运行包=') || !args[1].startsWith('--清单指纹=')) throw Error('explicit_live_test_approval_required');
  const path = args[0].slice('--运行包='.length), sha256 = args[1].slice('--清单指纹='.length);
  if (!path || !/^[0-9a-f]{64}$/.test(sha256)) throw Error('invalid_test_arguments');
  return { path, sha256 };
}
export function 检查测试根(recordPath) {
  if (typeof recordPath !== 'string' || resolve(recordPath) !== recordPath) throw Error('invalid_test_record');
  const parent = dirname(recordPath), temporary = realpathSync(tmpdir());
  if (!parent.startsWith(temporary + '/guan-keychain-live-') || dirname(parent) !== temporary || recordPath !== join(parent, recordName)) throw Error('invalid_test_root');
  安全目录(parent, true); 安全文件(recordPath);
  const record = JSON.parse(readFileSync(recordPath));
  if (record.protocol !== protocol || record.scope !== 'new-test-item-only' || record.dataRoot !== join(parent, '数据') ||
    typeof record.workspaceId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(record.workspaceId)) throw Error('invalid_test_record');
  安全目录(record.dataRoot, true); 安全文件(join(record.dataRoot, '.工作区.json'));
  const descriptor = JSON.parse(readFileSync(join(record.dataRoot, '.工作区.json')));
  if (descriptor.workspaceId !== record.workspaceId) throw Error('test_workspace_mismatch');
  return record;
}
function 无明文(root, value) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name), stat = lstatSync(path);
    assert.ok(!stat.isSymbolicLink());
    if (entry.isDirectory()) 无明文(path, value);
    else assert.equal(readFileSync(path).includes(Buffer.from(value)), false);
  }
}
const safeCode = error => /^[a-z_]{3,64}$/.test(error?.code ?? '') ? error.code : 'live_test_failed';
async function modules(path, sha256) {
  const prepared = 核验日常运行包(path, sha256), installed = 核验稳定助手(prepared);
  const load = relative => import(pathToFileURL(join(prepared.integration.副本, relative)).href);
  // 工作区实现属于独立批准的协调服务包，不在日常UI副本内，不重写导入或复制核心。
  const { openWorkspace } = await 加载SQLite写入协调隔离服务(prepared.serviceIntegration);
  const { openSQLiteCredentialVault } = await load('扩展功能/本机凭据/SQLite凭据保管.mjs');
  const { createMacOSMasterKeyProvider } = await load('扩展功能/本机凭据/钥匙串主密钥.mjs');
  const provider = createMacOSMasterKeyProvider({ helperPath: installed.helperPath, helperSHA256: prepared.manifest.helper.sha256 });
  return { prepared, installed, openWorkspace, openSQLiteCredentialVault, provider };
}
async function coldChild(input) {
  let workspace, vault, boundary = 'cold-test-record';
  try {
    const record = 检查测试根(input?.recordPath);
    if (!(input.verifyPatternOnly === true && input.value === undefined || typeof input.value === 'string' && /^synthetic-keychain-live-[0-9a-f-]{36}$/.test(input.value)) || !/^secret:[0-9a-f]{64}$/.test(input.ref ?? '')) throw Error('invalid_test_input');
    const loaded = await modules(record.preparedManifest, record.manifestSHA256);
    boundary = 'cold-workspace'; workspace = loaded.openWorkspace({ dataRoot: record.dataRoot });
    assert.equal(workspace.workspaceId, record.workspaceId);
    boundary = 'keychain-read';
    // initialize:false只读回本测试项；找不到、锁定或拒绝时不创建替代主密钥。
    vault = await loaded.openSQLiteCredentialVault({ workspace, keyProvider: loaded.provider });
    boundary = 'decrypt'; const value = await vault.read(input.ref);
    assert.match(value, /^synthetic-keychain-live-[0-9a-f-]{36}$/);
    if (input.verifyPatternOnly !== true) assert.equal(value, input.value);
    无明文(record.dataRoot, value);
    vault.close(); vault = null; workspace.close(); workspace = null;
    return { protocol, passed: true, workspaceId: record.workspaceId, plaintextAbsent: true, exactOriginalValueCompared: input.verifyPatternOnly !== true,
      authenticatedDecryptionAndReferenceVerified: true, lockReleased: !existsSync(join(record.dataRoot, '.实例锁.json')) };
  } catch (error) { return { protocol, passed: false, boundary, code: safeCode(error) }; }
  finally { vault?.close(); workspace?.close(); }
}
async function reopen(input) {
  return new Promise((resolve, reject) => {
    const child = fork(fileURLToPath(import.meta.url), ['--冷重开'], { cwd: 根目录, execArgv: [], stdio: ['ignore', 'ignore', 'ignore', 'ipc'], env: 冷子进程环境() });
    let message, done = false;
    const timer = setTimeout(() => { if (!done) { done = true; child.kill('SIGKILL'); reject(Error('cold_process_timeout')); } }, 30_000);
    child.on('message', value => { message = value; });
    child.on('error', () => { if (!done) { done = true; clearTimeout(timer); reject(Error('cold_process_failed')); } });
    child.on('exit', (code, signal) => {
      if (done) return; done = true; clearTimeout(timer);
      if (code !== 0 || signal || message?.protocol !== protocol || message.passed !== true) {
        const error = Error('cold_process_failed'); error.code = message?.code; error.boundary = message?.boundary; reject(error);
      } else resolve(message);
    });
    child.send(input, error => { if (error && !done) { done = true; clearTimeout(timer); child.kill('SIGKILL'); reject(Error('cold_process_failed')); } });
  });
}
async function supplement(args) {
  if (args.length !== 2 || !args[0].startsWith('--补测冷重开=') || args[1] !== '--批准本测试项读回') throw Error('explicit_cold_test_approval_required');
  const reportPath = resolve(args[0].slice('--补测冷重开='.length)), home = dirname(reportPath), outputParent = resolve(根目录, '.运行/output');
  if (dirname(home) !== outputParent || !/^钥匙串实机验收-[A-Za-z0-9]+$/.test(home.split('/').at(-1)) || reportPath !== join(home, '验收结果.json')) throw Error('invalid_supplement_record');
  安全目录(home, true); 安全文件(reportPath);
  const previous = JSON.parse(readFileSync(reportPath));
  if (previous.passed !== false || previous.testItemCreationConfirmed !== true || previous.newTestItemOnly !== true) throw Error('test_item_not_confirmed');
  const record = 检查测试根(previous.recordPath);
  if (record.workspaceId !== previous.workspaceId || record.dataRoot !== previous.syntheticDataRoot || record.manifestSHA256 !== previous.manifestSHA256) throw Error('test_record_mismatch');
  const output = mkdtempSync(join(根目录, '.运行/output/钥匙串冷读补测-'));
  let passed = false, workspace, boundary = 'verify-test-source'; const results = [], blocked = [];
  try {
    const loaded = await modules(record.preparedManifest, record.manifestSHA256);
    workspace = loaded.openWorkspace({ dataRoot: record.dataRoot });
    assert.equal(workspace.workspaceId, record.workspaceId);
    const refs = workspace.listDocuments('extension').filter(item => /^secret:[0-9a-f]{64}$/.test(item.id));
    assert.equal(refs.length, 1); const ref = refs[0].id;
    workspace.close(); workspace = null;
    results.push({ name: '只定位已登记新测试库的单个加密条目，不新建Keychain项', passed: true });
    boundary = 'cold-node-process'; const cold = await reopen({ recordPath: previous.recordPath, ref, verifyPatternOnly: true });
    assert.equal(cold.workspaceId, record.workspaceId); assert.equal(cold.authenticatedDecryptionAndReferenceVerified, true);
    results.push({ name: '独立Node/Swift进程真实Keychain读回，AES-GCM及带密钥引用校验通过', passed: true });
    assert.equal(cold.plaintextAbsent, true); assert.equal(cold.lockReleased, true);
    核验稳定助手(loaded.prepared);
    results.push({ name: '合成凭据明文未落盘，助手身份保持且测试实例锁正常释放', passed: true });
    passed = true;
  } catch (error) { blocked.push({ boundary: error.boundary ?? boundary, code: safeCode(error) }); process.exitCode = 1; }
  finally {
    try { workspace?.close(); } catch { passed = false; process.exitCode = 1; }
    const result = { passed, results, blocked, output, originalReport: reportPath, workspaceId: record.workspaceId, recordPath: previous.recordPath,
      newKeychainItemsCreated: false, onlyRegisteredTestItemRead: true, exactOriginalPlaintextCompared: false,
      originalPlaintextNotPersisted: true, real3100TakenOver: false, realDataMigrated: false, secretMaterialLogged: false };
    writeFileSync(join(output, '验收结果.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); console.log(JSON.stringify(result, null, 2));
  }
}
async function main(args) {
  const options = 解析实机参数(args);
  const output = mkdtempSync(join(根目录, '.运行/output/钥匙串实机验收-'));
  const results = [], blocked = [];
  let loaded, workspace, vault, dataRoot, workspaceId, recordPath, passed = false, boundary = 'verify-helper', createAttempted = false;
  const check = (name, condition = true) => { assert.ok(condition); results.push({ name, passed: true }); };
  try {
    loaded = await modules(options.path, options.sha256);
    check('完整批准运行包与正式稳定助手登记/字节核验通过');
    const parent = mkdtempSync(join(realpathSync(tmpdir()), 'guan-keychain-live-')); dataRoot = join(parent, '数据');
    workspace = loaded.openWorkspace({ dataRoot, initialize: true }); workspaceId = workspace.workspaceId;
    recordPath = join(parent, recordName);
    const record = { protocol, scope: 'new-test-item-only', createdAt: new Date().toISOString(), dataRoot, workspaceId,
      preparedManifest: resolve(options.path), manifestSHA256: options.sha256 };
    writeFileSync(recordPath, JSON.stringify(record, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    检查测试根(recordPath);
    check('新临时空库与随机工作区UUID已登记，只允许本测试项');
    boundary = 'keychain-create'; createAttempted = true;
    vault = await loaded.openSQLiteCredentialVault({ workspace, keyProvider: loaded.provider, initialize: true });
    check('真实稳定助手创建本测试工作区主密钥，凭据保管标记落盘');
    boundary = 'encrypt-save';
    const value = 'synthetic-keychain-live-' + randomUUID(), ref = await vault.store(value);
    assert.equal(await vault.store(value), ref); assert.equal(await vault.read(ref), value);
    check('虚构凭据加密落盘、去重及当前进程解密验证通过');
    无明文(dataRoot, value);
    check('临时SQLite与WAL/SHM等托管文件未发现虚构凭据明文');
    vault.close(); vault = null; workspace.close(); workspace = null;
    check('父进程关闭凭据保管和SQLite并释放实例锁', !existsSync(join(dataRoot, '.实例锁.json')));
    boundary = 'cold-node-process';
    const cold = await reopen({ recordPath, ref, value });
    check('独立Node及Swift进程从同一Keychain测试项读回并解密冷库', cold.workspaceId === workspaceId && cold.plaintextAbsent === true);
    check('独立进程正常结束并释放测试库实例锁', cold.lockReleased === true);
    const after = 核验稳定助手(loaded.prepared);
    check('实机测试后稳定助手及安装登记仍匹配', after.helperPath === loaded.installed.helperPath);
    passed = true;
  } catch (error) {
    blocked.push({ boundary: error.boundary ?? boundary, code: safeCode(error), message: '首个失败边界已停止；保留助手、测试数据及可能已创建的测试项，不自动重建或换密钥。' }); process.exitCode = 1;
  } finally {
    try { vault?.close(); workspace?.close(); } catch { passed = false; process.exitCode = 1; blocked.push({ boundary: 'cleanup', code: 'cleanup_unconfirmed' }); }
    const report = { passed, results, blocked, output, syntheticDataRoot: dataRoot, workspaceId, recordPath,
      helperPath: loaded?.installed.helperPath, manifestSHA256: options.sha256, keychainService: 'com.guan.workbench.sqlite.master.v1',
      realKeychainAccessAttempted: createAttempted, newTestItemOnly: true, testItemMayExist: createAttempted,
      testItemCreationConfirmed: results.some(item => item.name === '真实稳定助手创建本测试工作区主密钥，凭据保管标记落盘'),
      existingCredentialsEnumerated: false, real3100TakenOver: false, realDataMigrated: false, defaultBrowserUsed: false, secretMaterialLogged: false };
    writeFileSync(join(output, '验收结果.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify(report, null, 2));
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length === 3 && process.argv[2] === '--冷重开' && typeof process.send === 'function') {
    process.once('message', async value => {
      try { const result = await coldChild(value); process.send(result, () => process.disconnect()); if (!result.passed) process.exitCode = 1; }
      catch { process.send({ protocol, passed: false, code: 'cold_process_failed' }, () => process.disconnect()); process.exitCode = 1; }
    });
  } else {
    try { if (process.argv[2]?.startsWith('--补测冷重开=')) await supplement(process.argv.slice(2)); else await main(process.argv.slice(2)); }
    catch { console.log(JSON.stringify({ passed: false, boundary: 'arguments-or-record', message: '参数或测试记录未通过，未自动重试；请保留已有测试结果与现场。' })); process.exitCode = 1; }
  }
}
