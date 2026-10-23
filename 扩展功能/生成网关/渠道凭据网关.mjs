import { createHash, randomUUID } from 'node:crypto';
import { StorageError, requireValue } from '../本机存储/协议.mjs';
import { validCredentialRef, validCredentialValue } from '../本机凭据/凭据协议.mjs';
import { bindingLike, exactKeys, MAX_RESPONSE_BYTES } from './生成协议.mjs';
import { normalizeEndpoint, planProviderRequest } from './受限请求规划.mjs';
import { requestProviderBytes } from './受限上游传输.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const format = 'guan-provider-binding.v1';
const hashJSON = value => digest(JSON.stringify(value));
const safeError = () => new StorageError('provider_unavailable', '本机渠道暂时不可用，原配置已保留。', 503);

export function createProviderCredentialGateway({ workspace, vault, coordinator, testOrigins = [], requestBytes = requestProviderBytes } = {}) {
  requireValue(workspace?.workspaceId && typeof workspace.readDocument === 'function' && typeof workspace.writeDocument === 'function' &&
    typeof vault?.store === 'function' && typeof vault.read === 'function' && typeof coordinator?.runWrite === 'function' &&
    Array.isArray(testOrigins) && testOrigins.every(value => /^http:\/\/127\.0\.0\.1:\d+$/.test(value)), 'invalid_provider_gateway', '渠道必须在可信本机进程中装配。');
  const publicBinding = (id, profile) => ({ binding: id, kind: profile.kind, endpoint: profile.endpoint });
  function readBinding(id) {
    requireValue(bindingLike(id), 'invalid_provider_binding', '渠道引用无效。');
    const doc = workspace.readDocument('extension', id);
    requireValue(doc?.revision === 1 && doc.workspaceId === workspace.workspaceId && doc.mediaIds.length === 0 &&
      exactKeys(doc.value, ['format', 'kind', 'endpoint', 'credentialRef']) && doc.value.format === format && ['openai', 'gemini'].includes(doc.value.kind) && validCredentialRef(doc.value.credentialRef) &&
      normalizeEndpoint(doc.value.endpoint, { testOrigins }) === doc.value.endpoint && id === 'provider:' + hashJSON(doc.value),
    'provider_binding_missing', '渠道绑定缺失或不匹配，未改用其他密钥。', 409);
    return doc.value;
  }
  async function bind(value, serverMigration = false) {
    requireValue(exactKeys(value, serverMigration ? ['kind', 'endpoint', 'credentialRef'] : ['kind', 'endpoint', 'value']), 'invalid_provider_binding', '渠道绑定字段无效。');
    requireValue(['openai', 'gemini'].includes(value.kind), 'provider_kind_denied', '本批只支持OpenAI兼容与Gemini渠道。');
    const endpoint = normalizeEndpoint(value.endpoint, { testOrigins });
    requireValue(value.credentialRef ? validCredentialRef(value.credentialRef) : validCredentialValue(value.value) && !/[\r\n\0]/.test(value.value), 'invalid_provider_credential', '渠道凭据无效。');
    let ref;
    try {
      ref = value.credentialRef || await vault.store(value.value);
      const saved = await vault.read(ref);
      requireValue(validCredentialValue(saved) && !/[\r\n\0]/.test(saved), 'invalid_provider_credential', '渠道凭据无效。');
    } catch { throw safeError(); }
    const profile = { format, kind: value.kind, endpoint, credentialRef: ref }, id = 'provider:' + hashJSON(profile);
    return coordinator.runWrite(() => {
      const existing = workspace.readDocument('extension', id);
      if (existing) { readBinding(id); return publicBinding(id, profile); }
      const operationId = randomUUID(), ack = workspace.writeDocument({ collection: 'extension', id, value: profile, expectedRevision: 0, operationId });
      requireValue(ack.persisted === true && ack.workspaceId === workspace.workspaceId && ack.operationId === operationId && ack.hash === hashJSON(profile) && ack.revision === 1 && ack.id === id && ack.collection === 'extension', 'provider_save_unconfirmed', '渠道绑定保存未确认。', 503);
      return publicBinding(id, profile);
    });
  }
  return Object.freeze({
    bind: value => bind(value),
    // 仅可信后端迁移器可用，HTTP不暴露此入口；不能让页面用已知secret引用重定向旧密钥。
    bindExistingProfile: value => bind(value, true),
    describe(id) { return publicBinding(id, readBinding(id)); },
    validate(id, request) { const profile = readBinding(id); planProviderRequest(profile, request.path, request.method, request.contentType); },
    async execute(id, request, { signal, route } = {}) {
      const profile = readBinding(id), plan = planProviderRequest(profile, request.path, request.method, request.contentType);
      let credential;
      try { credential = await vault.read(profile.credentialRef); } catch { throw safeError(); }
      requireValue(validCredentialValue(credential) && !/[\r\n\0]/.test(credential), 'provider_unavailable', '本机渠道暂时不可用。', 503);
      const headers = { ...plan.headers, [profile.kind === 'gemini' ? 'x-goog-api-key' : 'authorization']: profile.kind === 'gemini' ? credential : 'Bearer ' + credential };
      const result = await requestBytes({ ...plan, method: request.method, headers, bytes: Buffer.from(request.body, 'base64'), signal, testOrigins, route });
      requireValue(Number.isInteger(result.status) && result.status >= 200 && result.status <= 599 && result.bytes.length <= MAX_RESPONSE_BYTES &&
        result.contentType.length <= 256 && !/[\r\n\0]/.test(result.contentType), 'provider_response_invalid', '渠道响应未通过检查。', 502);
      // 继承旧代理的已知凭据回显消毒，完整缓冲避免跨chunk漏出。
      // 这不是任意脚本/提示词或未知编码的通用DLP承诺。
      const variants = [...new Set([credential, encodeURIComponent(credential), JSON.stringify(credential).slice(1, -1), Buffer.from(credential).toString('base64')])];
      let bytes = result.bytes;
      if (/(?:json|text|xml|event-stream)/i.test(result.contentType)) {
        let text;
        try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw new StorageError('provider_response_invalid', '渠道文字响应编码无效。', 502); }
        for (const value of variants) text = text.split(value).join('[credential-redacted]');
        bytes = Buffer.from(text);
      } else requireValue(!variants.some(value => bytes.includes(Buffer.from(value))), 'provider_response_sensitive', '渠道响应包含认证材料，未交付页面。', 502);
      requireValue(bytes.length <= MAX_RESPONSE_BYTES && !variants.some(value => result.contentType.includes(value)), 'provider_response_invalid', '渠道响应未通过检查。', 502);
      return { status: result.status, contentType: result.contentType, bytes };
    },
  });
}
