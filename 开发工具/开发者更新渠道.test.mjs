import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync, sign } from 'node:crypto';
import { PassThrough } from 'node:stream';
import { SoftwareUpdates } from '../扩展功能/软件更新/software-updates.mjs';
import { acceptsUpdateVersion, acceptsWebRelease, requireSavedUpdateChannel } from '../扩展功能/软件更新/更新发布渠道.mjs';
import { readGitHubStable } from '../扩展功能/软件更新/github-stable.mjs';
import { assembleSoftwareUpdates } from '../扩展功能/软件更新/更新服务装配.mjs';
import { WEB_REPOSITORY, WEB_APP, selectWebRelease, verifyWebManifest, packageName } from '../扩展功能/客户安装/Web发布协议.mjs';
import { keyId } from '../扩展功能/软件更新/stable-manifest.mjs';

const release = (version, overrides = {}) => ({ id: 10, tag_name: 'web-v' + version, draft: false,
  prerelease: version.includes('-'), published_at: '2026-10-27T00:00:00.000Z', body: version,
  assets: ['Web.json', 'Web.sig', `Web-v${version}-macos-arm64.zip`].map((name, index) => ({ name, id: index + 1, size: index === 1 ? 64 : 128, state: 'uploaded' })), ...overrides });
async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), '开发者更新渠道-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const seen = [];
  const updates = new SoftwareUpdates({ directory, auth: { token: async () => '' }, currentVersion: '2.0.0-beta.14',
    readRelease: async ({ developerMode }) => { seen.push(developerMode); return selectWebRelease([release('2.1.0-beta.1'), release('2.0.0')], '', { developerMode }); }, ...options });
  await updates.configure({ autoDownload: false, autoCheck: false });
  return { updates, directory, seen };
}
test('默认关闭；旧偏好缺少开关时兼容读取，其他偏好原样保留', async t => {
  const { updates, directory } = await fixture(t);
  assert.equal((await updates.preferences()).developerMode, false);
  const old = JSON.parse(await readFile(updates.file)); delete old.developerMode; old.network = 'direct';
  await writeFile(updates.file, JSON.stringify(old));
  assert.equal((await updates.preferences()).developerMode, false);
  await updates.configure({ developerMode: true });
  assert.equal(Object.hasOwn(JSON.parse(await readFile(updates.file)), 'developerMode'), false);
  const restarted = new SoftwareUpdates({ directory, auth: {}, currentVersion: updates.currentVersion });
  assert.equal((await restarted.preferences()).developerMode, true);
  assert.equal((await restarted.preferences()).network, 'direct');
  assert.equal((await restarted.preferences()).autoDownload, false);
});
test('拒绝非布尔开关；管理器同样拒绝损坏的偏好', async t => {
  const { updates, directory } = await fixture(t);
  for (const developerMode of ['true', 1, null, {}]) await assert.rejects(updates.configure({ developerMode }), { code: 'invalid_update_preferences' });
  await writeFile(join(directory, '开发者更新偏好.json'), JSON.stringify({ version: 1, developerMode: 'true' }));
  await assert.rejects(updates.preferences(), { code: 'update_storage_invalid' });
  await assert.rejects(requireSavedUpdateChannel(directory, '2.1.0-beta.1'), { code: 'update_storage_invalid' });
});
test('关闭仅收正式Web包；开启收Beta与Stable，并按语义版本选最高版本', () => {
  const rows = [release('2.0.0-beta.20'), release('2.0.0'), release('2.1.0-beta.1'), release('2.0.0-beta.9')];
  assert.equal(selectWebRelease(rows).version, '2.0.0');
  assert.equal(selectWebRelease(rows, '', { developerMode: true }).version, '2.1.0-beta.1');
  assert.equal(selectWebRelease([release('2.0.0-beta.20'), release('2.0.0')], '', { developerMode: true }).version, '2.0.0');
  assert.equal(selectWebRelease([release('2.1.0-beta.1')]), null);
});
test('两种渠道均排除草稿、旧版v标签、Alpha/RC及发布标记和版本号不一致的包', () => {
  const rows = [release('2.1.0-beta.1', { draft: true }), release('2.2.0', { tag_name: 'v2.2.0' }), release('2.3.0-alpha.1'), release('2.3.0-rc.1'),
    release('2.3.0-beta.1', { prerelease: false }), release('2.4.0', { prerelease: true })];
  for (const developerMode of [false, true]) assert.equal(selectWebRelease(rows, '', { developerMode }), null);
  assert.equal(acceptsUpdateVersion('2.1.0-beta.1', false), false);
  assert.equal(acceptsUpdateVersion('invalid', true), false);
  assert.equal(acceptsWebRelease(release('2.1.0'), { developerMode: false }), true);
});
test('GitHub分页读取将渠道传给选择器，不依赖Latest接口或发布时间先后', async () => {
  const fetchImpl = async () => ({ ok: true, body: (async function* () { yield Buffer.from(JSON.stringify([release('2.1.0-beta.1'), release('2.0.0')])); })() });
  for (const developerMode of [false, true]) {
    const result = await readGitHubStable({ repository: WEB_REPOSITORY, token: '', developerMode, fetchImpl, selectRelease: selectWebRelease });
    assert.equal(result.version, developerMode ? '2.1.0-beta.1' : '2.0.0');
  }
});
test('切换立即清除旧候选与一分钟缓存，重新检查按当前渠道选择', async t => {
  const { updates, seen } = await fixture(t);
  assert.equal((await updates.check()).latest.version, '2.0.0');
  await updates.configure({ developerMode: true });
  assert.equal((await updates.status()).latest, null);
  assert.equal((await updates.check()).latest.version, '2.1.0-beta.1');
  await updates.configure({ developerMode: false });
  assert.equal((await updates.status()).latest, null);
  assert.equal((await updates.check()).latest.version, '2.0.0');
  assert.deepEqual(seen, [false, true, false]);
});
test('检查器即使意外返回Beta，关闭模式也不产生可下载候选', async t => {
  const { updates } = await fixture(t, { readRelease: async () => ({ version: '2.1.0-beta.1' }) });
  assert.equal((await updates.check()).state, 'no-stable-release');
  assert.equal((await updates.status()).hasNewVersion, false);
  await assert.rejects(updates.download(), { code: 'release_not_available' });
});
test('关闭时取消Beta下载与排队安装；已验证缓存不能继续暂存、确认或打开安装进度', async t => {
  const calls = [], identity = { repository: WEB_REPOSITORY, version: '2.1.0-beta.1', downloadId: 'verified-test' };
  let phase = 'staged';
  const { updates, directory } = await fixture(t, {
    downloader: { status: () => ({ state: 'verified', version: identity.version }), cancel: () => calls.push('cancel'), stageIdentity: () => identity },
    manager: { status: async () => ({ allowed: true, state: phase, targetVersion: identity.version, canApprove: true }), stagedIdentity: async () => identity,
      defer: async () => { calls.push('defer'); phase = 'deferred'; }, stage: async () => calls.push('stage'), approve: async () => calls.push('approve') },
    progress: { open: async () => { calls.push('progress'); return {}; } },
  });
  await updates.configure({ developerMode: true });
  await updates.check();
  await updates.approve('saved-and-all-tasks-ended', { manual: true });
  phase = 'awaiting-browser-exit';
  calls.length = 0;
  await updates.configure({ developerMode: false });
  assert.deepEqual(calls, ['defer', 'cancel']);
  const status = await updates.status();
  assert.equal(status.download.state, 'idle'); assert.equal(status.latest, null); assert.equal(status.install.canApprove, false);
  assert.equal(status.install.reason, 'update_channel_excluded');
  await assert.rejects(updates.stage(), { code: 'update_channel_excluded' });
  await assert.rejects(updates.approve('saved-and-all-tasks-ended', { manual: true }), { code: 'update_channel_excluded' });
  await assert.rejects(updates.progressWindow(), { code: 'update_channel_excluded' });
  await assert.rejects(requireSavedUpdateChannel(directory, identity.version), { code: 'update_channel_excluded' });
  const restarted = new SoftwareUpdates({ directory, auth: {}, currentVersion: updates.currentVersion, manager: updates.manager });
  assert.equal((await restarted.status()).install.canApprove, false);
  await assert.rejects(restarted.approve('saved-and-all-tasks-ended', { manual: true }), { code: 'update_channel_excluded' });
  assert.deepEqual(calls, ['defer', 'cancel']);
});
test('Stable缓存不因开启开发者模式被取消；正式包在关闭模式下可继续安装流程', async t => {
  const calls = [], identity = { repository: WEB_REPOSITORY, version: '2.0.0', downloadId: 'verified-test' };
  const { updates, directory } = await fixture(t, {
    downloader: { status: () => ({ state: 'verified', version: identity.version }), cancel: () => calls.push('cancel'), stageIdentity: () => identity },
    manager: { status: async () => ({ allowed: true, state: 'staged', targetVersion: identity.version, canApprove: true }), stagedIdentity: async () => identity,
      stage: async () => calls.push('stage'), approve: async () => calls.push('approve') }, progress: { open: async () => ({ url: 'test' }) },
  });
  await updates.configure({ developerMode: true }); assert.deepEqual(calls, []);
  await updates.configure({ developerMode: false });
  await updates.stage(); await updates.staging;
  await updates.approve('saved-and-all-tasks-ended', { manual: true });
  await requireSavedUpdateChannel(directory, identity.version);
  assert.deepEqual(calls, ['stage', 'approve']);
});
test('正在安装时拒绝改渠道，保持原偏好，不影响已开始的版本事务', async t => {
  const { updates } = await fixture(t, { manager: { status: async () => ({ state: 'switching' }) } });
  await assert.rejects(updates.configure({ developerMode: true }), { code: 'update_channel_busy' });
  assert.equal((await updates.preferences()).developerMode, false);
});
test('慢检查与关闭开关串行处理，最终状态不泄漏旧Beta候选', async t => {
  let resolveRelease, entered;
  const ready = new Promise(resolve => { entered = resolve; });
  const response = new Promise(resolve => { resolveRelease = resolve; });
  const { updates } = await fixture(t, { readRelease: async () => { entered(); return response; } });
  await updates.configure({ developerMode: true });
  const check = updates.check(); await ready;
  const turnOff = updates.configure({ developerMode: false });
  resolveRelease({ version: '2.1.0-beta.1' });
  await Promise.all([check, turnOff]);
  assert.equal((await updates.status()).preferences.developerMode, false);
  assert.equal((await updates.status()).latest, null);
});
test('正式签名Web清单通过；Beta不能冒充web-stable，坏签名仍拒绝', () => {
  const keys = generateKeyPairSync('ed25519'), pem = keys.publicKey.export({ format: 'pem', type: 'spki' }), id = keyId(pem);
  const manifest = { format: 1, app: WEB_APP, channel: 'web-stable', repository: WEB_REPOSITORY, version: '2.0.0', commit: 'a'.repeat(40),
    builtAt: '2026-10-27T00:00:00.000Z', keyId: id, inventorySHA256: 'b'.repeat(64), packages: [{ platform: 'darwin', arch: 'arm64', name: packageName('2.0.0'),
      sha256: 'c'.repeat(64), size: 128, nodeVersion: 'v24.16.0', runtimeSha256: 'd'.repeat(64), runtimeSize: 8 }] };
  const verify = (m, corrupt = false) => { const bytes = Buffer.from(JSON.stringify(m, null, 2) + '\n'), signature = sign(null, bytes, keys.privateKey); if (corrupt) signature[0] ^= 1;
    return verifyWebManifest(bytes, signature, { trustedKeys: { [id]: pem }, platform: 'darwin', arch: 'arm64', currentVersion: '2.0.0-beta.14', releaseVersion: m.version }); };
  assert.equal(verify(manifest).manifest.version, '2.0.0');
  assert.throws(() => verify(manifest, true), { code: 'signature_invalid' });
  assert.throws(() => verify({ ...manifest, version: '2.1.0-beta.1', packages: [{ ...manifest.packages[0], name: packageName('2.1.0-beta.1') }] }), { code: 'web_manifest_invalid' });
});
test('授权HTTP入口真实保存开关并返回渠道；重建服务后偏好仍生效', async t => {
  const directory = await mkdtemp(join(tmpdir(), '开发者更新HTTP-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const create = () => assembleSoftwareUpdates({ dataRoot: directory, origin: 'http://localhost:3001', currentVersion: '2.0.0-beta.14',
    authorize: async () => {}, networkProxy: { getStatus: () => ({ enabled: false }) } });
  let service = create();
  async function request(preferences) {
    const req = new PassThrough(); req.url = '/__guan-local/software-updates'; req.method = 'POST';
    req.headers = { host: 'localhost:3001', origin: 'http://localhost:3001', 'content-type': 'application/json', 'x-guan-local-protocol': 'guan-local-authorization.v1' };
    const result = {}, res = { writeHead: code => { result.code = code; }, end: body => { result.body = JSON.parse(body); } };
    req.end(JSON.stringify(preferences === undefined ? { operation: 'status' } : { operation: 'preferences', preferences }));
    await service.handle(req, res); return result;
  }
  try {
    const on = await request({ developerMode: true }); assert.equal(on.code, 200); assert.match(on.body.result.channel, /Beta \+ Stable/);
    await service.close(); service = create();
    assert.equal((await request()).body.result.preferences.developerMode, true);
    const off = await request({ developerMode: false }); assert.equal(off.body.result.preferences.developerMode, false); assert.match(off.body.result.channel, /Web Stable$/);
    assert.equal((await request({ developerMode: 'true' })).code, 409);
  } finally { await service.close(); }
});
