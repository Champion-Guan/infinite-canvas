import { StorageError, requireValue } from '../本机存储/协议.mjs';
import { CREDENTIAL_FORMAT, validCredentialRef, validCredentialValue } from './凭据协议.mjs';

// command闭包由已授权页面持有；不接收URL、令牌或任意fetch端口，不做浏览器缓存。
// 为兼容上游直连API，read仍交付页内字符串；这是落盘保护，不是浏览器内存隔离。
export function createCredentialClient({ command } = {}) {
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
    async store(value) {
      requireValue(validCredentialValue(value), 'invalid_credential', '凭据必须是1至2048字节的完整文本。');
      const result = await call({ operation: 'store', value });
      requireValue(Object.keys(result).sort().join(',') === 'format,ref' && validCredentialRef(result.ref), 'credential_ack_invalid', '凭据没有返回有效引用。', 503);
      return result.ref;
    },
    async read(ref) {
      requireValue(validCredentialRef(ref), 'invalid_secret_ref', '凭据引用无效。');
      const result = await call({ operation: 'read', ref });
      requireValue(Object.keys(result).sort().join(',') === 'format,ref,value' && result.ref === ref && validCredentialValue(result.value), 'credential_ack_invalid', '凭据读取没有返回匹配内容。', 503);
      return result.value;
    },
  });
}
