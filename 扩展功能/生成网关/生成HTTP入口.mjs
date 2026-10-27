import { StorageError, requireValue, validId } from '../本机存储/协议.mjs';
import { GENERATION_PROTOCOL, MAX_REQUEST_BYTES, exactKeys, jobLike, bindingLike } from './生成协议.mjs';
import { observeTextProgress } from './文本进度观察.mjs';

const path = '/__guan-local/generation';
// 不签发新权限。authorize必须复用当前工作台页面能力、数据租约、撤销和期限检查。
// 回调需要每次重新核验，尤其是慢请求和执行后；不能传入永久true的生产装配。
export function createGenerationHTTPHandler({ origin, authorize, gateway, tasks, videos, models, readCanvasCheckpoint, maxRequests = 4, rateLimit = 120, now = Date.now } = {}) {
  requireValue(/^http:\/\/(?:localhost|127\.0\.0\.1):\d+$/.test(origin) && typeof authorize === 'function' && gateway?.bind && tasks?.submit &&
    Number.isInteger(maxRequests) && maxRequests > 0 && maxRequests <= 8 && Number.isInteger(rateLimit) && rateLimit > 0 && rateLimit <= 240 && typeof now === 'function', 'invalid_generation_http', '必须复用可信工作台授权入口。');
  let active = 0, observers = 0, count = 0, windowStart = null;
  return async function handle(request, response) {
    if (request.url !== path) return false;
    response.setHeader('Cache-Control', 'no-store'); response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    response.setHeader('Referrer-Policy', 'no-referrer');
    const json = (status, value) => { if (!response.destroyed && !response.writableEnded) { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(value)); } };
    let counted = false;
    try {
      requireValue(request.headers.host === new URL(origin).host && request.headers.origin === origin && (!request.headers['sec-fetch-site'] || request.headers['sec-fetch-site'] === 'same-origin'), 'generation_origin_denied', '生成请求必须来自当前工作台。', 403);
      requireValue(request.method === 'POST' && request.headers['content-type'] === 'application/json' && request.headers['x-guan-generation-protocol'] === GENERATION_PROTOCOL, 'generation_headers_denied', '生成请求协议不匹配。', 403);
      await authorize(request);
      const time = now(); requireValue(Number.isSafeInteger(time) && time >= 0, 'invalid_generation_clock', '任务时钟无效。');
      if (windowStart === null || time - windowStart >= 60_000) { windowStart = time; count = 0; }
      requireValue(++count <= rateLimit && active < maxRequests, 'generation_http_busy', '生成入口繁忙，请稍后查询原任务。', 429);
      active++; counted = true;
      const limit = Math.ceil(MAX_REQUEST_BYTES / 3) * 4 + 16384, length = request.headers['content-length'];
      requireValue(!length || /^\d+$/.test(length) && Number(length) <= limit, 'generation_body_too_large', '生成请求超过限制。', 413);
      const chunks = []; let size = 0;
      for await (const chunk of request) { size += chunk.length; requireValue(size <= limit, 'generation_body_too_large', '生成请求超过限制。', 413); chunks.push(chunk); }
      let value;
      try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); } catch { throw new StorageError('generation_json_invalid', '生成请求格式无效。'); }
      await authorize(request);
      if (exactKeys(value, ['operation', 'id']) && value.operation === 'text-observe' && jobLike(value.id) && tasks.textProgress && tasks.waitTextProgress) {
        requireValue(observers < maxRequests, 'generation_observation_busy', '文本观察已满，请查询原任务。', 429);
        tasks.get(value.id);
        active--; counted = false; observers++;
        try { await observeTextProgress({ request, response, authorize, tasks, id: value.id }); } finally { observers--; }
        return true;
      }
      let result;
      if (exactKeys(value, ['operation', 'profile']) && value.operation === 'bind') result = await gateway.bind(value.profile);
      else if (exactKeys(value, ['operation', 'profile']) && value.operation === 'resolve-saved') result = gateway.resolveSaved(value.profile);
      else if (models && exactKeys(value, ['operation', 'binding']) && value.operation === 'models' && bindingLike(value.binding)) result = await models.read(value.binding);
      else if (exactKeys(value, ['operation']) && value.operation === 'fallback-load') result = gateway.fallbackLoad();
      else if (exactKeys(value, ['operation', 'value', 'revision']) && value.operation === 'fallback-save') result = await gateway.fallbackSave(value.value, value.revision);
      else if (exactKeys(value, ['operation', 'plan']) && value.operation === 'route-plan') result = await gateway.createPlan(value.plan);
      else if (exactKeys(value, ['operation', 'binding']) && value.operation === 'describe' && bindingLike(value.binding)) result = gateway.describe(value.binding);
      else if (exactKeys(value, ['operation', 'binding']) && value.operation === 'credential-preview' && bindingLike(value.binding)) result = await gateway.previewCredential(value.binding);
      else if (exactKeys(value, ['operation', 'id']) && value.operation === 'checkpoint' && jobLike(value.id) && typeof readCanvasCheckpoint === 'function') result = await readCanvasCheckpoint(value.id);
      else if (videos && exactKeys(value, ['operation', 'scope', 'request']) && value.operation === 'video-create') result = await videos.create(value.scope, value.request);
      else if (videos && exactKeys(value, ['operation', 'scope', 'remoteId']) && value.operation === 'video-ensure') result = await videos.ensure(value.scope, value.remoteId);
      else if (videos && exactKeys(value, ['operation', 'productId', 'nodeId']) && value.operation === 'video-find') result = videos.find(value.productId, value.nodeId);
      else if (videos && exactKeys(value, ['operation', 'id']) && value.operation === 'video-terminal' && jobLike(value.id)) result = await videos.confirmTerminal(value.id);
      else if (videos && exactKeys(value, ['operation', 'id']) && value.operation === 'video-poll' && jobLike(value.id)) result = await videos.poll(value.id);
      else if (videos && exactKeys(value, ['operation', 'id']) && value.operation === 'video-download' && jobLike(value.id)) result = await videos.download(value.id);
      else if (exactKeys(value, ['operation', 'task']) && value.operation === 'submit') result = await tasks.submit(value.task);
      else if (exactKeys(value, ['operation', 'task']) && value.operation === 'retire-prepared' && tasks.retirePreparedTask) result = await tasks.retirePreparedTask(value.task);
      else if (exactKeys(value, ['operation', 'productId']) && value.operation === 'list' && validId(value.productId)) result = tasks.list(value.productId);
      else if (exactKeys(value, ['operation', 'id', 'checkpoint']) && value.operation === 'applied' && jobLike(value.id)) result = await tasks.confirmApplied(value.id, value.checkpoint);
      else if (exactKeys(value, ['operation', 'id']) && jobLike(value.id) && ['get', 'result', 'cancel', 'retry-save'].includes(value.operation)) {
        if (value.operation === 'get') result = tasks.get(value.id);
        if (value.operation === 'cancel') result = await tasks.cancel(value.id);
        if (value.operation === 'retry-save') result = await tasks.retryResultSave(value.id);
        if (value.operation === 'result') { const saved = tasks.result(value.id); result = { ...saved, routing: gateway.resultRoute?.(saved.id, saved.result.id) ?? null, bytes: saved.bytes.toString('base64') }; }
      } else requireValue(false, 'generation_command_denied', '生成操作不受支持。');
      await authorize(request); // 已撤销页面不能取走结果；任务本身继续保存在本机。
      json(200, { protocol: GENERATION_PROTOCOL, result });
    } catch (error) {
      const known = error instanceof StorageError;
      json(known ? error.status : 503, { protocol: GENERATION_PROTOCOL, error: { code: known && /^[a-z_]{3,64}$/.test(error.code) ? error.code : 'generation_unavailable', message: '生成请求未确认。原配置与任务结果保留，请勿自动重复生成。' } });
      request.resume();
    } finally { if (counted) active--; }
    return true;
  };
}
