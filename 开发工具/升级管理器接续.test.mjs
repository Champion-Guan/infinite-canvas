import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, copyFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateKeyPairSync, sign } from 'node:crypto';
import { keyId } from '../扩展功能/软件更新/stable-manifest.mjs';
import { WEB_APP, WEB_ORIGIN, WEB_REPOSITORY, packageName, sha256 } from '../扩展功能/客户安装/Web发布协议.mjs';
import { writeState, readState, versionIdentity } from '../扩展功能/客户安装/Web安装目录.mjs';
import { continueSignedHelper } from '../扩展功能/客户安装/系统助手接续.mjs';
import { saveInstallConfirmation, restoreInstallConfirmation, clearInstallConfirmation } from '../扩展功能/客户安装/本次安装确认.mjs';
import { assertWebHealth, safeStartupDiagnostic } from '../扩展功能/客户安装/启动健康诊断.mjs';
import { switchWebVersion } from '../扩展功能/客户安装/Web版本事务.mjs';
import { processIdentity } from '../扩展功能/客户安装/管理进程身份.mjs';
import { readDetachedProgress, createDetachedProgressObserver } from '../扩展功能/客户安装/独立更新观察.mjs';
import { waitManagerRelease } from '../扩展功能/客户安装/管理器版本接续.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), '升级接续-')); t.after(() => rm(root, { recursive: true, force: true }));
  const paths = { root, state: join(root, '当前版本.json'), versions: join(root, '版本'), lock: join(root, '运行锁.json'), address: join(root, '运行地址.json') };
  await mkdir(paths.versions, { mode: 0o700 }); return paths;
}
const old = { name: '2.0.0-beta.9-' + 'a'.repeat(40), version: '2.0.0-beta.9', commit: 'a'.repeat(40), origin: WEB_ORIGIN, dataSchema: 1 };
const next = { ...old, name: '2.0.0-beta.11-' + 'b'.repeat(40), version: '2.0.0-beta.11', commit: 'b'.repeat(40) };
const ready = identity => ({ ready: true, version: identity.version, workspaceId: 'workspace', origin: 'http://localhost:3001' });

test('健康失败逐字段区分，异常中路径、密钥、UUID与任意字段均不进入诊断', () => {
  for (const [field, change] of [['ready', { ready: false }], ['version', { version: old.version }], ['workspace', { workspaceId: 'other' }], ['origin', { origin: 'http://remote.example' }], ['activation', { acceptingPages: false }]]) {
    assert.throws(() => assertWebHealth({ ...ready(next), ...change }, next, 'workspace', { active: true }), e => {
      assert.deepEqual(safeStartupDiagnostic(e), { code: 'web_health_mismatch', stage: 'starting', field }); return true;
    });
  }
  assert.deepEqual(safeStartupDiagnostic({ message: 'sensitive-value', path: '/private/data', field: 'secret' }), { code: 'web_start_failed', stage: 'starting' });
});
test('回退后仍保留首个启动原因，回退失败同时保留两次失败阶段', async () => {
  const saved = [], failure = Object.assign(Error('private path'), { code: 'keychain_unavailable' });
  const args = { previous: old, target: next, workspaceId: 'workspace', verify: async () => {}, stop: async () => {}, save: async x => saved.push(x), start: async identity => { if (identity === next) throw failure; return ready(identity); } };
  const result = await switchWebVersion(args);
  assert.equal(result.diagnostic.code, 'keychain_unavailable'); assert.equal(saved.at(-1).diagnostic.code, 'keychain_unavailable');
  await assert.rejects(switchWebVersion({ ...args, start: async () => { throw failure; } }), e => e.code === 'update_rollback_failed' && e.diagnostic.stage === 'starting' && e.rollbackDiagnostic.stage === 'rolling-back');
});
test('重启仅恢复30分钟内同工作区、同原版和再次验签同包的单次确认；取消立即清除', async t => {
  const paths = await fixture(t), staged = { identity: { downloadId: 'one' }, next };
  await saveInstallConfirmation(paths, 'workspace', old, staged, 1000);
  assert.equal(await restoreInstallConfirmation(paths, 'workspace', old, staged, 1001), true);
  for (const args of [['other', old, staged, 1001], ['workspace', next, staged, 1001], ['workspace', old, { ...staged, next: old }, 1001], ['workspace', old, staged, 1801001], ['workspace', old, staged, 0]]) assert.equal(await restoreInstallConfirmation(paths, ...args), false);
  await clearInstallConfirmation(paths); assert.equal(await restoreInstallConfirmation(paths, 'workspace', old, staged, 1001), false);
});

