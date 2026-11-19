import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { 确保桌面启动助手 } from './桌面启动助手.mjs';

test('原生启动助手按源码构建成LaunchServices应用并复用已构建版本', async t => {
  const runtime = mkdtempSync(join(tmpdir(), '桌面原生助手-'));
  t.after(() => rmSync(runtime, { recursive: true, force: true }));
  const logo = join(runtime, '图标.icns');
  writeFileSync(logo, 'fixture-icon');
  let builds = 0;
  const run = async (_command, args) => {
    builds++;
    assert.ok(args.includes('-parse-as-library'));
    assert.ok(args.includes('-framework'));
    const output = args[args.indexOf('-o') + 1];
    mkdirSync(join(output, '..'), { recursive: true });
    writeFileSync(output, 'fixture-native-executable');
  };
  const first = await 确保桌面启动助手(runtime, logo, { run });
  const executable = join(first, 'Contents/MacOS/AI-Workbench Startup');
  assert.equal(readFileSync(executable, 'utf8'), 'fixture-native-executable');
  assert.equal(readFileSync(join(first, 'Contents/Info.plist'), 'utf8').includes('com.guanaiworkbench.startup-feedback'), true);
  assert.equal(readFileSync(join(first, 'Contents/Resources/工作台图标.icns'), 'utf8'), 'fixture-icon');
  assert.equal(lstatSync(executable).mode & 0o100, 0o100);

  const second = await 确保桌面启动助手(runtime, logo, { run: async () => assert.fail('源码未变，不应重复编译') });
  assert.equal(second, first);
  assert.equal(builds, 1);
});

test('原生助手编译失败时清理构建暂存，不留下半成品应用', async t => {
  const runtime = mkdtempSync(join(tmpdir(), '桌面原生助手失败-'));
  t.after(() => rmSync(runtime, { recursive: true, force: true }));
  await assert.rejects(确保桌面启动助手(runtime, '/missing.icns', {
    run: async () => { throw Error('compiler fixture failure'); },
  }), /compiler fixture failure/);
  assert.equal(existsSync(join(runtime, 'AI-Workbench启动提示.app')), false);
  assert.deepEqual(await (await import('node:fs/promises')).readdir(runtime), []);
});
