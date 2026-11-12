import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { 修复项目桌面入口 } from './修复桌面入口.mjs';
import { repairInstalledDesktopEntry } from '../扩展功能/客户安装/修复桌面入口.mjs';
import { WEB_APP, WEB_ORIGIN } from '../扩展功能/客户安装/Web发布协议.mjs';

async function fixture(t) {
  const parent = await mkdtemp(join(tmpdir(), '桌面修复-'));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const root = join(parent, "项目 空格'中文"), desktop = join(parent, 'Desktop');
  await mkdir(root, { mode: 0o700 }); await mkdir(desktop, { mode: 0o700 });
  const current = { version: '2.0.0-beta.29', commit: 'a'.repeat(40), dataSchema: 1, origin: WEB_ORIGIN };
  current.name = current.version + '-' + current.commit;
  const state = { app: WEB_APP, phase: 'committed', current };
  const paths = { root, versions: join(root, '版本'), state: join(root, '当前版本.json') };
  return { parent, root, desktop, paths, state };
}

test('项目工具单独修复入口、图标和脚本，重复执行不启动服务', async t => {
  const f = await fixture(t), app = join(f.root, '生图工作台.app/Contents');
  await mkdir(join(app, 'MacOS'), { recursive: true });
  await mkdir(join(app, 'Resources'), { recursive: true });
  await writeFile(join(app, 'MacOS/启动工作台'), '#!/bin/sh\nexit 73\n');
  await writeFile(join(app, 'Resources/工作台图标.icns'), 'fixture-icon');
  const refreshed = [], options = { root: f.root, desktop: f.desktop, refresh: async path => refreshed.push(path) };
  const first = await 修复项目桌面入口(options);
  const launch = join(first.path, 'Contents/MacOS/launch'), icon = join(first.path, 'Contents/Resources/工作台图标.icns');
  const original = await readFile(launch);
  assert.equal(first.created, true); assert.equal(first.repaired, true);
  await rm(icon); await writeFile(launch, '#!/bin/sh\nbroken\n');
  const second = await 修复项目桌面入口(options);
  assert.equal(second.created, false);
  assert.deepEqual(await readFile(launch), original);
  assert.equal(await readFile(icon, 'utf8'), 'fixture-icon');
  assert.equal((await lstat(launch)).mode & 0o100, 0o100);
  assert.deepEqual(refreshed, [first.path, first.path]);
});

test('客户工具先验签当前安装，再修复稳定入口，不改安装指针', async t => {
  const f = await fixture(t), before = JSON.stringify(f.state);
  await writeFile(f.paths.state, before, { mode: 0o600 });
  const events = [], options = {
    desktopDirectory: f.desktop,
    verifyDirectory: async (path, check) => {
      events.push('verified');
      assert.equal(path, join(f.paths.versions, f.state.current.name));
      assert.equal(check.releaseVersion, f.state.current.version);
      return { inventory: { commit: f.state.current.commit } };
    },
  };
  const result = await repairInstalledDesktopEntry(f.paths, options);
  assert.equal(result.repaired, true); assert.equal(result.version, f.state.current.version);
  const icon = join(result.path, 'Contents/Resources/工作台图标.icns');
  const bytes = await readFile(icon);
  await rm(icon);
  assert.equal((await repairInstalledDesktopEntry(f.paths, options)).updated, true);
  assert.deepEqual(await readFile(icon), bytes);
  assert.equal(await readFile(f.paths.state, 'utf8'), before);
  assert.deepEqual(events, ['verified', 'verified']);
  assert.match(await readFile(join(result.path, 'Contents/Info.plist'), 'utf8'), /CFBundleDisplayName.*AI-Workbench/s);
  assert.match(await readFile(join(result.path, 'Contents/MacOS/启动工作台'), 'utf8'), /当前版本\.json/);
});

test('未安装、状态错误、坏签名或提交不匹配时不写桌面', async t => {
  const f = await fixture(t);
  for (const kind of ['missing', 'state', 'signature', 'commit']) {
    let writes = 0;
    await assert.rejects(repairInstalledDesktopEntry(f.paths, {
      readInstallation: async () => kind === 'missing' ? null : { ...f.state, ...(kind === 'state' ? { app: 'other' } : {}) },
      verifyDirectory: async () => {
        if (kind === 'signature') throw Object.assign(Error('合成坏签名'), { code: 'signature_invalid' });
        return { inventory: { commit: 'b'.repeat(40) } };
      },
      ensureEntry: async () => { writes++; },
    }));
    assert.equal(writes, 0);
  }
});

test('客户工具拒绝覆盖其他同名应用，原文件保留', async t => {
  const f = await fixture(t), app = join(f.desktop, '生图工作台.app');
  await writeFile(app, '用户文件');
  await assert.rejects(repairInstalledDesktopEntry(f.paths, {
    desktopDirectory: f.desktop, readInstallation: async () => f.state,
    verifyDirectory: async () => ({ inventory: { commit: f.state.current.commit } }),
  }), error => error.code === 'desktop_entry_conflict');
  assert.equal(await readFile(app, 'utf8'), '用户文件');
});

test('客户包提供独立修复命令，原有启动与升级恢复入口继续保留', async () => {
  const builder = await readFile(new URL('./构建Web客户包.mjs', import.meta.url), 'utf8');
  assert.match(builder, /\['修复桌面入口.command', 'repair-desktop'\]/);
  assert.match(builder, /\['修复升级入口.command', 'desktop-start'\]/);
  assert.match(builder, /\['恢复卡住的升级.command', 'recover-update'\]/);
  const command = await readFile(new URL('../扩展功能/客户安装/Web客户命令.mjs', import.meta.url), 'utf8');
  const branch = command.slice(command.indexOf("if (operation === 'repair-desktop')"), command.indexOf("if (operation === 'recover-update')"));
  assert.match(branch, /verifySignedWebDirectory\(root\)/);
  assert.match(branch, /repairInstalledDesktopEntry\(paths\)/);
  assert.doesNotMatch(branch, /spawn\(|openWorkbenchAddress|installWebDirectory/);
});
