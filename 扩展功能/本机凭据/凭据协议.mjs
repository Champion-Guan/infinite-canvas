// 浏览器与本机共同使用的限制，不导入Node或操作系统能力。
export const CREDENTIAL_FORMAT = 'guan-credentials.v1';
export const MAX_CREDENTIAL_BYTES = 2048;
export const validCredentialRef = value => typeof value === 'string' && /^secret:[0-9a-f]{64}$/.test(value);
export const validCredentialValue = value => typeof value === 'string' && value.length > 0 && value.isWellFormed() && new TextEncoder().encode(value).length <= MAX_CREDENTIAL_BYTES;
