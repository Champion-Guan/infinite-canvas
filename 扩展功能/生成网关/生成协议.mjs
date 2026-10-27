import { requireValue, validId, validUUID } from '../本机存储/协议.mjs';

export const GENERATION_PROTOCOL = 'guan-generation.v1';
export const MAX_REQUEST_BYTES = 32 * 1024 * 1024;
export const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;
export const exactKeys = (value, keys) => value && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
export const bindingLike = value => typeof value === 'string' && /^provider:[0-9a-f]{64}$/.test(value);
export const jobLike = validUUID;
// 不用重复捕获组匹配整份base64；V8在大图片上会耗尽正则栈。
// 单字符扫描保持线性，尾部位也必须规范，不解码/分配第二份大正文。
export function canonicalBase64(value, maxBytes) {
  if (typeof value !== 'string' || value.length % 4 !== 0 || value.length > Math.ceil(maxBytes / 3) * 4) return false;
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0, end = value.length - padding;
  if (value.length / 4 * 3 - padding > maxBytes || /[^A-Za-z0-9+/]/.test(value.slice(0, end))) return false;
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  return !padding || (alphabet.indexOf(value[end - 1]) & (padding === 2 ? 15 : 3)) === 0;
}
export function validateSubmission(value) {
  requireValue(exactKeys(value, ['id', 'productId', 'nodeId', 'binding', 'request']) && validUUID(value.id) && validId(value.productId) && validId(value.nodeId) && bindingLike(value.binding), 'invalid_generation', '任务身份、产品、节点或渠道引用无效。');
  const request = value.request;
  requireValue(exactKeys(request, ['method', 'path', 'contentType', 'body']) && ['GET', 'POST'].includes(request.method) && typeof request.path === 'string' && request.path.length <= 8192 &&
    typeof request.contentType === 'string' && /^(?:|application\/json|multipart\/form-data; boundary=[A-Za-z0-9-]{1,100})$/.test(request.contentType) &&
    canonicalBase64(request.body, MAX_REQUEST_BYTES) &&
    (request.method !== 'GET' || !request.body && !request.contentType), 'invalid_generation_request', '生成请求格式或大小不支持。');
  return value;
}

export const TASK_STATES = Object.freeze(['accepted', 'running', 'succeeded', 'failed', 'uncertain', 'cancelled']);
export const terminalState = value => ['succeeded', 'failed', 'uncertain', 'cancelled'].includes(value);
