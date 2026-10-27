import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
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
  assert.equal(repeated.created, false); assert.equal(repeated.updated, true);
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
