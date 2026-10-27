import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { createSmartResourceUpdater, selectSmartAssets } from '../扩展功能/网络代理/Smart资源自动更新.mjs';
import { readSmartPublicResource } from '../扩展功能/软件更新/公共资源读取.mjs';
import { openNetworkProxyService } from '../扩展功能/网络代理/代理服务.mjs';
import { openWorkspace } from '../扩展功能/本机存储/SQLite工作区.mjs';
import { openSQLiteCredentialVault } from '../扩展功能/本机凭据/SQLite凭据保管.mjs';
import { randomBytes } from 'node:crypto';

const hash = value => createHash('sha256').update(value).digest('hex');
async function fixture(run) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'Smart自动更新验收-')));
  let updater;
  try {
    const raw = Buffer.alloc(64); raw.writeUInt32LE(0xfeedfacf); raw.writeUInt32LE(0x0100000c, 4);
    const core = gzipSync(raw), model = Buffer.from('合成模型，仅供下载完整性测试，不用于推断'), requests = [];
    const asset = (name, bytes, tag) => ({ name, size: bytes.length, state: 'uploaded', digest: 'sha256:' + hash(bytes), browser_download_url: 'https://github.com/vernesong/mihomo/releases/download/' + tag + '/' + name });
    const coreRelease = { tag_name: 'Prerelease-Alpha', draft: false, assets: [asset('mihomo-darwin-arm64-alpha-smart-abcdef0.gz', core, 'Prerelease-Alpha')] };
    const modelRelease = { tag_name: 'LightGBM-Model', draft: false, assets: [asset('Model-large.bin', model, 'LightGBM-Model')] };
    let corrupt = false, time = Date.now(), pending = 0;
    const args = { cacheRoot: root, bundledCore: { archiveSha256: '0'.repeat(64), model: { sha256: '1'.repeat(64) } }, proxy: { status: () => ({ enabled: false }) }, now: () => time,
      onPending: async () => { pending++; }, readResource: async url => {
        requests.push(url);
        return url.endsWith('/Prerelease-Alpha') ? Buffer.from(JSON.stringify(coreRelease)) : url.endsWith('/LightGBM-Model') ? Buffer.from(JSON.stringify(modelRelease)) : url.endsWith('.gz') ? core : corrupt ? Buffer.from('bad') : model;
      } };
    updater = await createSmartResourceUpdater(args);
    await run({ updater, args, coreRelease, modelRelease, root, requests, corrupt: () => { corrupt = true; }, advance: () => { time += 24 * 60 * 60 * 1000 + 1; }, pending: () => pending });
  } finally { await updater?.close(); await rm(root, { recursive: true, force: true }); }
}
test('固定官方资产及最大模型；拒绝缺摘要、来源改变与小模型替代', () => fixture(async ({ coreRelease, modelRelease }) => {
  assert.equal(selectSmartAssets(coreRelease, modelRelease).model.name, 'Model-large.bin');
  for (const changed of [{ ...modelRelease, assets: [{ ...modelRelease.assets[0], digest: null }] }, { ...modelRelease, assets: [{ ...modelRelease.assets[0], name: 'Model.bin' }] }, { ...modelRelease, assets: [{ ...modelRelease.assets[0], browser_download_url: 'https://evil.invalid/a' }] }]) assert.throws(() => selectSmartAssets(coreRelease, changed));
}));
test('自动下载校验→待空闲→验收提交；清理压缩缓存，冷重开复用，24小时内不重复下载', () => fixture(async ({ updater, args, root, requests, pending }) => {
  await updater.check(); assert.equal(updater.status().state, 'pending'); assert.equal(pending(), 1);
  const candidate = await updater.candidate(); assert.ok(candidate.model); assert.equal((await readFile(candidate.path)).length, 64);
  await updater.accept(candidate);
  assert.equal((await readdir(join(root, '更新资源', candidate.id))).includes('代理核心.gz'), false);
  const count = requests.length; await updater.check(); assert.equal(requests.length, count);
  await updater.close(); const next = await createSmartResourceUpdater(args);
  try { assert.equal((await next.candidate()).sha256, candidate.sha256); assert.equal(next.status().autoUpdate, true); }
  finally { await next.close(); }
}));
test('内置资源已经最新时仅读取元数据，结束后退出检查状态', () => fixture(async ({ args, coreRelease, modelRelease, requests }) => {
  const updater = await createSmartResourceUpdater({ ...args, cacheRoot: join(args.cacheRoot, '已是最新'), bundledCore: { archiveSha256: coreRelease.assets[0].digest.slice(7), model: { sha256: modelRelease.assets[0].digest.slice(7) } } });
  try { await updater.check(); assert.equal(updater.status().state, 'idle'); assert.equal(updater.status().error, null); assert.equal(requests.length, 2); assert.equal(await updater.candidate(), null); }
  finally { await updater.close(); }
}));
test('模型篡改不改变活动资源，失败退避；用户关闭后不自动检查或应用待更新', () => fixture(async ({ updater, corrupt, requests, root }) => {
  corrupt(); await updater.check(); assert.equal(updater.status().error, 'proxy_resource_integrity_failed'); assert.equal(await updater.candidate(), null);
  const count = requests.length; await updater.check(); assert.equal(requests.length, count); assert.deepEqual(await readdir(join(root, '更新资源')), []);
  await updater.configure(false); await updater.check(); assert.equal(requests.length, count);
}));
test('新核心健康失败拒绝候选，不重复安装相同失败资源', () => fixture(async ({ updater, requests }) => {
  await updater.check(); const value = await updater.candidate(); await updater.reject(value);
  assert.equal(updater.status().error, 'proxy_resource_activation_failed'); assert.equal(await updater.candidate(), null);
  const count = requests.length; await updater.check(true); assert.equal(requests.length, count + 2);
}));
test('公共资源读取拒绝其他仓库、任意URL和异常重定向；正文有严格尺寸上限', async () => {
  let calls = 0;
  const fake = async () => { calls++; return new Response('too-long-body'); };
  await assert.rejects(readSmartPublicResource('https://evil.invalid/a', { maxBytes: 8, fetchImpl: fake })); assert.equal(calls, 0);
  await assert.rejects(readSmartPublicResource('https://api.github.com/repos/vernesong/mihomo/releases/tags/Prerelease-Alpha', { maxBytes: 8, fetchImpl: fake }));
  await assert.rejects(readSmartPublicResource('https://github.com/vernesong/mihomo/releases/download/LightGBM-Model/Model-large.bin', { maxBytes: 8, fetchImpl: async () => new Response(null, { status: 302, headers: { location: 'https://evil.invalid/a' } }) }));
});
for (const fail of [false, true]) test('代理请求中不切换；空闲应用' + (fail ? '失败恢复旧核心且保留配置' : '成功并保留原配置'), () => fixture(async ({ args, root }) => {
  const workspace = openWorkspace({ dataRoot: join(root, '数据'), initialize: true }), key = randomBytes(32);
  const vault = await openSQLiteCredentialVault({ workspace, initialize: true, keyProvider: { read: async () => Buffer.from(key), create: async () => Buffer.from(key) } });
  let service, oldStarts = 0, newStarts = 0, stops = 0, selected = 'Smart';
  const handle = () => { selected = 'Smart'; return { running: () => true, stop: async () => { stops++; }, route: () => ({ proxyURL: 'http://127.0.0.1:12345', username: 'workbench', password: 'synthetic' }), smartStatus: () => ({ enabled: true, modelBundled: true }),
    inspect: async () => [{ name: '主线路', type: 'Selector', selected, choices: ['Smart', '手动节点'] }], select: async (group, name) => { selected = name; } }; };
  try {
    service = await openNetworkProxyService({ workspace, vault, runTrustedWrite: fn => fn(), runtime: { start: async () => { oldStarts++; return handle(); } },
      resourceUpdateOptions: { ...args, cacheRoot: join(root, '服务缓存'), runtimeFactory: () => ({ start: async () => { newStarts++; if (fail) throw Error('合成启动失败'); return handle(); } }) } });
    await service.configure({ configText: 'proxies:\n  - {name: 测试节点, type: socks5, server: 127.0.0.1, port: 1}\n', subscriptionUrl: '' });
    await service.select('主线路', '手动节点');
    const lease = service.acquireRoute();
    await service.resourceCheck(); assert.equal(newStarts, 0); assert.equal(stops, 0); assert.equal(service.status().resourceUpdate.state, 'pending');
    lease.release(); await service.resourceCheck();
    assert.equal(newStarts, 1); assert.equal(service.status().running, true); assert.equal(service.status().configured, true);
    assert.equal(service.status().enabled, true); assert.equal(service.status().relayEnabled, true);
    assert.equal(oldStarts, fail ? 2 : 1); assert.equal(service.status().resourceUpdate.error, fail ? 'proxy_resource_activation_failed' : null);
    assert.equal(selected, '手动节点');
  } finally { await service?.close(); vault.close(); workspace.close(); key.fill(0); }
}));

