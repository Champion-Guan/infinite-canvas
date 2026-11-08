// 开发入口默认3000、占用自动顺延；沿用原数据和后台构建。
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, watch, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { 核验稳定助手 } from './日常助手部署.mjs';
import { 装配开发源码 } from './装配开发源码.mjs';
import { 轮换源码回退 } from './源码回退保留.mjs';
import { 创建有界运行日志, 创建有界日志流 } from '../扩展功能/本机服务/有界运行日志.mjs';
import { 检查目录容量 } from '../扩展功能/本机服务/目录容量限制.mjs';
import { 执行有界构建命令 } from './有界构建进程.mjs';
import { 读取开发进程身份 } from './开发进程身份.mjs';

const entry = fileURLToPath(import.meta.url), root = dirname(dirname(entry));
// 根目录业务模块和接入补丁是维护来源；此处仅为可重建的运行输入。
const dev = join(root, '.运行/3100源'), web = join(dev, '画布副本/web');
const runtime = join(root, '.运行/开发版3100'), stateFile = join(runtime, '进程.json');
const baselineFile = join(root, '.运行/SQLite日常准备-UWriM2/准备清单.json');
const sha = value => createHash('sha256').update(value).digest('hex');
const save = (file, value) => {
  const temporary = file + '.tmp-' + process.pid;
  writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  renameSync(temporary, file);
};
mkdirSync(runtime, { recursive: true, mode: 0o700 });
const readState = () => existsSync(stateFile) ? JSON.parse(readFileSync(stateFile)) : null;
function alive(state = readState()) {
  if (!Number.isInteger(state?.pid)) return false;
  try {
    const { command, started } = 读取开发进程身份(state.pid);
    return command === state.command && started === state.started;
  } catch { return false; }
}
export function 保留开发源码() {
  const directory = join(root, '.运行/开发回退'); mkdirSync(directory, { recursive: true, mode: 0o700 });
  const output = mkdtempSync(join(directory, '源码-'));
  cpSync(dev, join(output, '3100源'), { recursive: true, dereference: false, verbatimSymlinks: true,
    filter: file => !file.endsWith('/node_modules') });
  for (const file of ['AGENTS.md', 'README.md', 'package.json', 'pnpm-lock.yaml', '上游基线.json', '扩展功能', '上游适配', '界面资源', '开发工具', '开发文档'].filter(file => existsSync(join(root, file)))) {
    const target = join(output, file); mkdirSync(dirname(target), { recursive: true });
    cpSync(join(root, file), target, { recursive: true, filter: path => !path.endsWith('/node_modules') && !path.endsWith('/__pycache__') });
  }
  save(join(output, '回退说明.json'), { date: new Date().toISOString(), source: dev,
    restore: '先 npm run dev:stop；保留当前源码；恢复本目录根源码、接入补丁和工具，必要时恢复3100源并保留node_modules；npm run dev按根来源重新装配。旧快照缺少根目录时使用目录归并报告指定的配套原目录保留。禁止用源码回退覆盖数据库、工作簿和媒体。' });
  轮换源码回退(directory, { onProgress: value => { if (value.total) console.log(JSON.stringify({ phase: '源码回退轮换', ...value })); } });
  return output;
}
async function createBuild() {
  // 2026-10-25 用户关闭自动备份；构建不再复制整套源码。显式 snapshot 命令仍可手动使用。
  const sourceSnapshot = null;
  检查目录容量(runtime, { maxBytes: 512 * 1024 ** 2, incomingBytes: 64 * 1024 ** 2, reserveBytes: 1024 ** 3 });
  console.log(JSON.stringify({ phase: 'assembled', ...装配开发源码() }));
  // 服务保留上一代内存静态包；编译失败或越限后仍能继续提供。
  try { await 执行有界构建命令(process.execPath, [join(root, '开发工具/构建Web前端.mjs'), '开发', web, join(runtime, 'vite-cache'), join(runtime, 'web')],
    { budgetDirectory: runtime, maxBytes: 512 * 1024 ** 2, reserveBytes: 1024 ** 3, timeout: 600000 }); }
  finally { rmSync(join(runtime, 'vite-cache'), { recursive: true, force: true }); }
  return sourceSnapshot;
}
function watchBuild(onBuilt, emit, log) {
  let active = null, pending = false, stopped = false;
  const compile = () => new Promise((done, fail) => {
    // 编译器不持有SQLite、主密钥或端口，编译退出不会带走工作台。
    const child = spawn(process.execPath, [entry, 'compile'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
    let snapshot, built = false;
    child.on('message', value => { if (value?.type === 'built') { snapshot = value.snapshot; built = true; } });
    child.once('error', fail);
    child.once('exit', (code, signal) => {
      if (code === 0 && built) done(snapshot);
      else fail(Error(`编译器退出：${signal || code}；继续提供上一份成功产物。`));
    });
    active = child;
  });
  let running;
  const rebuild = () => {
    pending = true;
    if (!running) running = (async () => {
      while (pending && !stopped) {
        pending = false;
        try { const snapshot = await compile(); if (!stopped) onBuilt(snapshot); }
        catch (error) { emit({ phase: 'build-failed', message: error.message }); if (!initialized) throw error; }
        finally { active = null; }
      }
    })().finally(() => { running = null; });
    return running;
  };
  let initialized = false;
  let debounce;
  const changed = () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => { void rebuild().catch(error => emit({ phase: 'build-failed', message: error.message })); }, 200);
  };
  // 不监听装配目标，避免生成副本触发自身重编译循环。
  const watched = ['扩展功能', '界面资源', '上游适配', '开发文档'].map(name => watch(join(root, name), { recursive: true }, (_event, file) => {
    const path = String(file || '').replaceAll('\\', '/');
    if (path.split('/').some(part => ['node_modules', '__pycache__', '.DS_Store', '待审查'].includes(part))) return;
    if (name === '开发文档' && !['画布开发规范.md', '画布变更记录.md', '画布待验收事项.mdx', '画布后续待办.mdx'].includes(path)) return;
    changed();
  }));
  for (const watcher of watched) watcher.on('error', error => emit({ phase: 'watch-failed', message: error.message }));
  return {
    async ready() { await rebuild(); initialized = true; },
    async close() { stopped = true; clearTimeout(debounce); for (const watcher of watched) watcher.close(); active?.kill('SIGTERM'); await running?.catch(() => {}); }
  };
}
async function host() {
  assert.ok(!alive(), '开发进程已存在');
  const { command, started } = 读取开发进程身份(process.pid);
  const state = { pid: process.pid, started, command, origin: null, source: dev, ready: false };
  const lifecycle = 创建有界运行日志(join(runtime, '生命周期.jsonl'));
  const log = 创建有界日志流(join(runtime, '开发服务.log'));
  const emit = value => {
    const record = { date: new Date().toISOString(), pid: process.pid, ...value };
    lifecycle.write(JSON.stringify(record) + '\n');
    log.write(JSON.stringify(record) + '\n');
  };
  save(stateFile, state);
  let app, watcher, closing = false;
  const shutdown = async () => {
    if (closing) return; closing = true;
    try {
      // 未决任务等实际门禁由工作台自身检查，拒绝时服务继续提供。
      await app?.close(); await watcher?.close();
      save(stateFile, { ...state, ready: false, stoppedAt: new Date().toISOString() });
      emit({ phase: 'stopped' }); process.exit(0);
    } catch (error) { closing = false; emit({ phase: 'stop-blocked', code: error.code, message: error.message }); }
  };
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, shutdown);
  try {
    watcher = watchBuild(snapshot => {
      state.sourceSnapshot = snapshot;
      state.builtAt = new Date().toISOString();
      if (app) { app.reloadWebBundle(); state.ready = true; }
      save(stateFile, state); emit({ phase: 'built', snapshot, origin: app?.origin ?? null });
    }, emit, log);
    await watcher.ready();
    const bytes = readFileSync(baselineFile);
    assert.equal(sha(bytes), 'a44877449e31671952933ddd7a1b5e1f3acaa12aa7479a6395d4aa94d104b1ed');
    const baseline = { manifest: JSON.parse(bytes) }, helper = 核验稳定助手(baseline);
    const storageModules = await Promise.all(['本机服务/数据服务.mjs', '本机存储/SQLite工作区.mjs'].map(path =>
      import(pathToFileURL(join(dev, '服务包/扩展功能', path)).href)));
    const { startDailyWorkbench } = await import(pathToFileURL(join(dev, '画布副本/扩展功能/本机服务/日常工作台.mjs')).href);
    app = await startDailyWorkbench({ webRoot: join(runtime, 'web'), storage: Object.assign({}, ...storageModules),
      helperPath: helper.helperPath, helperSHA256: baseline.manifest.helper.sha256, initialize: false,
      // 开发版使用本项目声明的Web版本，不能把上游基线VERSION当作客户安装版本。
      softwareUpdateOptions: { webPackage: true, currentVersion: JSON.parse(readFileSync(join(root, '开发文档/Web发布版本.json'), 'utf8')).版本 } });
    state.ready = true; state.origin = app.origin; state.workspaceId = app.workspaceId; save(stateFile, state);
    emit({ phase: 'ready', origin: app.origin, workspaceId: app.workspaceId, initialize: false });
  } catch (error) {
    emit({ phase: 'startup-failed', code: error.code, message: error.message });
    await watcher?.close();
    save(stateFile, { ...state, ready: false, failedAt: new Date().toISOString() });
    process.exitCode = 1;
  }
}
async function status() {
  const state = readState(); let http = null;
  if (alive(state) && state.origin) try { const response = await fetch(state.origin + '/logo.svg', { method: 'HEAD', signal: AbortSignal.timeout(2000) }); http = response.status; } catch {}
  return { ...state, running: alive(state), http };
}
async function stop() {
  const state = readState();
  if (!alive(state)) return { stopped: true, alreadyStopped: true };
  process.kill(state.pid, 'SIGTERM');
  for (let i = 0; i < 100; i++) {
    await new Promise(done => setTimeout(done, 200));
    if (!alive(state)) return { stopped: true, pid: state.pid };
  }
  throw Error('工作台仍在处理关闭或被未决任务保护；保留服务与数据，请查看 .运行/开发版3100/生命周期.jsonl。');
}
async function start() {
  if (alive()) return status();
  const child = spawn(process.execPath, [entry, 'host'], { cwd: root, detached: true, stdio: 'ignore' });
  child.unref();
  for (let i = 0; i < 150; i++) {
    await new Promise(done => setTimeout(done, 400));
    const state = readState();
    if (state?.pid === child.pid && state.ready && alive(state)) return status();
    if (state?.pid === child.pid && state.failedAt) throw Error('开发服务启动失败，详见 .运行/开发版3100/开发服务.log');
  }
  return { starting: true, pid: child.pid, log: join(runtime, '开发服务.log') };
}
if (resolve(process.argv[1] || '') === entry) {
  const mode = process.argv[2] || 'start';
  if (mode === 'host') await host();
  else if (mode === 'start') console.log(JSON.stringify(await start(), null, 2));
  else if (mode === 'stop') console.log(JSON.stringify(await stop()));
  else if (mode === 'restart') { await stop(); console.log(JSON.stringify(await start(), null, 2)); }
  else if (mode === 'status') console.log(JSON.stringify(await status(), null, 2));
  else if (mode === 'snapshot') console.log(JSON.stringify({ snapshot: 保留开发源码() }));
  else if (mode === 'compile') { const snapshot = await createBuild(); process.send?.({ type: 'built', snapshot }); process.disconnect?.(); }
  else if (mode === 'build') { assert.ok(!alive(), '服务运行时已自动监听构建；不要并发构建。'); await createBuild(); console.log('开发版构建完成。'); }
  else throw Error('支持 start、stop、restart、status、snapshot、build。');
}