const keys = generateKeyPairSync('ed25519'), pem = keys.publicKey.export({ type: 'spki', format: 'pem' }), id = keyId(pem);
const encode = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
async function helperPackage(root, identity, binary, sourceSHA256) {
  await mkdir(join(root, '系统助手'), { recursive: true, mode: 0o700 });
  await writeFile(join(root, '系统助手/系统钥匙串'), binary, { mode: 0o700 });
  const inventory = { ...identity, helper: { sha256: sha256(binary), sourceSHA256 }, files: { '系统助手/系统钥匙串': sha256(binary) } };
  await writeFile(join(root, '工作台发布.json'), encode(inventory), { mode: 0o600 });
  const manifest = { format: 1, app: WEB_APP, channel: 'web-preview', repository: WEB_REPOSITORY, version: identity.version, commit: identity.commit,
    builtAt: '2026-10-27T00:00:00.000Z', keyId: id, inventorySHA256: sha256(encode(inventory)), packages: [{ platform: 'darwin', arch: 'arm64', name: packageName(identity.version), sha256: 'c'.repeat(64), size: 1, nodeVersion: 'v24.16.0', runtimeSha256: 'd'.repeat(64), runtimeSize: 1 }] };
  await writeFile(join(root, 'Web更新清单.json'), encode(manifest), { mode: 0o600 }); await writeFile(join(root, 'Web更新清单.sig'), sign(null, encode(manifest), keys.privateKey), { mode: 0o600 });
  return inventory;
}
test('同源码重新构建不替换已用助手，下一次启动及旧版回退均兼容；证据篡改拒绝', async t => {
  const paths = await fixture(t), source = 'e'.repeat(64), parent = join(paths.root, '助手'); await mkdir(parent, { mode: 0o700 });
  const oldRoot = join(paths.versions, old.name), nextRoot = join(paths.versions, next.name);
  const a = await helperPackage(oldRoot, old, Buffer.from('old-binary'), source), b = await helperPackage(nextRoot, next, Buffer.from('recompiled-binary'), source);
  await mkdir(join(parent, a.helper.sha256), { mode: 0o700 }); await copyFile(join(oldRoot, '系统助手/系统钥匙串'), join(parent, a.helper.sha256, '系统钥匙串'));
  await writeState(paths.state, { phase: 'switching', current: old, target: next });
  const options = { parent, verify: async () => ({ inventory: a }), evidenceOptions: { trustedKeys: { [id]: pem } } };
  const first = await continueSignedHelper(nextRoot, b, paths, options); assert.equal(first.helperSHA256, a.helper.sha256);
  assert.deepEqual(await readdir(join(parent, a.helper.sha256)), ['系统钥匙串']);
  await writeState(paths.state, { phase: 'committed', current: next, previous: old });
  assert.deepEqual(await continueSignedHelper(nextRoot, b, paths, options), first);
  await assert.rejects(continueSignedHelper(nextRoot, { ...b, helper: { ...b.helper, sourceSHA256: 'f'.repeat(64) } }, paths, options), e => e.code === 'keychain_helper_migration_required');
  const proof = join(parent, '助手签名证明', a.helper.sha256, '工作台发布.json'); await writeFile(proof, '{}');
  await assert.rejects(continueSignedHelper(nextRoot, b, paths, options), e => e.code === 'invalid_keychain_helper');
});
test('提交新版但旧管理器仍在接管时，进度不误报成功', async t => {
  const paths = await fixture(t), owner = processIdentity(process.pid);
  await writeState(paths.state, { phase: 'committed', current: next, previous: old, workspaceId: 'workspace' });
  await writeState(paths.lock, owner); await writeState(paths.address, { owner, ready: true, origin: 'http://localhost:3001', version: next.version, workspaceId: 'workspace' });
  assert.equal((await readDetachedProgress(paths, next.version)).state, 'restarting-manager');
});
test('接续不接管另一个管理器的锁，也不按PID强杀或覆盖', async t => {
  const paths = await fixture(t), owner = processIdentity(process.pid);
  await writeState(paths.lock, { ...owner, started: 'different' });
  await assert.rejects(waitManagerRelease(paths, owner, { timeout: 1 }), e => e.code === 'update_manager_handoff_failed');
  assert.equal((await readState(paths.lock)).started, 'different');
});
test('真实独立观察子进程在父IPC断开后继续提供同一只读状态地址', async t => {
  const paths = await fixture(t); await writeState(paths.state, { phase: 'switching', current: old, target: next });
  let spawned;
  const observer = createDetachedProgressObserver(target => ({ target, state: 'starting', origin: null }), paths, { onSpawn: proc => { spawned = proc; } });
  let url;
  try {
    ({ url } = await observer.open(next.version)); assert.match(url, /^http:\/\/127\.0\.0\.1:/);
    assert.equal((await (await fetch(url + 'status')).json()).state, 'starting');
    // 断开父IPC后由事务读取继续提供进度；不是关闭观察服务后新开另一个地址。
    await observer.close({ handoff: true });
    assert.ok(['starting', 'switching'].includes((await (await fetch(url + 'status')).json()).state));
  } finally {
    if (spawned && spawned.exitCode === null) await new Promise(resolve => { spawned.once('exit', resolve); spawned.kill('SIGTERM'); });
  }
});
