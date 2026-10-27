import { join } from 'node:path';
import { readFile, readdir, lstat, rm, mkdir } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { privateDirectory, writePrivateFile } from '../软件更新/runtime-paths.mjs';
import { readSmartPublicResource } from '../软件更新/公共资源读取.mjs';
import { 检查目录容量 } from '../本机服务/目录容量限制.mjs';
import { installBundledProxyCore } from './安装内置代理核心.mjs';
import { requireValue } from '../本机存储/协议.mjs';

const digest = value => createHash('sha256').update(value).digest('hex'), hash = /^[a-f0-9]{64}$/;
export function selectSmartAssets(coreRelease, modelRelease) {
  requireValue(coreRelease?.tag_name === 'Prerelease-Alpha' && modelRelease?.tag_name === 'LightGBM-Model' && !coreRelease.draft && !modelRelease.draft && Array.isArray(coreRelease.assets) && Array.isArray(modelRelease.assets), 'proxy_resource_source_invalid', 'Smart发布身份不匹配。', 503);
  const select = (release, match) => {
    const values = release.assets.filter(asset => match.test(asset.name));
    requireValue(values.length === 1, 'proxy_resource_source_invalid', 'Smart发布资源不唯一。', 503);
    const asset = values[0];
    requireValue(asset.state === 'uploaded' && Number.isSafeInteger(asset.size) && asset.size > 8 && asset.size <= 32 * 1024 ** 2 && /^sha256:[a-f0-9]{64}$/.test(asset.digest), 'proxy_resource_source_invalid', 'Smart发布缺少可核验摘要或资源超限。', 503);
    const url = 'https://github.com/vernesong/mihomo/releases/download/' + release.tag_name + '/' + asset.name;
    requireValue(asset.browser_download_url === url, 'proxy_resource_source_invalid', 'Smart资源地址不匹配。', 503);
    return { name: asset.name, size: asset.size, sha256: asset.digest.slice(7), url };
  };
  return { core: select(coreRelease, /^mihomo-darwin-arm64-alpha-smart-[a-f0-9]{7,40}\.gz$/), model: select(modelRelease, /^Model-large\.bin$/) };
}

