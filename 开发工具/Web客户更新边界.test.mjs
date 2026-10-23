import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateKeyPairSync, sign, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, chmod, readFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { keyId } from '../扩展功能/软件更新/stable-manifest.mjs';
import { WEB_APP, WEB_REPOSITORY, WEB_ORIGIN, WEB_MANIFEST_NAMES, webReleaseAssetName, packageName, sha256, verifyWebManifest, selectWebRelease } from '../扩展功能/客户安装/Web发布协议.mjs';
import { StableDownload } from '../扩展功能/软件更新/stable-download.mjs';
import { inventoryWebFiles, verifyWebDirectory, verifySignedWebDirectory, extractSignedWebPackage, safeMember } from '../扩展功能/客户安装/Web安装包核验.mjs';
import { switchWebVersion } from '../扩展功能/客户安装/Web版本事务.mjs';
import { readWebArchive } from '../扩展功能/客户安装/Web压缩包读取.mjs';
import { writeState, readState } from '../扩展功能/客户安装/Web安装目录.mjs';

// 每轮生成内存测试密钥；不会写入信任表、配置、环境或发布包。
const keys = generateKeyPairSync('ed25519'), pem = keys.publicKey.export({ format: 'pem', type: 'spki' });
const id = keyId(pem), trustedKeys = { [id]: pem };
const manifest = () => ({ format: 1, app: WEB_APP, channel: 'web-preview', repository: WEB_REPOSITORY, version: '2.0.0-beta.2',
  commit: 'a'.repeat(40), builtAt: '2026-10-23T00:00:00.000Z', keyId: id, inventorySHA256: 'b'.repeat(64),
  packages: [{ platform: 'darwin', arch: 'arm64', name: packageName('2.0.0-beta.2'), sha256: 'c'.repeat(64), size: 128,
    nodeVersion: 'v24.16.0', runtimeSha256: 'd'.repeat(64), runtimeSize: 8 }] });
const encode = m => Buffer.from(JSON.stringify(m, null, 2) + '\n');
const signed = m => ({ bytes: encode(m), signature: sign(null, encode(m), keys.privateKey) });
const verifyOptions = { trustedKeys, platform: 'darwin', arch: 'arm64', currentVersion: '2.0.0-beta.1' };
test('接受固定仓库签名Web清单，校验版本、架构与预发布渠道', () => {
  const s = signed(manifest()); assert.equal(verifyWebManifest(s.bytes, s.signature, verifyOptions).manifest.version, '2.0.0-beta.2');
});
for (const [name, alter] of [
  ['错误仓库', m => { m.repository = 'other/repository'; }], ['旧版Stable包', m => { m.app = 'guan-ai-workbench'; }],
  ['错误渠道', m => { m.channel = 'stable'; }], ['不同Node版本', m => { m.packages[0].nodeVersion = 'v24.15.0'; }],
  ['额外字段', m => { m.command = 'ignored'; }], ['错误包名', m => { m.packages[0].name = '../bad.zip'; }],
]) test('拒绝' + name + '，即使测试密钥正确签名', () => { const m = manifest(); alter(m); const s = signed(m); assert.throws(() => verifyWebManifest(s.bytes, s.signature, verifyOptions)); });
test('拒绝篡改、未知公钥、降级、重复版本和其他架构', () => {
  const s = signed(manifest()); const altered = Buffer.from(s.bytes); altered[20] ^= 1;
  assert.throws(() => verifyWebManifest(altered, s.signature, verifyOptions));
  assert.throws(() => verifyWebManifest(s.bytes, s.signature, { ...verifyOptions, trustedKeys: {} }));
  for (const currentVersion of ['2.0.0-beta.2', '2.0.0']) assert.throws(() => verifyWebManifest(s.bytes, s.signature, { ...verifyOptions, currentVersion }));
  assert.throws(() => verifyWebManifest(s.bytes, s.signature, { ...verifyOptions, arch: 'x64' }));
});
const release = (version, extra = {}) => ({ id: 12, tag_name: 'web-v' + version, published_at: '2026-10-23T00:00:00Z', draft: false, prerelease: true,
  assets: [...WEB_MANIFEST_NAMES, packageName(version)].map((name, index) => ({ name: webReleaseAssetName(name), id: index + 1, state: 'uploaded', size: index === 1 ? 64 : 2048 })), ...extra });
