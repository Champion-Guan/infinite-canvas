import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { 创建桌面启动反馈 } from './桌面启动反馈.mjs';
import { 打开或复用工作台标签 } from './打开或复用工作台标签.mjs';
import { 读取开发进程身份 } from './开发进程身份.mjs';
import { 创建桌面入口, 启动并打开工作台 } from './一键启动工作台.mjs';

const ready = { running: true, ready: true, http: 200, origin: 'http://localhost:3012', pid: 123 };
test('已运行时沿用实际顺延地址，不启动或重建服务', async () => {
  const opened = [];
  const result = await 启动并打开工作台({ readStatus: async () => ready,
    startService: async () => assert.fail('不应重复启动'), openPage: async value => opened.push(value) });
  assert.equal(result.pid, ready.pid); assert.deepEqual(opened, [ready.origin]);
});
test('找到同源Chrome标签时复用该标签，不新开页面', async () => {
  const calls = [];
  const result = await 打开或复用工作台标签('http://localhost:3000', {
    automateChrome: async (_script, address) => { calls.push(['automation', address]); return { stdout: 'reused\n' }; },
    openURL: async url => calls.push(['open', url]),
  });
  assert.equal(result.reused, true);
  assert.deepEqual(calls, [['automation', 'http://localhost:3000']]);
});
test('没有同源标签才通过系统默认浏览器打开一次', async () => {
  const calls = [];
  const result = await 打开或复用工作台标签('http://localhost:3000', {
    automateChrome: async () => ({ stdout: 'not-found\n' }),
    openURL: async url => calls.push(url),
  });
  assert.equal(result.reused, false);
  assert.deepEqual(calls, ['http://localhost:3000']);
});
test('Chrome自动化权限被拒绝时不回退到新标签造成重复', async () => {
  let opened = false;
  await assert.rejects(打开或复用工作台标签('http://localhost:3000', {
    automateChrome: async () => { throw Object.assign(Error('not authorized to send Apple events, -1743'), { stderr: '-1743' }); },
    openURL: async () => { opened = true; },
  }), /系统设置.*自动化/);
  assert.equal(opened, false);
});
test('未运行时只启动一次，编译和健康检查完成后才打开网页', async () => {
  const sequence = [{ running: false }, { running: true, ready: false }, { ...ready, http: null }, ready];
  let starts = 0; const opened = [];
  await 启动并打开工作台({ readStatus: async () => sequence.shift(), startService: async () => { starts++; },
    openPage: async value => opened.push(value), wait: async () => assert.deepEqual(opened, []) });
  assert.equal(starts, 1); assert.deepEqual(opened, [ready.origin]);
});
test('冷启动在调用慢启动服务前就报告状态，就绪后报告打开页面', async () => {
  const events = [];
  let reads = 0;
  await 启动并打开工作台({
    readStatus: async () => ++reads === 1 ? { running: false } : ready,
    startService: async () => events.push('start-service'),
    openPage: async () => events.push('open-page'),
    onProgress: phase => events.push(phase),
  });
  assert.deepEqual(events, ['checking', 'starting', 'start-service', 'opening', 'open-page']);
});
test('原生反馈独立于服务启动，更新真实状态并在结束后清理临时目录', async t => {
  const runtime = mkdtempSync(join(tmpdir(), '启动反馈测试-'));
  t.after(() => rmSync(runtime, { recursive: true, force: true }));
  const child = new EventEmitter();
  let stateFile, closedFile;
  const feedback = await 创建桌面启动反馈({
    runtime, logo: '/fixture.icns', log: join(runtime, '启动.log'),
    ensureAssistant: async () => join(runtime, '助手.app'),
    launch: (command, args) => {
      assert.equal(command, '/usr/bin/open');
      assert.equal(args[0], '-n');
      stateFile = args[4];
      const shownFile = args[8];
      closedFile = args[9];
      assert.equal(JSON.parse(readFileSync(stateFile)).phase, 'waiting');
      writeFileSync(shownFile, 'shown');
      return child;
    },
  });
  feedback.update('starting', '正在启动本机服务...');
  assert.equal(JSON.parse(readFileSync(stateFile)).phase, 'starting');
  const closing = feedback.close();
  assert.equal(JSON.parse(readFileSync(stateFile)).phase, 'done');
  writeFileSync(closedFile, 'closed');
  await closing;
  assert.throws(() => readFileSync(stateFile), { code: 'ENOENT' });
  feedback.update('opening', '迟到状态不会重新创建文件');
});
test('原生反馈进程失败仍可清理，不阻断工作台服务', async t => {
  const runtime = mkdtempSync(join(tmpdir(), '启动反馈失败-'));
  t.after(() => rmSync(runtime, { recursive: true, force: true }));
  const child = new EventEmitter();
  const log = join(runtime, '启动.log');
  const feedback = await 创建桌面启动反馈({
    runtime, log, ensureAssistant: async () => join(runtime, '助手.app'), visibleTimeoutMs: 20,
    launch: () => {
      queueMicrotask(() => child.emit('error', Error('fixture')));
      return child;
    },
  });
  await feedback.close();
  assert.match(readFileSync(log, 'utf8'), /fixture/);
});
test('已有进程仍在启动时只等待，不另起服务；超时和非法地址不打开浏览器', async () => {
  let reads = 0;
  await 启动并打开工作台({ readStatus: async () => ++reads === 1 ? { running: true, ready: false } : ready,
    startService: async () => assert.fail('不应重复启动'), openPage: async () => {}, wait: async () => {} });
  for (const origin of ['https://example.com', 'http://localhost:3000/unrelated', 'http://' + 'user:secret@localhost:3001']) {
    await assert.rejects(启动并打开工作台({ readStatus: async () => ({ ...ready, origin }),
      openPage: async () => assert.fail('不应打开非法地址') }), /不属于本机/);
  }
  await assert.rejects(启动并打开工作台({ readStatus: async () => ({ running: true, ready: false }), timeoutMs: 0,
    openPage: async () => assert.fail('未就绪不可打开') }), /尚未就绪/);
});
test('Finder与终端语言环境不同仍识别同一中文路径进程', () => {
  const expected = 读取开发进程身份(process.pid);
  const code = `import { 读取开发进程身份 } from ${JSON.stringify(new URL('./开发进程身份.mjs', import.meta.url).href)}; console.log(JSON.stringify(读取开发进程身份(${process.pid})));`;
  const actual = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', code], {
    encoding: 'utf8', env: { ...process.env, LC_ALL: 'C', LANG: 'C' } }));
  assert.deepEqual(actual, expected);
  assert.match(actual.command, /一键启动工作台/);
});
test('桌面入口不排队执行连点，且成功打开后短暂去重', () => {
  const entry = readFileSync(new URL('../生图工作台.app/Contents/MacOS/启动工作台', import.meta.url), 'utf8');
  assert.match(entry, /flock -t 0/);
  assert.match(entry, /桌面入口最近打开/);
  assert.match(entry, /workbench_now - workbench_last_open < 5/);
  assert.match(entry, /workbench_result == 0/);
});
test('非阻塞桌面锁竞争时立即拒绝重复点击，不让它们排队', async t => {
  const directory = mkdtempSync(join(tmpdir(), '桌面锁竞争-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const lock = join(directory, '启动.lock'), held = join(directory, '持锁中');
  writeFileSync(lock, '');
  const holder = spawn('/bin/zsh', ['-fc',
    'zmodload zsh/system; zsystem flock -f fd "$1" || exit 3; : > "$2"; sleep 2',
    'lock-holder', lock, held], { stdio: 'ignore' });
  t.after(() => holder.kill());
  for (let attempt = 0; attempt < 100 && !existsSync(held); attempt++) await delay(10);
  assert.ok(existsSync(held), '首个启动流程应持有互斥锁');

  for (let attempt = 0; attempt < 8; attempt++) {
    const duplicate = spawnSync('/bin/zsh', ['-fc',
      'zmodload zsh/system; zsystem flock -t 0 -f fd "$1"; exit $?',
      'duplicate-launch', lock], { encoding: 'utf8' });
    assert.notEqual(duplicate.status, 0, '锁被占用时必须拒绝重复启动');
    assert.match(duplicate.stderr, /resource temporarily unavailable/);
  }
});
test('桌面入口不绑定版本和端口，重复创建不增加文件，保留非本项目同名应用', t => {
  const directory = mkdtempSync(join(tmpdir(), '工作台入口-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const root = join(directory, "含 空格'中文项目"), desktop = join(directory, '桌面');
  mkdirSync(join(root, '生图工作台.app/Contents/MacOS'), { recursive: true });
  mkdirSync(join(root, '生图工作台.app/Contents/Resources'), { recursive: true });
  mkdirSync(desktop);
  writeFileSync(join(root, '生图工作台.app/Contents/MacOS/启动工作台'), 'fixture');
  writeFileSync(join(root, '生图工作台.app/Contents/Resources/工作台图标.icns'), 'fixture icon');
  const first = 创建桌面入口({ root, desktop }), launch = join(first.path, 'Contents/MacOS/launch');
  assert.equal(first.created, true); const inode = statSync(launch).ino;
  assert.equal(创建桌面入口({ root, desktop }).created, false); assert.equal(statSync(launch).ino, inode);
  assert.match(readFileSync(launch, 'utf8'), /启动工作台/);
  assert.doesNotMatch(readFileSync(launch, 'utf8'), /beta|localhost|Cellar/);
  rmSync(join(first.path, 'Contents/guan-workbench-shortcut'));
  assert.throws(() => 创建桌面入口({ root, desktop }), /其他同名应用/);
  assert.equal(statSync(launch).ino, inode);
});
test('桌面入口连点不排队，成功后短暂去重；原生助手使用正常AppKit窗口', () => {
  const launcher = readFileSync(new URL('../生图工作台.app/Contents/MacOS/启动工作台', import.meta.url), 'utf8');
  const window = readFileSync(new URL('./桌面启动窗口.swift', import.meta.url), 'utf8');
  assert.match(launcher, /zsystem flock -t 0/);
  assert.match(launcher, /workbench_now - workbench_last_open < 5/);
  assert.match(window, /setActivationPolicy\(\.regular\)/);
  assert.match(window, /window\.makeKeyAndOrderFront/);
  assert.match(window, /window\.orderFrontRegardless/);
  assert.match(window, /closedURL/);
  assert.match(window, /NSProgressIndicator\(frame: NSRect\(x: 112, y: 44, width: 136, height: 12\)\)/);
  assert.match(window, /progress\.style = \.bar/);
  assert.match(window, /progress\.isIndeterminate = true/);
  assert.match(window, /progress\.startAnimation\(nil\)/);
});