// 每天检查一次；失败至少6小时后再检查。只保留当前/上一份/单个待应用资源，写入有总预算。
export async function createSmartResourceUpdater({ cacheRoot, bundledCore, proxy, readResource = readSmartPublicResource, now = Date.now, onPending = async () => {} }) {
  await privateDirectory(cacheRoot); const directory = join(cacheRoot, '更新资源'); await privateDirectory(directory);
  const stateFile = join(cacheRoot, '资源更新.json'); let saved;
  try { const info = await lstat(stateFile); requireValue(info.isFile() && !info.isSymbolicLink() && info.uid === process.getuid() && !(info.mode & 0o077) && info.size <= 8192, 'proxy_resource_state_invalid', 'Smart更新状态异常。', 503); saved = JSON.parse(await readFile(stateFile)); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  let state = saved || { autoUpdate: true, checkedAt: 0, retryAt: 0, active: null, previous: null, pending: null, rejected: null }, flight, controller, timer, stopped = false, lastError = null, phase = 'idle';
  requireValue(typeof state.autoUpdate === 'boolean' && Number.isSafeInteger(state.checkedAt) && Number.isSafeInteger(state.retryAt) && ['active', 'previous', 'pending', 'rejected'].every(key => state[key] === null || hash.test(state[key])), 'proxy_resource_state_invalid', 'Smart更新状态无效。', 503);
  const save = () => writePrivateFile(stateFile, JSON.stringify(state));
  async function cleanup() {
    const retained = new Set([state.active, state.previous, state.pending].filter(Boolean));
    for (const name of await readdir(directory)) {
      if (!hash.test(name) || retained.has(name)) continue;
      const path = join(directory, name), info = await lstat(path);
      if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid() || info.mode & 0o077) continue;
      const files = await readdir(path);
      if (files.every(file => ['核心清单.json', '代理核心.gz', '智能选路模型.bin'].includes(file))) await rm(path, { recursive: true });
    }
  }
  await cleanup();
  const load = async id => id ? { id, ...(await installBundledProxyCore(join(directory, id), cacheRoot, { retainHashes: [bundledCore?.sha256, proxy.core?.()?.sha256].filter(Boolean) })) } : null;
  async function check(force = false) {
    if (stopped || flight || !force && (!state.autoUpdate || now() < state.retryAt)) return flight;
    controller = new AbortController();
    flight = (async () => {
      let lease, destination;
      try {
        phase = 'checking';
        if (proxy.status().enabled) lease = proxy.acquireRoute();
        const options = { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(120000)]), ...(lease ? { route: lease } : {}) };
        const json = async tag => JSON.parse(await readResource('https://api.github.com/repos/vernesong/mihomo/releases/tags/' + tag, { ...options, maxBytes: 2 * 1024 ** 2 }));
        const assets = selectSmartAssets(await json('Prerelease-Alpha'), await json('LightGBM-Model'));
        const id = digest(assets.core.sha256 + assets.model.sha256);
        state.checkedAt = now(); state.retryAt = now() + 24 * 60 * 60 * 1000;
        if ([state.active, state.pending, state.rejected].includes(id)) { await save(); return; }
        // 当前内置资源已经是上游最新时只记录检查时间，不重复下载。
        if (bundledCore?.archiveSha256 === assets.core.sha256 && bundledCore.model?.sha256 === assets.model.sha256 && !state.active) { await save(); return; }
        state.previous = null; await cleanup();
        检查目录容量(cacheRoot, { maxBytes: 512 * 1024 ** 2, incomingBytes: assets.core.size + assets.model.size + 128 * 1024 ** 2, reserveBytes: 1024 ** 3 });
        phase = 'downloading';
        const archive = await readResource(assets.core.url, { ...options, maxBytes: assets.core.size });
        requireValue(archive.length === assets.core.size && digest(archive) === assets.core.sha256, 'proxy_resource_integrity_failed', 'Smart核心摘要不符。', 503);
        const binary = gunzipSync(archive, { maxOutputLength: 128 * 1024 ** 2 });
        requireValue(binary.length >= 8 && binary.readUInt32LE(0) === 0xfeedfacf && binary.readUInt32LE(4) === 0x0100000c, 'proxy_resource_integrity_failed', 'Smart核心架构不匹配。', 503);
        const model = await readResource(assets.model.url, { ...options, maxBytes: assets.model.size });
        requireValue(model.length === assets.model.size && digest(model) === assets.model.sha256, 'proxy_resource_integrity_failed', 'Smart最大模型摘要不符。', 503);
        destination = join(directory, id); await mkdir(destination, { mode: 0o700 });
        const manifest = { version: assets.core.name.slice('mihomo-darwin-arm64-'.length, -3), variant: 'Mihomo Smart', platform: 'darwin', arch: 'arm64', sha256: digest(binary), size: binary.length,
          archiveSha256: assets.core.sha256, archiveSize: archive.length, model: { file: '智能选路模型.bin', variant: 'large', size: model.length, sha256: assets.model.sha256 }, source: assets.core.url, license: 'GPL-3.0' };
        await writePrivateFile(join(destination, '代理核心.gz'), archive); await writePrivateFile(join(destination, '智能选路模型.bin'), model); await writePrivateFile(join(destination, '核心清单.json'), JSON.stringify(manifest));
        state.pending = id; await save(); destination = null;
        lastError = null; phase = 'pending';
      } catch (error) {
        if (!controller.signal.aborted) { lastError = /^[a-z_]{3,64}$/.test(error.code || '') ? error.code : 'proxy_resource_update_failed'; state.retryAt = now() + 6 * 60 * 60 * 1000; await save(); phase = 'error'; }
      } finally { lease?.release(); if (destination) await rm(destination, { recursive: true, force: true }); if (phase === 'checking') phase = lastError ? 'error' : 'idle'; }
    })().finally(() => { flight = null; controller = null; });
    await flight;
    if (state.pending && !stopped) await onPending();
  }
  return Object.freeze({
    status: () => ({ autoUpdate: state.autoUpdate, state: state.pending ? 'pending' : phase, checkedAt: state.checkedAt || null, error: lastError, model: 'large' }),
    async candidate() { try { return await load(state.autoUpdate ? state.pending || state.active : state.active); } catch (error) { lastError = 'proxy_resource_integrity_failed'; if (state.pending) { state.rejected = state.pending; state.pending = null; await save(); } return null; } },
    async accept(value) { if (!value?.id || value.id === state.active) return; state.previous = state.active; state.active = value.id; state.pending = null; phase = 'idle'; lastError = null; await save(); await rm(join(directory, value.id, '代理核心.gz'), { force: true }); await cleanup(); },
    async reject(value) { if (!value?.id) return; state.rejected = value.id; if (state.active === value.id) { state.active = state.previous; state.previous = null; } state.pending = null; phase = 'error'; lastError = 'proxy_resource_activation_failed'; await save(); await cleanup(); },
    check,
    async configure(autoUpdate) { requireValue(typeof autoUpdate === 'boolean', 'proxy_source_invalid', '自动更新开关无效。'); state.autoUpdate = autoUpdate; await save(); },
    start() { if (timer) return; stopped = false; timer = setInterval(() => { if (state.pending) void onPending().catch(() => {}); else void check().catch(() => {}); }, 30000); timer.unref(); },
    async close() { stopped = true; clearInterval(timer); timer = null; controller?.abort(); await flight; },
  });
}