test('选择Web预发布，忽略旧正式版、草稿、缺签名和普通提交', () => {
  const rows = [release('2.0.0-beta.1'), release('2.0.0-beta.2'), release('2.1.0-beta.1', { draft: true }),
    release('2.2.0-beta.1', { assets: [] }), release('3.0.0', { prerelease: false }), { tag_name: 'v1.2.8', draft: false, prerelease: false, assets: [] }];
  assert.equal(selectWebRelease(rows).version, '2.0.0-beta.2');
  assert.equal(selectWebRelease(rows.slice(2)), null);
});
test('GitHub实际资产名映射：本地中文不变，缺包、重复资产及任意名称拒绝', () => {
  assert.equal(webReleaseAssetName('Web更新清单.json'), 'Web.json');
  assert.equal(webReleaseAssetName('Web更新清单.sig'), 'Web.sig');
  assert.equal(webReleaseAssetName(packageName('2.0.0-beta.2')), 'Web-v2.0.0-beta.2-macos-arm64.zip');
  for (const name of ['other.json', '../Web.json', '生图工作台Web-vinvalid-macos-arm64.zip']) assert.throws(() => webReleaseAssetName(name));
  const r = release('2.0.0-beta.2');
  assert.equal(selectWebRelease([{ ...r, assets: r.assets.slice(0, 2) }]), null);
  assert.equal(selectWebRelease([{ ...r, assets: [...r.assets, r.assets[0]] }]), null);
  assert.equal(selectWebRelease([{ ...r, assets: r.assets.map(a => ({ ...a, name: a.name === 'Web.json' ? 'Web更新清单.json' : a.name })) }]), null);
});
test('从GitHub净化后的资产名验签下载，磁盘仍保存中文清单；篡改包拒绝', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'Web远程命名-')), zip = Buffer.from('signed-package');
  const m = manifest(); m.packages[0].sha256 = sha256(zip); m.packages[0].size = zip.length;
  const s = signed(m), r = release(m.version), seen = [];
  r.assets[0].size = s.bytes.length; r.assets[2].size = zip.length;
  const options = { directory: join(parent, '下载'), trustedKeys, arch: 'arm64', platform: 'darwin', verifyManifest: verifyWebManifest,
    manifestNames: WEB_MANIFEST_NAMES, releaseAssetName: webReleaseAssetName, freeSpace: async () => 1e9,
    readAsset: async ({ asset, onChunk }) => {
      seen.push(asset.name);
      if (asset.name === 'Web.json') return s.bytes;
      if (asset.name === 'Web.sig') return s.signature;
      assert.equal(asset.name, 'Web-v2.0.0-beta.2-macos-arm64.zip'); await onChunk(zip); return zip.length;
    } };
  const d = new StableDownload(options);
  await d.download({ repository: WEB_REPOSITORY, release: { ...r, version: m.version }, currentVersion: '2.0.0-beta.1' });
  assert.equal(d.status(WEB_REPOSITORY).state, 'verified');
  assert.deepEqual(seen, ['Web.json', 'Web.sig', 'Web-v2.0.0-beta.2-macos-arm64.zip']);
  assert.deepEqual(await readFile(join(d.verified.directory, WEB_MANIFEST_NAMES[0])), s.bytes);
  assert.deepEqual(await readFile(join(d.verified.directory, WEB_MANIFEST_NAMES[1])), s.signature);
  const bad = new StableDownload({ ...options, directory: join(parent, '损坏下载'), readAsset: async input => {
    if (input.onChunk) { await input.onChunk(Buffer.alloc(zip.length)); return zip.length; }
    return options.readAsset(input);
  } });
  await bad.download({ repository: WEB_REPOSITORY, release: { ...r, version: m.version }, currentVersion: '2.0.0-beta.1' });
  assert.equal(bad.status(WEB_REPOSITORY).error, 'package_integrity_failed');
});
for (const path of ['../数据', '/tmp/a', 'a/../b', 'a//b', 'a\\b', '.运行/x', 'data/a', 'a/private.pem', 'a/test.sqlite', 'a/.env.production']) {
  test('包路径拦截：' + path, () => assert.throws(() => safeMember(path)));
}
async function fixture() {
  const parent = await mkdtemp(join(tmpdir(), 'Web更新边界-')), root = join(parent, '包'); await mkdir(root, { mode: 0o700 });
  const binary = Buffer.alloc(8); binary.writeUInt32LE(0xfeedfacf); binary.writeUInt32LE(0x0100000c, 4);
  for (const name of ['web/index.html', '扩展功能/客户安装/Web客户命令.mjs', '扩展功能/客户安装/Web客户服务.mjs', '启动工作台.command', '安装工作台.command', 'runtime/node', '系统助手/系统钥匙串']) {
    await mkdir(join(root, name, '..'), { recursive: true, mode: 0o700 });
    await writeFile(join(root, name), ['runtime/node', '系统助手/系统钥匙串'].includes(name) ? binary : 'fixture', { mode: 0o700 });
  }
  const m = manifest(); m.packages[0].runtimeSha256 = sha256(binary);
  const inventory = { format: 1, app: WEB_APP, repository: WEB_REPOSITORY, version: m.version, commit: m.commit, dataSchema: 1, origin: WEB_ORIGIN,
    helper: { sha256: sha256(binary), sourceSHA256: 'f'.repeat(64) }, files: await inventoryWebFiles(root) };
  await writeFile(join(root, '工作台发布.json'), encode(inventory), { mode: 0o600 }); m.inventorySHA256 = sha256(encode(inventory));
  return { parent, root, m, inventory };
}
test('严格库存：原样通过；额外文件、字节篡改和软链接均拒绝', async () => {
  const f = await fixture(); await verifyWebDirectory(f.root, { manifest: f.m, selected: f.m.packages[0] });
  await writeFile(join(f.root, 'extra.txt'), 'unexpected', { mode: 0o600 });
  await assert.rejects(verifyWebDirectory(f.root, { manifest: f.m, selected: f.m.packages[0] }));
  const g = await fixture(); await writeFile(join(g.root, 'web/index.html'), 'changed');
  await assert.rejects(verifyWebDirectory(g.root, { manifest: g.m, selected: g.m.packages[0] }));
  const h = await fixture(); await symlink('web/index.html', join(h.root, '链接'));
  await assert.rejects(inventoryWebFiles(h.root));
});
test('真实ZIP下载→再次验签→解包→库存核验；不执行包内任何文件', async () => {
  const f = await fixture(), archive = join(f.parent, '原始.zip');
  execFileSync('/usr/bin/zip', ['-qr', archive, '包'], { cwd: f.parent });
  const bytes = await readFile(archive); f.m.packages[0].sha256 = sha256(bytes); f.m.packages[0].size = bytes.length;
  const download = join(f.parent, '下载'); await mkdir(download, { mode: 0o700 });
  await writeFile(join(download, 'package.zip'), bytes, { mode: 0o600 });
  const s = signed(f.m);
  await writeFile(join(download, WEB_MANIFEST_NAMES[0]), s.bytes, { mode: 0o600 });
  await writeFile(join(download, WEB_MANIFEST_NAMES[1]), s.signature, { mode: 0o600 });
  const dest = join(f.parent, '新版本');
  await extractSignedWebPackage(download, dest, verifyOptions); await verifySignedWebDirectory(dest, verifyOptions);
  await assert.rejects(extractSignedWebPackage(download, dest, verifyOptions));
  await writeFile(join(download, 'package.zip'), Buffer.from('corrupt'));
  await assert.rejects(extractSignedWebPackage(download, join(f.parent, '损坏'), verifyOptions));
});
test('ZIP损坏和归档软链接在写入前拒绝', async () => {
  assert.throws(() => readWebArchive(Buffer.from('not a zip')));
  const f = await fixture(); await symlink('web/index.html', join(f.root, 'link'));
  const archive = join(f.parent, '链接.zip'); execFileSync('/usr/bin/zip', ['-qry', archive, '包'], { cwd: f.parent });
  assert.throws(() => readWebArchive(awaitBuffer(archive)));
});
function awaitBuffer(file) { return execFileSync('/bin/cat', [file]); }
const old = { name: 'old', version: '2.0.0-beta.1', dataSchema: 1, origin: WEB_ORIGIN }, next = { name: 'next', version: '2.0.0-beta.2', dataSchema: 1, origin: WEB_ORIGIN };
const ready = identity => ({ ready: true, workspaceId: 'fixed-workspace', version: identity.version, origin: WEB_ORIGIN });
function transaction(overrides = {}) {
  const events = [], saves = [];
  return { events, saves, args: { previous: old, target: next, workspaceId: 'fixed-workspace',
    save: async state => { saves.push(state); }, verify: async identity => { events.push('verify:' + identity.name); },
    stop: async () => { events.push('stop'); }, start: async identity => { events.push('start:' + identity.name); return ready(identity); }, ...overrides } };
}
test('成功升级：先核验和停服，健康确认原工作区后才提交新指针', async () => {
  const t = transaction(), result = await switchWebVersion(t.args);
  assert.equal(result.current, next); assert.deepEqual(t.events, ['verify:next', 'stop', 'start:next']);
  assert.deepEqual(t.saves.map(s => s.phase), ['prepared', 'switching', 'committed']);
});
test('新版本启动失败：停止新进程，再核验并恢复原版本', async () => {
  const t = transaction({ start: async identity => { if (identity === next) throw Error('startup'); return ready(identity); } });
  const result = await switchWebVersion(t.args); assert.equal(result.rolledBack, true); assert.equal(result.current, old);
  assert.deepEqual(t.saves.map(s => s.phase), ['prepared', 'switching', 'rolled-back']);
});
test('停服后切换状态写入失败也恢复原版，不启动目标版本', async () => {
  const starts = [], phases = [];
  const t = transaction({ save: async state => { phases.push(state.phase); if (state.phase === 'switching') throw Error('disk'); },
    start: async identity => { starts.push(identity); return ready(identity); } });
  assert.equal((await switchWebVersion(t.args)).rolledBack, true);
  assert.deepEqual(starts, [old]); assert.deepEqual(phases, ['prepared', 'switching', 'rolled-back']);
});
test('新指针提交失败恢复原版；初次准备失败不停止当前服务', async () => {
  const t = transaction({ save: async state => { if (state.phase === 'committed') throw Error('disk'); } });
  assert.equal((await switchWebVersion(t.args)).rolledBack, true);
  const noStop = transaction({ save: async () => { throw Error('disk'); } });
  await assert.rejects(switchWebVersion(noStop.args)); assert.deepEqual(noStop.events, ['verify:next']);
});
test('页面门禁拒绝停服时恢复原指针，保留原服务', async () => {
  const t = transaction({ stop: async () => { throw Object.assign(Error('pages'), { code: 'install_browsers_running' }); } });
  await assert.rejects(switchWebVersion(t.args));
  assert.deepEqual(t.saves.map(s => s.phase), ['prepared', 'committed']);
});
test('版本状态耐久原子替换，私人权限保持且无临时残留', async () => {
  const root = await mkdtemp(join(tmpdir(), 'Web版本状态-')), file = join(root, '当前版本.json');
  await writeState(file, { phase: 'prepared' }); await writeState(file, { phase: 'committed' });
  assert.deepEqual(await readState(file), { phase: 'committed' });
  const { readdir } = await import('node:fs/promises'); assert.deepEqual(await readdir(root), ['当前版本.json']);
});
test('新版本返回其他工作区即回退，绝不将默认空库当升级成功', async () => {
  const t = transaction({ start: async identity => ({ ...ready(identity), workspaceId: identity === next ? 'other' : 'fixed-workspace' }) });
  assert.equal((await switchWebVersion(t.args)).rolledBack, true);
});
test('无法确认新进程退出时停止回退，不启动第二个数据库写入者', async () => {
  let stops = 0, starts = 0;
  const t = transaction({ stop: async () => { if (++stops === 2) throw Error('unowned'); }, start: async () => { starts++; throw Error('startup'); } });
  await assert.rejects(switchWebVersion(t.args), e => e.code === 'update_rollback_failed'); assert.equal(starts, 1);
  assert.equal(t.saves.at(-1).phase, 'recovery-required');
});
test('未决任务/页面未关闭阻止停服时，绝不启动目标', async () => {
  let starts = 0; const t = transaction({ stop: async () => { throw Error('busy'); }, start: async () => { starts++; } });
  await assert.rejects(switchWebVersion(t.args)); assert.equal(starts, 0);
});
test('数据结构改变、Origin改变或降级在停止旧版前拒绝', async () => {
  for (const target of [{ ...next, dataSchema: 2 }, { ...next, origin: 'http://localhost:8888' }, old]) {
    const t = transaction({ target }); await assert.rejects(switchWebVersion(t.args)); assert.equal(t.events.length, 0);
  }
});

