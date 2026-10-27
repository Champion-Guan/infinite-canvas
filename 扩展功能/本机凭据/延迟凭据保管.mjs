import { openSQLiteCredentialVault } from './SQLite凭据保管.mjs';
import { CREDENTIAL_FORMAT, validCredentialRef } from './凭据协议.mjs';
import { StorageError, requireValue } from '../本机存储/协议.mjs';

// 画布、保存和更新不依赖钥匙串解锁。真实凭据读写仍经过原加密保管器；
// 这里只核实已有密文引用，不把凭据不可用转换成空字符串或重新生成主密钥。
export async function createDeferredCredentialVault(options, { openVault = openSQLiteCredentialVault, now = Date.now } = {}) {
  let vault, flight, closed = false, lastError = null, retryAfter = 0;
  const ensure = async () => {
    requireValue(!closed, 'credential_closed', '凭据保管已关闭。', 503);
    if (vault) return vault;
    if (flight) return flight;
    if (lastError && now() < retryAfter) throw lastError;
    flight = openVault(options).then(value => {
      if (closed) { value.close(); throw new StorageError('credential_closed', '凭据保管已关闭。', 503); }
      vault = value; lastError = null; return value;
    }, error => { lastError = error; retryAfter = now() + 5000; throw error; }).finally(() => { flight = null; });
    return flight;
  };
  const port = Object.freeze({
    store: async value => (await ensure()).store(value),
    read: async ref => (await ensure()).read(ref),
    async inspect(ref) {
      requireValue(!closed && validCredentialRef(ref), 'invalid_secret_ref', '凭据引用无效。');
      if (vault) return vault.inspect(ref);
      const doc = options.workspace.readDocument('extension', ref);
      requireValue(doc?.workspaceId === options.workspace.workspaceId && doc.collection === 'extension' && doc.id === ref && doc.revision === 1 && doc.mediaIds?.length === 0 &&
        Object.keys(doc.value || {}).sort().join(',') === 'format,iv,sealed,tag,workspaceId' && doc.value.format === CREDENTIAL_FORMAT && doc.value.workspaceId === options.workspace.workspaceId &&
        /^[a-f0-9]{24}$/.test(doc.value.iv) && /^[a-f0-9]{32}$/.test(doc.value.tag) && /^(?:[a-f0-9]{2}){1,2048}$/.test(doc.value.sealed),
      'credential_corrupt', '凭据密文引用无效；原记录保留。', 409);
      return 'guan-vault:' + ref;
    },
    getStatus: () => ({ closed, pending: flight ? 1 : vault?.getStatus().pending || 0, state: closed ? 'closed' : vault ? 'ready' : lastError ? 'unavailable' : 'locked', error: lastError?.code || null }),
    close() { requireValue(!flight, 'credential_busy', '凭据操作尚未结束。', 409); vault?.close(); closed = true; },
  });
  // 首次创建空工作区仍须先建立唯一主密钥与标记，不能延后到业务写入之后。
  if (options.initialize) await ensure();
  return port;
}
