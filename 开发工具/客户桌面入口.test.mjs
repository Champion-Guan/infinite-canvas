import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureDesktopEntry } from '../扩展功能/客户安装/客户桌面入口.mjs';

async function fixture(t) {
  const parent = await mkdtemp(join(tmpdir(), '客户桌面入口-'));
  const root = join(parent, '安装'), desktop = join(parent, 'Desktop');
  await mkdir(root, { mode: 0o700 }); await mkdir(desktop, { mode: 0o700 });
  t.after(() => rm(parent, { recursive: true, force: true }));
  return { parent, root, desktop, paths: { root } };
}

test('创建稳定桌面入口，启动脚本读取当前版本且可重复检查', async t => {
  const f = await fixture(t), result = await ensureDesktopEntry(f.paths, { desktopDirectory: f.desktop });
  const app = join(f.desktop, '生图工作台.app'), launcher = join(app, 'Contents/MacOS/启动工作台');
  assert.equal(result.path, app); assert.equal(result.created, true);
  assert.match(await readFile(join(app, 'Contents/Info.plist'), 'utf8'), /CFBundleExecutable.*启动工作台/s);
  const script = await readFile(launcher, 'utf8');
  assert.match(script, /当前版本\.json/); assert.match(script, /desktop-start/); assert.doesNotMatch(script, /beta|[a-f0-9]{40}/);
  execFileSync('/bin/sh', ['-n', launcher]);
  const repeated = await ensureDesktopEntry(f.paths, { desktopDirectory: f.desktop });
  assert.equal(repeated.created, false); assert.equal(repeated.updated, false);
});

test('桌面入口包含应用图标，旧脚本和丢失图标在检查时自动修复', async t => {
  const f = await fixture(t);
  const first = await ensureDesktopEntry(f.paths, { desktopDirectory: f.desktop });
  const icon = join(first.path, 'Contents/Resources/工作台图标.icns');
  const bytes = await readFile(icon);
  assert.equal(bytes.subarray(0, 4).toString(), 'icns');
  assert.match(await readFile(join(first.path, 'Contents/Info.plist'), 'utf8'), /CFBundleIconFile.*工作台图标\.icns/s);
  await rm(icon);
  await writeFile(join(first.path, 'Contents/MacOS/启动工作台'), '#!/bin/sh\n安装根目录=broken\n');
  assert.equal((await ensureDesktopEntry(f.paths, { desktopDirectory: f.desktop })).updated, true);
  assert.deepEqual(await readFile(icon), bytes);
  assert.doesNotMatch(await readFile(join(first.path, 'Contents/MacOS/启动工作台'), 'utf8'), /安装根目录=/);
});

test('Finder使用的启动程序实际执行成功，路径含空格且更新后解析当前版本', async t => {
  const f = await fixture(t);
  const home = join(f.parent, '用户 空格'), root = join(home, 'Library/Application Support/AI-Workbench-Web安装');
  const name = '2.0.0-beta.21-' + 'a'.repeat(40), version = join(root, '版本', name);
  await mkdir(join(version, 'runtime'), { recursive: true, mode: 0o700 });
  await mkdir(join(version, '扩展功能/客户安装'), { recursive: true, mode: 0o700 });
  await writeFile(join(root, '当前版本.json'), JSON.stringify({ current: { name } }, null, 2));
  await writeFile(join(version, 'runtime/node'), '#!/bin/sh\nprintf "%s\\n" "$@"\n', { mode: 0o700 });
  await chmod(join(version, 'runtime/node'), 0o700);
  await writeFile(join(version, '扩展功能/客户安装/Web客户命令.mjs'), '// 不启动真实服务');
  await ensureDesktopEntry(f.paths, { desktopDirectory: f.desktop });
  const result = execFileSync(join(f.desktop, '生图工作台.app/Contents/MacOS/启动工作台'), [], {
    encoding: 'utf8', env: { HOME: home, PATH: '/usr/bin:/bin' },
  });
  assert.equal(result, join(version, '扩展功能/客户安装/Web客户命令.mjs') + '\ndesktop-start\n');
});

test('桌面同名入口不是本工作台时拒绝覆盖', async t => {
  const f = await fixture(t), app = join(f.desktop, '生图工作台.app');
  await writeFile(app, '用户文件', { mode: 0o600 });
  await assert.rejects(ensureDesktopEntry(f.paths, { desktopDirectory: f.desktop }), error => error.code === 'desktop_entry_conflict');
  assert.equal(await readFile(app, 'utf8'), '用户文件');
});

test('桌面同名应用缺少本工作台标记时拒绝接管', async t => {
  const f = await fixture(t), app = join(f.desktop, '生图工作台.app');
  await mkdir(join(app, 'Contents/Resources'), { recursive: true, mode: 0o700 });
  await mkdir(join(app, 'Contents/MacOS'), { recursive: true, mode: 0o700 });
  await assert.rejects(ensureDesktopEntry(f.paths, { desktopDirectory: f.desktop }), error => error.code === 'desktop_entry_conflict');
});