test('暂存持久恢复重新验签，同包重复暂存安全复用；工作区变化和篡改拒绝', async () => {
  const { stageWebPackage, restoreWebStage } = await import('../扩展功能/客户安装/Web暂存恢复.mjs');
  const f = await fixture(), archive = join(f.parent, '暂存.zip');
  execFileSync('/usr/bin/zip', ['-qr', archive, '包'], { cwd: f.parent });
  const bytes = await readFile(archive); f.m.packages[0].sha256 = sha256(bytes); f.m.packages[0].size = bytes.length;
  const download = join(f.parent, '下载'); await mkdir(download, { mode: 0o700 });
  await writeFile(join(download, 'package.zip'), bytes, { mode: 0o600 });
  const signedManifest = signed(f.m);
  await writeFile(join(download, WEB_MANIFEST_NAMES[0]), signedManifest.bytes, { mode: 0o600 });
  await writeFile(join(download, WEB_MANIFEST_NAMES[1]), signedManifest.signature, { mode: 0o600 });
  const paths = { root: join(f.parent, '安装'), versions: join(f.parent, '安装/版本') };
  await mkdir(paths.versions, { recursive: true, mode: 0o700 });
  const identity = { repository: WEB_REPOSITORY, version: f.m.version, downloadId: 'verified-' + randomUUID() };
  const args = { paths, workspaceId: 'original-workspace', current: old, identity, download, options: verifyOptions };
  const staged = await stageWebPackage(args);
  assert.deepEqual(await restoreWebStage(paths, args.workspaceId, old, verifyOptions), staged);
  assert.deepEqual(await stageWebPackage(args), staged);
  const identity2 = { ...identity, downloadId: 'verified-' + randomUUID() };
  assert.equal((await stageWebPackage({ ...args, identity: identity2 })).identity.downloadId, identity2.downloadId);
  await assert.rejects(restoreWebStage(paths, 'different-workspace', old, verifyOptions));
  assert.equal(await restoreWebStage(paths, args.workspaceId, staged.next, verifyOptions), null);
  await writeFile(join(paths.versions, staged.next.name, 'web/index.html'), 'tampered');
  await assert.rejects(restoreWebStage(paths, args.workspaceId, old, verifyOptions));
  await assert.rejects(stageWebPackage(args));
});
test('服务重启后确认安装取管理器已复核身份，不依赖下载器内存', async () => {
  const { SoftwareUpdates } = await import('../扩展功能/软件更新/software-updates.mjs');
  const directory = await mkdtemp(join(tmpdir(), '暂存确认-'));
  const identity = { repository: WEB_REPOSITORY, version: '2.0.0-beta.2', downloadId: 'verified-' + randomUUID() };
  let approved = 0;
  const updates = new SoftwareUpdates({ directory, currentVersion: old.version, auth: {}, downloader: { status: () => ({ state: 'idle' }), stageIdentity() { throw Error('no in-memory download'); } },
    manager: { status: async () => ({ allowed: true, state: 'staged', canApprove: true }), stagedIdentity: async () => identity,
      approve: async (received, ack) => { assert.deepEqual(received, identity); assert.equal(ack, 'saved-and-all-tasks-ended'); approved++; } } });
  await updates.configure({ autoInstall: true }); await updates.approve('saved-and-all-tasks-ended'); assert.equal(approved, 1);
});