test('损坏的更新状态只暂停资源更新，不阻断原代理启动，原文件保留', () => fixture(async ({ args, root }) => {
  const workspace = openWorkspace({ dataRoot: join(root, '数据'), initialize: true }), key = randomBytes(32);
  const vault = await openSQLiteCredentialVault({ workspace, initialize: true, keyProvider: { read: async () => Buffer.from(key), create: async () => Buffer.from(key) } });
  const cacheRoot = join(root, '损坏状态'); await mkdir(cacheRoot, { mode: 0o700 });
  const file = join(cacheRoot, '资源更新.json'); await writeFile(file, '{broken', { mode: 0o600 });
  let service;
  try {
    service = await openNetworkProxyService({ workspace, vault, runTrustedWrite: fn => fn(), runtime: { start: async () => ({ running: () => true, stop: async () => {} }) }, resourceUpdateOptions: { ...args, cacheRoot } });
    await service.configure({ configText: 'proxies:\n  - {name: 测试节点, type: socks5, server: 127.0.0.1, port: 1}\n', subscriptionUrl: '' });
    assert.equal(service.status().running, true); assert.equal(service.status().resourceUpdate.error, 'proxy_resource_state_invalid');
    await assert.rejects(service.resourceCheck(), { code: 'proxy_resource_state_invalid' });
    assert.equal(await readFile(file, 'utf8'), '{broken');
  } finally { await service?.close(); vault.close(); workspace.close(); key.fill(0); }
}));
