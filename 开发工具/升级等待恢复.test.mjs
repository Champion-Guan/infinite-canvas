import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, unlink, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { recoverWaitingUpgrade, runningRecoveryBrowsers } from '../扩展功能/客户安装/升级等待恢复.mjs';
import { readState, writeState, versionPath } from '../扩展功能/客户安装/Web安装目录.mjs';
import { processIdentity, ownedProcess } from '../扩展功能/客户安装/管理进程身份.mjs';
import { WEB_APP, WEB_ORIGIN } from '../扩展功能/客户安装/Web发布协议.mjs';

const current = { name: '2.0.0-beta.21-' + 'a'.repeat(40), version: '2.0.0-beta.21', commit: 'a'.repeat(40), origin: WEB_ORIGIN, dataSchema: 1 };
const next = { ...current, name: '2.0.0-beta.22-' + 'b'.repeat(40), version: '2.0.0-beta.22', commit: 'b'.repeat(40) };
const staged = { identity: { repository: 'Champion-Guan/infinite-canvas', version: next.version, downloadId: 'verified-' + 'c'.repeat(36) }, next };
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), '升级等待恢复-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const paths = { root, versions: join(root, '版本'), state: join(root, '当前版本.json'), lock: join(root, '运行锁.json'), address: join(root, '运行地址.json') };
  const initial = { app: WEB_APP, phase: 'committed', current, workspaceId: 'workspace' };
  await writeState(paths.state, initial);
  const owner = { pid: 101, started: 'synthetic', command: '/node ' + versionPath(paths, current) + '/扩展功能/客户安装/Web客户命令.mjs supervisor' };
  await writeState(paths.lock, owner);
  let time = 0;
  const calls = [];
  const options = {
    processes: async () => '', owns: () => true,
    stage: async state => { assert.deepEqual(state, initial); calls.push('verify'); return structuredClone(staged); },
    channel: async version => { assert.equal(version, next.version); calls.push('channel'); },
    signal: async actual => { assert.deepEqual(actual, owner); calls.push('stop'); },
    released: async () => { calls.push('released'); await unlink(paths.lock); },
    start: async actual => {
      assert.deepEqual(actual, current);
      assert.equal(await readState(paths.lock), null);
      assert.equal((await readState(join(root, '本次安装确认.json'))).staged.next.version, next.version);
      calls.push('start');
    },
    progress: async version => { assert.equal(version, next.version); return { state: 'success', origin: 'http://localhost:3007' }; },
    now: () => time, pause: async () => { time += 1000; }, timeout: 2000,
  };
  return { paths, options, calls, initial, owner };
}
test('识别浏览器主进程，进度页也须随浏览器退出；不混淆 Helper 或安装器', () => {
  assert.deepEqual(runningRecoveryBrowsers([
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Helpers/Google Chrome Helper',
    '/System/Volumes/Preboot/Cryptexes/App/System/Applications/Safari.app/Contents/MacOS/Safari',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Firefox.app/Contents/MacOS/firefox',
    '/opt/node',
  ].join('\n')), ['Chrome', 'Safari', 'Edge', 'Firefox']);
});
test('浏览器尚未退出时不验签、不停止、不写确认，也不触碰原安装状态', async t => {
  const f = await fixture(t);
  await assert.rejects(recoverWaitingUpgrade(f.paths, { ...f.options, processes: async () => '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome\n' }),
    { code: 'update_recovery_browsers_open' });
  assert.deepEqual(f.calls, []); assert.deepEqual(await readState(f.paths.state), f.initial);
  assert.equal(await readState(join(f.paths.root, '本次安装确认.json')), null);
});
test('原暂存再次验签后正常停服，刷新同包确认，再启动；只接受健康完成', async t => {
  const f = await fixture(t);
  const result = await recoverWaitingUpgrade(f.paths, f.options);
  assert.deepEqual(result, { version: next.version, address: 'http://localhost:3007', recovered: true });
  assert.ok(f.calls.indexOf('verify') < f.calls.indexOf('stop'));
  assert.ok(f.calls.indexOf('released') < f.calls.indexOf('start'));
  assert.deepEqual(await readState(f.paths.state), f.initial, '恢复器不能直接写版本指针');
});
test('未签名暂存或渠道关闭时不停止服务；未持有的PID不发送信号', async t => {
  for (const overrides of [
    { stage: async () => { throw Object.assign(Error(), { code: 'web_signature_invalid' }); } },
    { channel: async () => { throw Object.assign(Error(), { code: 'update_channel_excluded' }); } },
    { owns: () => false },
  ]) {
    const f = await fixture(t);
    await assert.rejects(recoverWaitingUpgrade(f.paths, { ...f.options, ...overrides }));
    assert.equal(f.calls.includes('stop'), false); assert.equal(f.calls.includes('start'), false);
    assert.equal(await readState(join(f.paths.root, '本次安装确认.json')), null);
  }
});
test('旧服务任务未结束而拒绝停服时不清锁、不重发停止或启动第二个写入者', async t => {
  const f = await fixture(t);
  await assert.rejects(recoverWaitingUpgrade(f.paths, { ...f.options, released: async () => { throw Object.assign(Error(), { code: 'update_manager_handoff_timeout' }); } }),
    { code: 'update_manager_handoff_timeout' });
  assert.equal(f.calls.filter(call => call === 'stop').length, 1);
  assert.equal(f.calls.includes('start'), false);
  assert.deepEqual(await readState(f.paths.lock), f.owner);
});
test('停服期间指针或暂存变化时停止恢复，不续签确认、不覆盖他人锁', async t => {
  const f = await fixture(t);
  await assert.rejects(recoverWaitingUpgrade(f.paths, { ...f.options, released: async () => {
    await unlink(f.paths.lock); await writeState(f.paths.state, { ...f.initial, phase: 'switching' });
  } }), { code: 'update_recovery_required' });
  assert.equal(f.calls.includes('start'), false);
  assert.equal(await readState(join(f.paths.root, '本次安装确认.json')), null);
});
test('仅版本指针改变但健康未确认时不会报告成功；回退也明确报错', async t => {
  for (const state of ['starting', 'rolled-back']) {
    const f = await fixture(t);
    await assert.rejects(recoverWaitingUpgrade(f.paths, { ...f.options, progress: async () => ({ state, reason: state === 'rolled-back' ? 'update_failed_rolled_back' : null }) }),
      { code: state === 'starting' ? 'update_resume_timeout' : 'update_failed_rolled_back' });
  }
});
test('真实子进程收到正常停止后先落盘再释放锁，完全退出后才允许启动', async t => {
  const f = await fixture(t);
  const entry = join(versionPath(f.paths, current), '扩展功能/客户安装/Web客户命令.mjs');
  const saved = join(f.paths.root, '已排空');
  await mkdir(join(entry, '..'), { recursive: true, mode: 0o700 });
  await writeFile(entry, `import{writeFile,unlink}from'node:fs/promises';
process.on('SIGTERM',async()=>{await writeFile(process.env.GUAN_TEST_SAVED,'persisted');await unlink(process.env.GUAN_TEST_LOCK);process.exit(0)});
setInterval(()=>{},1000);process.stdout.write('ready');`);
  const proc = spawn(process.execPath, [entry, 'supervisor'], { env: { ...process.env, GUAN_TEST_SAVED: saved, GUAN_TEST_LOCK: f.paths.lock }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => { if (proc.exitCode === null && proc.signalCode === null) { proc.kill('SIGTERM'); await once(proc, 'exit'); } });
  await once(proc.stdout, 'data');
  const actualOwner = processIdentity(proc.pid);
  await writeState(f.paths.lock, actualOwner);
  const { owns, signal, released, ...options } = f.options;
  await recoverWaitingUpgrade(f.paths, { ...options,
    start: async actual => {
      assert.equal(ownedProcess(actualOwner), false);
      assert.equal(await readFile(saved, 'utf8'), 'persisted');
      assert.equal(await readState(f.paths.lock), null);
      await f.options.start(actual);
    },
  });
  assert.ok(f.calls.includes('start'));
});

test('新版已提交且暂存已消费时，验签后正常交接原管理器，不改指针或安装确认', async t => {
  const f = await fixture(t), initial = { ...f.initial, current: next, previous: current };
  await writeState(f.paths.state, initial);
  let checks = 0, starts = 0;
  const result = await recoverWaitingUpgrade(f.paths, { ...f.options,
    stage: async () => null,
    verify: async identity => { assert.deepEqual(identity, next); checks++; },
    progress: async version => {
      assert.equal(version, next.version);
      return { state: starts ? 'success' : 'restarting-manager', origin: starts ? 'http://localhost:3008' : null };
    },
    start: async identity => {
      starts++; assert.deepEqual(identity, next); assert.equal(await readState(f.paths.lock), null);
      assert.equal(await readState(join(f.paths.root, '本次安装确认.json')), null);
    },
  });
  assert.deepEqual(result, { version: next.version, address: 'http://localhost:3008', recovered: true });
  assert.equal(starts, 1); assert.equal(checks, 2);
  assert.deepEqual(await readState(f.paths.state), initial);
  assert.equal(f.calls.filter(value => value === 'stop').length, 1);
});

test('已提交版本恢复仍拒绝签名失败、未知管理器和停服不确认，不清锁或启动', async t => {
  for (const kind of ['signature', 'owner', 'timeout']) {
    const f = await fixture(t);
    await writeState(f.paths.state, { ...f.initial, current: next, previous: current });
    if (kind === 'owner') await writeState(f.paths.lock, { ...f.owner, command: '/other/application supervisor' });
    let started = false;
    await assert.rejects(recoverWaitingUpgrade(f.paths, { ...f.options, stage: async () => null,
      verify: async () => { if (kind === 'signature') throw Object.assign(Error(), { code: 'web_signature_invalid' }); },
      progress: async () => ({ state: 'restarting-manager' }),
      channel: async () => {},
      released: async () => { throw Object.assign(Error(), { code: 'update_manager_handoff_timeout' }); },
      start: async () => { started = true; },
    }));
    assert.equal(started, false); assert.ok(await readState(f.paths.lock));
    if (kind !== 'timeout') assert.equal(f.calls.includes('stop'), false);
  }
});
