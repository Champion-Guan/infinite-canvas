import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SoftwareUpdates } from './software-updates.mjs';
import { StableDownload } from './stable-download.mjs';
import { readGitHubStable } from './github-stable.mjs';
import { readReleaseAsset } from './github-assets.mjs';
import { flushPrivateWrites } from './runtime-paths.mjs';
import { UpdateError } from './update-auth.mjs';
import { selectWebRelease, verifyWebManifest, WEB_MANIFEST_NAMES, webReleaseAssetName } from '../客户安装/Web发布协议.mjs';
import { StorageError, requireValue } from '../本机存储/协议.mjs';
import { jobLike } from '../生成网关/生成协议.mjs';
import { NO_RESULT_ACK } from '../生成任务/未决任务核实.mjs';

// 源码与客户包共用验签下载；只有独立客户安装管理器提供版本切换能力。
export function assembleSoftwareUpdates({ dataRoot, origin, authorize, networkProxy, generation, webPackage = true, currentVersion: installedVersion, manager = null }) {
  const directory = join(dataRoot, 'software-updates');
  const currentVersion = installedVersion || readFileSync(new URL('../../VERSION', import.meta.url), 'utf8').trim().replace(/^v/, '');
  let closed = false;
  const requests = new Set();
  const routed = operation => async options => {
    if (closed) throw new UpdateError('update_service_stopped');
    const controller = new AbortController();
    requests.add(controller);
    let lease;
    try {
      if (options.network === 'proxy' || options.network !== 'direct' && networkProxy.getStatus().enabled) {
        try { lease = networkProxy.acquireRoute('proxy'); } catch { throw new UpdateError('proxy_unavailable'); }
      }
      let proxyUrl;
      if (lease) {
        const url = new URL(lease.proxyURL);
        url.username = lease.username; url.password = lease.password; proxyUrl = url.href;
      }
      const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
      return await operation({ ...options, proxyUrl, signal });
    } finally { requests.delete(controller); lease?.release(); }
  };
  const updates = new SoftwareUpdates({ directory, currentVersion, manager, auth: { token: async () => '' },
    readRelease: routed(options => readGitHubStable({ ...options, ...(webPackage ? { selectRelease: selectWebRelease } : {}) })),
    downloader: new StableDownload({ directory: join(directory, 'packages'), readAsset: routed(readReleaseAsset), ...(webPackage ? { verifyManifest: verifyWebManifest, manifestNames: WEB_MANIFEST_NAMES, releaseAssetName: webReleaseAssetName } : {}) }) });
  // network='proxy' 的实际运行状态在每次请求取得租约时核实。
  updates.proxyUrl = () => networkProxy.getStatus().enabled ? 'managed-proxy' : null;
  const status = async () => {
    const value = await updates.status();
    return { ...value, channel: webPackage ? 'GitHub Public / Web预览版' : 'GitHub Public / Stable',
      install: { ...(!manager ? { allowed: false, state: 'source-development', reason: 'web_release_required' } : value.install), blockers: generation?.updateBlockers() || [] } };
  };
  const handle = async (request, response) => {
    if (request.url !== '/__guan-local/software-updates') return false;
    const reply = (code, value) => { if (!response.destroyed && !response.writableEnded) { response.writeHead(code, { 'content-type': 'application/json' }); response.end(JSON.stringify({ protocol: 'guan-local-authorization.v1', ...value })); } };
    try {
      requireValue(!closed && request.method === 'POST' && request.headers.host === new URL(origin).host && request.headers.origin === origin &&
        (!request.headers['sec-fetch-site'] || request.headers['sec-fetch-site'] === 'same-origin') && request.headers['content-type'] === 'application/json' && request.headers['x-guan-local-protocol'] === 'guan-local-authorization.v1',
      'update_origin_denied', '更新请求必须来自当前授权工作台。', 403);
      await authorize(request);
      const chunks = []; let size = 0;
      for await (const chunk of request) { size += chunk.length; requireValue(size <= 4096, 'request_too_large', '更新请求过大。', 413); chunks.push(chunk); }
      let input; try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new UpdateError('invalid_request'); }
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new UpdateError('invalid_request');
      const { operation, preferences, taskId, acknowledgement, ...extra } = input;
      if (Object.keys(extra).length || !['status', 'check', 'download', 'preferences', 'stage', 'approve', 'defer', 'confirm-no-result'].includes(operation) ||
        (operation !== 'preferences' && preferences !== undefined) || (operation !== 'confirm-no-result' && (taskId !== undefined || acknowledgement !== undefined)) ||
        operation === 'confirm-no-result' && (!jobLike(taskId) || acknowledgement !== NO_RESULT_ACK || !generation?.confirmNoResult)) throw new UpdateError('invalid_request');
      await authorize(request);
      if (closed) throw new UpdateError('update_service_stopped');
      if (operation === 'preferences') {
        if (!manager && preferences?.autoInstall === true) throw new UpdateError('web_release_required');
        await updates.configure(preferences);
      } else if (operation === 'check') await updates.check();
      else if (operation === 'download') await updates.download();
      else if (operation === 'stage') await updates.stage();
      else if (operation === 'approve') await updates.approve('saved-and-all-tasks-ended');
      else if (operation === 'defer') await updates.defer();
      else if (operation === 'confirm-no-result') await generation.confirmNoResult(taskId, acknowledgement);
      await authorize(request);
      reply(200, { result: await status() });
    } catch (error) {
      reply(error instanceof StorageError ? error.status : 409, { error: { code: error instanceof StorageError || error instanceof UpdateError ? error.code : 'update_operation_failed' } });
      request.resume();
    }
    return true;
  };
  return Object.freeze({ handle, status, start() { closed = false; updates.start(); }, async close() {
    closed = true; updates.stop();
    for (const controller of requests) controller.abort();
    await Promise.allSettled([updates.inFlight, updates.downloader.pending, updates.tail]);
    await flushPrivateWrites();
  } });
}
