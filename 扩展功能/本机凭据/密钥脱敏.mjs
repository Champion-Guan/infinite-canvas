// 固定三个星号，不泄露原密钥长度；短密钥减少首尾展示，至少隐藏四个原字符。
export function maskCredential(value) {
  const chars = Array.from(value);
  if (chars.length <= 4) return '***';
  const prefix = chars.length >= 14 ? 6 : chars.length >= 8 ? 2 : 1;
  const suffix = chars.length >= 14 ? 4 : chars.length >= 8 ? 2 : chars.length - prefix - 4;
  return chars.slice(0, prefix).join('') + '***' + (suffix > 0 ? chars.slice(-suffix).join('') : '');
}

// 脱敏展示值不能作为新密钥重新保存，包括从编辑框复制后粘贴回来的值。
export const isMaskedCredential = value => typeof value === 'string' && value.includes('***');

export async function readCredentialPreview(host, binding) {
  if (typeof host?.previewCredential !== 'function') throw new Error('密钥核对暂不可用');
  const result = await host.previewCredential(binding);
  if (result?.binding !== binding || typeof result.maskedKey !== 'string' || result.maskedKey.length > 32 ||
      !/^[^\r\n]{0,6}\*{3}[^\r\n]{0,4}$/u.test(result.maskedKey)) throw new Error('密钥核对响应无效');
  return result.maskedKey;
}
