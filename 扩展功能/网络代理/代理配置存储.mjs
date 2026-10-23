import { createHash, randomUUID } from 'node:crypto';
import { requireValue } from '../本机存储/协议.mjs';
import { validCredentialRef } from '../本机凭据/凭据协议.mjs';
import { exact, MAX_PROXY_SOURCE } from './配置边界.mjs';

export const PROXY_STATE_ID = 'guan-network-proxy-state-v1';
const format = 'guan-network-proxy-state.v1';
const hash = value => createHash('sha256').update(value).digest('hex');
const empty = () => ({ format, enabled: false, sourceKind: 'text', source: null, config: null, configName: '' });
export function createProxyConfigurationStore({ workspace, vault, runTrustedWrite }) {
  requireValue(workspace?.workspaceId && typeof vault?.store === 'function' && typeof vault.read === 'function' && typeof runTrustedWrite === 'function',
    'proxy_store_invalid', '代理配置需要同一工作区的凭据保管与写入协调。');
  async function seal(text) {
    requireValue(typeof text === 'string' && text.isWellFormed() && text.length && Buffer.byteLength(text) <= MAX_PROXY_SOURCE, 'proxy_source_invalid', '代理配置大小无效。');
    const refs = []; let part = '', size = 0;
    for (const character of text) {
      const bytes = Buffer.byteLength(character);
      if (size + bytes > 1984) { refs.push(await runTrustedWrite(() => vault.store(part))); part = ''; size = 0; }
      part += character; size += bytes;
    }
    if (part) refs.push(await runTrustedWrite(() => vault.store(part)));
    return { refs, hash: hash(text) };
  }
  function validSeal(value) { return exact(value, ['refs', 'hash']) && Array.isArray(value.refs) && value.refs.length > 0 && value.refs.length <= 6000 && value.refs.every(validCredentialRef) && /^[a-f0-9]{64}$/.test(value.hash); }
  function read() {
    const doc = workspace.readDocument('extension', PROXY_STATE_ID);
    if (!doc) return { revision: 0, value: empty() };
    const v = doc.value;
    requireValue(doc.workspaceId === workspace.workspaceId && doc.mediaIds.length === 0 &&
      exact(v, ['format', 'enabled', 'sourceKind', 'source', 'config', 'configName']) && v.format === format &&
      typeof v.enabled === 'boolean' && ['text', 'url'].includes(v.sourceKind) && typeof v.configName === 'string' && v.configName.length <= 200 &&
      validSeal(v.source) && validSeal(v.config), 'proxy_state_corrupt', '代理配置记录损坏，未初始化或覆盖。', 409);
    return { revision: doc.revision, value: structuredClone(v) };
  }
  async function unseal(value) {
    requireValue(validSeal(value), 'proxy_state_corrupt', '代理配置密文索引无效。', 409);
    const chunks = []; let size = 0;
    for (const ref of value.refs) { const part = await vault.read(ref); size += Buffer.byteLength(part); requireValue(size <= MAX_PROXY_SOURCE, 'proxy_state_corrupt', '代理配置超限。', 409); chunks.push(part); }
    const result = chunks.join(''); requireValue(hash(result) === value.hash, 'proxy_state_corrupt', '代理配置密文校验失败。', 409); return result;
  }
  return Object.freeze({ read, unseal,
    async prepare({ sourceKind, source, config, configName }) {
      requireValue(['text', 'url'].includes(sourceKind) && typeof configName === 'string' && configName.length <= 200 && !/[\r\n\0]/.test(configName), 'proxy_source_invalid', '代理配置来源无效。');
      return { format, enabled: true, sourceKind, source: await seal(source), config: await seal(config), configName };
    },
    save(value, expectedRevision) {
      return runTrustedWrite(() => {
        const operationId = randomUUID(), ack = workspace.writeDocument({ collection: 'extension', id: PROXY_STATE_ID, value, expectedRevision, operationId });
        requireValue(ack.persisted === true && ack.operationId === operationId && ack.workspaceId === workspace.workspaceId && ack.collection === 'extension' &&
          ack.id === PROXY_STATE_ID && ack.revision === expectedRevision + 1 && ack.hash === hash(JSON.stringify(value)),
        'proxy_save_unconfirmed', '代理配置保存未确认，未报告保存成功。', 503);
        return { revision: ack.revision, value: structuredClone(value) };
      });
    },
  });
}
