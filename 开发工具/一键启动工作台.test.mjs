import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { 读取开发进程身份 } from './开发进程身份.mjs';
import { 创建桌面入口, 启动并打开工作台 } from './一键启动工作台.mjs';

const ready = { running: true, ready: true, http: 200, origin: 'http://localhost:3012', pid: 123 };
test('已运行时沿用实际顺延地址，不启动或重建服务', async () => {
  const opened = [];
  const result = await 启动并打开工作台({ readStatus: async () => ready,
    startService: async () => assert.fail('不应重复启动'), openPage: async value => opened.push(value) });
  assert.equal(result.pid, ready.pid); assert.deepEqual(opened, [ready.origin]);
});
test('未运行时只启动一次，编译和健康检查完成后才打开网页', async () => {
  const sequence = [{ running: false }, { running: true, ready: false }, { ...ready, http: null }, ready];
  let starts = 0; const opened = [];
  await 启动并打开工作台({ readStatus: async () => sequence.shift(), startService: async () => { starts++; },
    openPage: async value => opened.push(value), wait: async () => assert.deepEqual(opened, []) });
  assert.equal(starts, 1); assert.deepEqual(opened, [ready.origin]);
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
