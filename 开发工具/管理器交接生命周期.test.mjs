import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { mkdtemp, mkdir, readFile, rm, open, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { processIdentity } from '../扩展功能/客户安装/管理进程身份.mjs';
import { readState, writeState, versionPath, privateDirectory } from '../扩展功能/客户安装/Web安装目录.mjs';
import { WEB_APP, WEB_ORIGIN, fail } from '../扩展功能/客户安装/Web发布协议.mjs';
import { webProgressSnapshot } from '../扩展功能/客户安装/Web更新进度服务.mjs';
import { assertWebHealth, safeStartupDiagnostic, startupError } from '../扩展功能/客户安装/启动健康诊断.mjs';

const old = { name: '2.0.0-beta.23-' + 'a'.repeat(40), version: '2.0.0-beta.23', commit: 'a'.repeat(40), origin: WEB_ORIGIN, dataSchema: 1 };
const current = { ...old, name: '2.0.0-beta.24-' + 'b'.repeat(40), version: '2.0.0-beta.24', commit: 'b'.repeat(40) };
async function until(predicate) {
  const deadline = Date.now() + 3000;
  while (!await predicate()) {
    assert.ok(Date.now() < deadline, '管理器生命周期未收敛');
    await nextTurn();
  }
}
async function fixture(t, { commitFailure = false, stopBlocked = false, pages = 0 } = {}) {
  const root = await mkdtemp(join(tmpdir(), '管理器交接-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const paths = { root, versions: join(root, '版本'), state: join(root, '当前版本.json'), lock: join(root, '运行锁.json'), address: join(root, '运行地址.json'), log: join(root, '日志') };
  await mkdir(paths.versions, { mode: 0o700 });
  await writeState(paths.state, { app: WEB_APP, phase: 'committed', current, previous: old, workspaceId: 'workspace' });
  const events = [], intervals = new Set(), children = [];
  let time = 0, commits = 0, stopped = 0, exit = false, progress;
  const spawn = () => {
    assert.ok(children.every(child => child.exited), '旧服务未退出不能启动另一写入者');
    const child = new EventEmitter();
    Object.assign(child, { connected: true, stdout: new PassThrough(), stderr: new PassThrough(), exited: false });
    children.push(child); events.push('start');
    const status = () => ({ ready: true, acceptingPages: true, version: current.version, origin: 'http://localhost:3001', workspaceId: 'workspace',
      authorization: { authorizedPages: pages, pendingTickets: 0, activeRequests: 0 } });
    child.send = message => {
      if (message.type === 'web-service-activate') setImmediate(() => child.emit('message', { type: 'web-service-status', status: status() }));
      if (message.type === 'web-service-stop') {
        events.push('stop'); stopped++;
        setImmediate(() => {
          if (stopBlocked && stopped === 1) {
            child.emit('message', { type: 'web-service-stop-blocked', error: 'install_tasks_pending' }); return;
          }
          child.emit('message', { type: 'web-service-stopped' });
          child.connected = false; child.exited = true; child.emit('exit', 0);
        });
      }
    };
    child.report = () => child.emit('message', { type: 'web-service-status', status: status() });
    setImmediate(() => child.emit('message', { type: 'web-service-ready', status: { ...status(), acceptingPages: false } }));
    return child;
  };
  const moduleURL = new URL('../扩展功能/客户安装/Web安装管理器.mjs', import.meta.url).href;
  const source = (await readFile(new URL(moduleURL), 'utf8')).replace(/^import .*\n/gm, '').replace(/^export \{.*\n/gm, '')
    .replace('export async function runWebSupervisor', 'async function runWebSupervisor').replaceAll('import.meta.url', JSON.stringify(moduleURL));
  const dependencies = {
    spawn, open, unlink, readFile: async () => JSON.stringify({ version: old.version }), join,
    dailyWorkbenchPaths: () => ({ dataRoot: root }),
    verifySignedWebDirectory: async () => ({ inventory: { version: current.version } }),
    webInstallPaths: () => paths, privateDirectory, readState, writeState, versionPath, WEB_APP, fail,
    switchWebVersion: () => assert.fail('已经提交的版本不能重复执行安装事务'),
    restoreWebStage: async () => null, stageWebPackage: () => assert.fail('不能重新暂存'), validateStageIdentity: () => {},
    清理过期安装版本: async () => {}, 清理已完成Web安装: async () => {},
    创建有界日志流: () => new Writable({ write(chunk, _encoding, done) {
      if (chunk.toString().includes('管理器交接未完成：')) events.push('failure');
      done();
    } }),
    webProgressSnapshot,
    createDetachedProgressObserver: read => { progress = () => read(current.version); return { close: async () => {}, open: async () => ({}) }; },
    prepareManagerHandoff: async () => ({
      async commit() {
        commits++; events.push('commit');
        assert.ok(await readState(paths.lock), '接续ACK之前不得释放管理锁');
        if (commitFailure && commits === 1) throw startupError('update_manager_handoff_failed');
      },
      async cancel() { events.push('cancel'); },
    }),
    processIdentity, ownedProcess: () => true, assertWebHealth, safeStartupDiagnostic, startupError,
    clearInstallConfirmation: async () => {}, saveInstallConfirmation: () => assert.fail('不需新的安装确认'),
    restoreInstallConfirmation: async () => false, requireSavedUpdateChannel: async () => {}, ensureDesktopEntry: async () => {},
    process: { pid: process.pid, on() {}, exit() { events.push('exit'); exit = true; } },
    setInterval(callback) { intervals.add(callback); return callback; }, clearInterval(callback) { intervals.delete(callback); },
    setTimeout, clearTimeout, Date: { now: () => time },
  };
  const run = new Function(...Object.keys(dependencies), source + '\nreturn runWebSupervisor;')(...Object.values(dependencies));
  await run(paths);
  return { paths, events, children, progress, get exit() { return exit; },
    tick() { for (const callback of [...intervals]) callback(); },
    advance(milliseconds) { time += milliseconds; },
    setPages(value) { pages = value; children.at(-1).report(); },
  };
}

test('交接ACK失败保留锁并恢复已提交服务，退避后自动重试；收到ACK才释放锁退出', async t => {
  const f = await fixture(t, { commitFailure: true });
  f.tick();
  await until(() => f.events.includes('failure'));
  assert.equal((await readState(f.paths.state)).diagnostic?.stage, 'handoff');
  await until(() => f.progress().state === 'blocked');
  assert.equal(f.children.length, 2);
  assert.ok(await readState(f.paths.lock));
  assert.equal(f.exit, false);
  f.tick(); await nextTurn();
  assert.equal(f.events.filter(value => value === 'commit').length, 1);
  f.advance(15001);
  await until(() => { f.tick(); return f.exit; });
  assert.equal(await readState(f.paths.lock), null);
  assert.equal(f.events.filter(value => value === 'commit').length, 2);
  assert.ok(f.children.every(child => child.exited));
});

test('服务拒绝停止时交接失败可见，保持唯一写入者；任务结束后自动接续', async t => {
  const f = await fixture(t, { stopBlocked: true });
  f.tick();
  await until(() => f.events.includes('failure'));
  assert.equal((await readState(f.paths.state)).diagnostic?.stage, 'handoff');
  await until(() => f.progress().state === 'blocked');
  assert.equal(f.progress().reason, 'install_tasks_pending');
  assert.equal(f.children.length, 1);
  assert.equal(f.events.includes('commit'), false);
  f.advance(15001);
  await until(() => { f.tick(); return f.exit; });
  assert.equal(f.children.length, 1);
  assert.equal(await readState(f.paths.lock), null);
});

test('已有页面时不为管理器换代停服，页面释放后自动交接', async t => {
  const f = await fixture(t, { pages: 1 });
  f.tick(); await nextTurn();
  assert.deepEqual(f.events, ['start']);
  f.setPages(0); f.tick();
  await until(() => f.exit);
  assert.deepEqual(f.events, ['start', 'stop', 'commit', 'exit']);
});
