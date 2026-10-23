import { createHash, randomUUID } from 'node:crypto';
import { requireValue } from '../本机存储/协议.mjs';
import { bindingLike, exactKeys, jobLike, validateSubmission, MAX_REQUEST_BYTES } from '../生成网关/生成协议.mjs';
import { createFallbackStore, hashJSON } from './SQLite切换配置.mjs';
import { enabledEntries } from './原版策略.mjs';

const planFormat = 'guan-routed-image-plan.v1', requestFormat = 'guan-routed-image-request.v1';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const safeString = (value, size = 200) => typeof value === 'string' && value.length > 0 && value.length <= size && !/[\r\n\0]/.test(value);
const placeholder = '00000000-0000-4000-8000-000000000001';
export const canAdvanceFallback = status => [401, 403, 404, 429].includes(status);

// 候选列表及各协议请求摘要在发送前固定；POST超时/5xx/取消/格式异常一律停止。
// 无正文、提示词或密钥进入计划/尝试日志。既有任务账本负责冷启动不重发。
export function createRoutedImageGateway({ workspace, base, proxied, networkProxy, runTrustedWrite }) {
  const config = createFallbackStore({ workspace, runTrustedWrite });
  async function saveDocument(id, value, revision) {
    return runTrustedWrite(() => {
      const operationId = randomUUID(), expectedHash = hashJSON(value);
      try {
        const ack = workspace.writeDocument({ collection: 'extension', id, value, expectedRevision: revision, operationId });
        requireValue(ack.persisted === true && ack.workspaceId === workspace.workspaceId && ack.collection === 'extension' && ack.id === id && ack.operationId === operationId && ack.revision === revision + 1 && ack.hash === expectedHash, 'fallback_save_unconfirmed', '切换计划保存未确认。', 503);
      } catch (error) {
        const actual = workspace.readDocument('extension', id);
        if (actual?.revision !== revision + 1 || actual.hash !== expectedHash) throw error;
      }
    });
  }
  function readPlan(id) {
    const doc = workspace.readDocument('extension', id);
    if (doc?.value?.format !== planFormat) return null;
    const plan = doc.value;
    requireValue(doc.workspaceId === workspace.workspaceId && doc.revision === 1 && !doc.mediaIds.length && id === 'provider:' + hashJSON(plan) &&
      exactKeys(plan, ['format', 'mode', 'capability', 'revision', 'transport', 'candidates']) && ['single', 'fallback'].includes(plan.mode) && plan.capability === 'image' &&
      Number.isSafeInteger(plan.revision) && plan.revision >= 0 && ['direct', 'proxy'].includes(plan.transport) && Array.isArray(plan.candidates) && plan.candidates.length > 0 && plan.candidates.length <= 32,
    'fallback_plan_invalid', '切换计划不完整，未改用其他渠道。', 409);
    for (const entry of plan.candidates) {
      requireValue(exactKeys(entry, ['profileId', 'modelName', 'binding', 'requestHash', 'quality', 'size', 'channelName', 'kind', 'endpoint']) &&
        safeString(entry.profileId) && safeString(entry.modelName) && safeString(entry.channelName) && bindingLike(entry.binding) && /^[a-f0-9]{64}$/.test(entry.requestHash) &&
        typeof entry.quality === 'string' && entry.quality.length <= 80 && typeof entry.size === 'string' && entry.size.length <= 80,
      'fallback_plan_invalid', '切换模型计划无效。', 409);
      const binding = base.describe(entry.binding);
      requireValue(binding.kind === entry.kind && binding.endpoint === entry.endpoint, 'fallback_plan_invalid', '渠道绑定已变化。', 409);
    }
    return plan;
  }
  function assertPolicy(plan) {
    if (plan.mode !== 'fallback') return;
    const stored = config.read(), entries = enabledEntries(stored.value, 'image');
    requireValue(stored.revision === plan.revision && entries.length === plan.candidates.length && entries.every((entry, index) =>
      entry.profileId === plan.candidates[index].profileId && entry.modelName === plan.candidates[index].modelName),
    'fallback_config_changed', 'Fallback配置已改变，请重新检查后再生成。', 409);
  }
  function decode(plan, request) {
    requireValue(request.method === 'POST' && request.path === '/v1/images/generations' && request.contentType === 'application/json', 'fallback_request_invalid', '切换任务信封无效。');
    let payload;
    try { payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(request.body, 'base64'))); } catch { requireValue(false, 'fallback_request_invalid', '切换请求编码无效。'); }
    requireValue(exactKeys(payload, ['format', 'requests']) && payload.format === requestFormat && Array.isArray(payload.requests) && payload.requests.length === plan.candidates.length && Buffer.byteLength(JSON.stringify(payload)) <= MAX_REQUEST_BYTES,
      'fallback_request_invalid', '切换任务请求数量或大小无效。');
    payload.requests.forEach((item, index) => {
      validateSubmission({ id: placeholder, productId: 'validation', nodeId: 'validation', binding: plan.candidates[index].binding, request: item });
      requireValue(item.method === 'POST' && (/^\/v1\/images\/(?:generations|edits)$/.test(item.path) || /^\/v1(?:beta)?\/models\/[\w.:-]+:generateContent$/.test(item.path)) && hashJSON(item) === plan.candidates[index].requestHash,
        'fallback_request_changed', '渠道请求与保存计划不匹配，未发送。', 409);
      base.validate(plan.candidates[index].binding, item);
    });
    return payload.requests;
  }
  return Object.freeze({ bind: base.bind, describe(id) { const plan = readPlan(id); return plan ? { binding: id, kind: 'routed-image', endpoint: '' } : base.describe(id); },
    fallbackLoad: config.read, fallbackSave: config.save,
    async createPlan(value) {
      requireValue(exactKeys(value, ['mode', 'capability', 'revision', 'candidates']) && ['single', 'fallback'].includes(value.mode) && value.capability === 'image' && Number.isSafeInteger(value.revision) && value.revision >= 0 &&
        Array.isArray(value.candidates) && value.candidates.length > 0 && value.candidates.length <= 32 && (value.mode !== 'single' || value.candidates.length === 1), 'fallback_plan_invalid', '切换计划参数无效。');
      const candidates = value.candidates.map(entry => {
        requireValue(exactKeys(entry, ['profileId', 'modelName', 'binding', 'requestHash', 'quality', 'size', 'channelName']) && safeString(entry.profileId) && safeString(entry.modelName) && safeString(entry.channelName) &&
          bindingLike(entry.binding) && /^[a-f0-9]{64}$/.test(entry.requestHash) && typeof entry.quality === 'string' && entry.quality.length <= 80 && typeof entry.size === 'string' && entry.size.length <= 80,
        'fallback_plan_invalid', '切换候选字段无效。');
        const binding = base.describe(entry.binding);
        return { ...entry, kind: binding.kind, endpoint: binding.endpoint };
      });
      const proxy = networkProxy?.getStatus(), transport = proxy?.enabled === true ? 'proxy' : 'direct';
      requireValue(transport !== 'proxy' || proxy.running && !proxy.busy && proxied, 'proxy_not_running', '已启用的网络代理未就绪，未改为直连。', 409);
      const plan = { format: planFormat, mode: value.mode, capability: 'image', revision: value.revision, transport, candidates };
      assertPolicy(plan);
      const id = 'provider:' + hashJSON(plan), before = workspace.readDocument('extension', id);
      if (before) readPlan(id); else await saveDocument(id, plan, 0);
      return { binding: id };
    },
    validate(id, request) {
      const plan = readPlan(id);
      if (!plan) return base.validate(id, request);
      assertPolicy(plan); decode(plan, request);
    },
    async execute(id, request, { signal, taskId } = {}) {
      const plan = readPlan(id);
      if (!plan) return base.execute(id, request, { signal });
      requireValue(jobLike(taskId), 'fallback_task_invalid', '切换执行需要已落盘任务身份。');
      assertPolicy(plan); const requests = decode(plan, request), traceId = 'guan-fallback-attempt:' + taskId;
      requireValue(!workspace.readDocument('extension', traceId), 'fallback_already_dispatched', '任务已有执行记录，不会重新发出。', 409);
      // 整个切换链锁定网络模式。直连计划过期后也不能绕过新启用的代理。
      const route = networkProxy?.acquireRoute(plan.transport) ?? null;
      try {
      let revision = 0;
      const trace = { format: 'guan-fallback-attempt.v1', taskId, binding: id, phase: 'dispatching', attempts: [], routing: null };
      for (let index = 0; index < plan.candidates.length; index++) {
        signal?.throwIfAborted();
        const entry = plan.candidates[index]; trace.phase = 'dispatching'; trace.attempts.push({ index, binding: entry.binding, status: null });
        await saveDocument(traceId, trace, revision++); signal?.throwIfAborted();
        const selected = plan.transport === 'proxy' ? proxied : base;
        requireValue(selected, 'proxy_not_running', '受管代理未接入，没有改用直连。', 409);
        const result = await selected.execute(entry.binding, requests[index], { signal, route });
        signal?.throwIfAborted();
        requireValue(Buffer.isBuffer(result.bytes) && result.bytes.length > 0, 'fallback_response_invalid', '上游没有可确认响应，不再切换。', 502);
        trace.attempts[index].status = result.status;
        const next = plan.mode === 'fallback' && canAdvanceFallback(result.status) && index + 1 < plan.candidates.length;
        trace.phase = next ? 'rejected' : 'complete';
        if (!next) trace.routing = { index, modelOption: entry.profileId + '::' + entry.modelName, profileId: entry.profileId, modelName: entry.modelName, channelName: entry.channelName,
          kind: entry.kind, endpoint: entry.endpoint, transport: plan.transport, quality: entry.quality, size: entry.size, responseHash: digest(result.bytes) };
        await saveDocument(traceId, trace, revision++);
        if (!next) return result;
      }
      throw Error('不可达的切换状态');
      } finally { route?.release(); }
    },
    resultRoute(taskId, responseHash) {
      const doc = workspace.readDocument('extension', 'guan-fallback-attempt:' + taskId);
      if (!doc) return null;
      requireValue(doc.workspaceId === workspace.workspaceId && !doc.mediaIds.length && doc.hash === hashJSON(doc.value) && doc.value.format === 'guan-fallback-attempt.v1' && doc.value.taskId === taskId &&
        doc.value.phase === 'complete' && doc.value.routing?.responseHash === responseHash && bindingLike(doc.value.binding), 'fallback_result_unconfirmed', '最终渠道与结果摘要不匹配，未交付。', 409);
      const plan = readPlan(doc.value.binding), route = doc.value.routing, entry = plan?.candidates[route.index];
      requireValue(entry && entry.profileId === route.profileId && entry.modelName === route.modelName && entry.kind === route.kind && entry.endpoint === route.endpoint && plan.transport === route.transport,
        'fallback_result_unconfirmed', '最终渠道记录不匹配。', 409);
      return structuredClone(route);
    },
  });
}
