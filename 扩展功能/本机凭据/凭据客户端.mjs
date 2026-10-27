import { StorageError, requireValue } from '../本机存储/协议.mjs';
import { CREDENTIAL_FORMAT, validCredentialRef, validCredentialValue } from './凭据协议.mjs';
import { bindChannelConfiguration, isChannelBinding, comparableEndpoint } from './页面凭据引用.mjs';

// command闭包由已授权页面持有；不接收URL、令牌或任意fetch端口，不做浏览器缓存。
// 页面只持有不可逆的已封存标记；明文读取留在可信后端渠道端口，不能经授权HTTP返回。
export function createCredentialClient({ command, generationPort } = {}) {
  requireValue(typeof command === 'function', 'invalid_credential_client', '凭据端口必须来自已授权工作台。');
  async function call(value) {
    let result;
    try { result = await command(value); }
    catch (error) {
      if (error instanceof StorageError) throw error;
      throw new StorageError('credential_connection_failed', '本机凭据响应未确认；请重试保存，未回退明文。', 503);
    }
    requireValue(result?.format === CREDENTIAL_FORMAT, 'credential_ack_invalid', '本机凭据响应协议不符。', 503);
    return result;
  }
  return Object.freeze({
    ...(generationPort ? {
      bindChannel: channel => bindChannelConfiguration(generationPort, channel),
      async resolveChannel(profile) {
        const saved = await generationPort.resolveSaved(profile);
        if (saved === null) return null;
        requireValue(isChannelBinding(saved?.binding) && Object.keys(saved).sort().join(',') === 'binding,endpoint,kind' && saved.kind === profile.kind && comparableEndpoint(saved.endpoint) === comparableEndpoint(profile.endpoint), 'credential_ack_invalid', '旧渠道绑定与原配置不匹配。', 503);
        return saved.binding;
      },
      async describeChannel(binding) {
        const saved = await generationPort.describe(binding);
        requireValue(isChannelBinding(binding) && saved?.binding === binding && ['openai', 'gemini'].includes(saved.kind) && typeof saved.endpoint === 'string', 'credential_ack_invalid', '渠道绑定检查未通过。', 503);
        return binding;
      },
    } : {}),
    async store(value) {
      requireValue(validCredentialValue(value), 'invalid_credential', '凭据必须是1至2048字节的完整文本。');
      const result = await call({ operation: 'store', value });
      requireValue(Object.keys(result).sort().join(',') === 'format,ref' && validCredentialRef(result.ref), 'credential_ack_invalid', '凭据没有返回有效引用。', 503);
      return result.ref;
    },
    async inspect(ref) {
      requireValue(validCredentialRef(ref), 'invalid_secret_ref', '凭据引用无效。');
      const result = await call({ operation: 'inspect', ref });
      requireValue(Object.keys(result).sort().join(',') === 'format,ref' && result.ref === ref, 'credential_ack_invalid', '凭据检查没有返回匹配引用。', 503);
      return 'guan-vault:' + result.ref;
    },
  });
}
