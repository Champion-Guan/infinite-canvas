// 正文由渠道网关脱敏并持久保存；这里只显示明确错误字段，不把整份响应当作错误文案。
export function upstreamFailureMessage(bytes, status, contentType = '') {
  const fallback = `上游返回 HTTP ${status}，生成失败。`;
  if (!(bytes instanceof Uint8Array) || bytes.length > 64 * 1024 || /html|xml/i.test(contentType)) return fallback;
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trim(); } catch { return fallback; }
  let message;
  try {
    const value = JSON.parse(text);
    message = typeof value === 'string' ? value : value?.error?.message || (typeof value?.error === 'string' ? value.error : '')
      || value?.message || value?.msg || value?.detail?.message || (typeof value?.detail === 'string' ? value.detail : '');
  } catch {
    if (!/^[{[]/.test(text)) message = text;
  }
  if (typeof message !== 'string' || /<(?:!doctype|html|head|body|script)\b/i.test(message)) return fallback;
  message = message.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [已隐藏]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, '[已隐藏]')
    .trim();
  if (!message) return fallback;
  return `上游返回 HTTP ${status}：${message.slice(0, 1000)}${message.length > 1000 ? '…' : ''}`;
}
