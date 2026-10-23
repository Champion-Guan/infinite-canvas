import { createHash, randomUUID } from 'node:crypto';
import { requireValue } from '../本机存储/协议.mjs';
import { exactKeys } from '../生成网关/生成协议.mjs';
import { capabilities, emptyFallback } from './原版策略.mjs';
import { validModelOrder } from './模型默认排序.mjs';

export const FALLBACK_STATE_ID = 'guan-fallback-state-v1';
export const hashJSON = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function validateFallback(value) {
  requireValue(exactKeys(value, ['enabled', 'capabilities']) && typeof value.enabled === 'boolean' && exactKeys(value.capabilities, capabilities.map(item => item.key)), 'fallback_config_invalid', 'Fallback配置格式无效。');
  let total = 0;
  for (const { key } of capabilities) {
    const group = value.capabilities[key], seen = new Set();
    requireValue(exactKeys(group, ['enabled', 'entries', ...(Object.hasOwn(group ?? {}, 'modelOrder') ? ['modelOrder'] : [])]) &&
      typeof group.enabled === 'boolean' && Array.isArray(group.entries) &&
      (!Object.hasOwn(group, 'modelOrder') || validModelOrder(group.modelOrder)), 'fallback_config_invalid', 'Fallback分组无效。');
    for (const entry of group.entries) {
      const id = JSON.stringify([entry?.profileId, entry?.modelName]);
      requireValue(exactKeys(entry, ['profileId', 'modelName', 'enabled']) && typeof entry.profileId === 'string' && entry.profileId.length > 0 && entry.profileId.length <= 200 &&
        typeof entry.modelName === 'string' && entry.modelName.length > 0 && entry.modelName.length <= 200 && !/[\r\n\0]/.test(entry.profileId + entry.modelName) &&
        typeof entry.enabled === 'boolean' && !seen.has(id) && ++total <= 512, 'fallback_config_invalid', 'Fallback模型重复或超过限制。');
      seen.add(id);
    }
  }
  requireValue(value.enabled === capabilities.some(({ key }) => value.capabilities[key].enabled && value.capabilities[key].entries.some(entry => entry.enabled)), 'fallback_config_invalid', 'Fallback开关状态冲突。');
  return value;
}
export function createFallbackStore({ workspace, runTrustedWrite }) {
  function read() {
    const doc = workspace.readDocument('extension', FALLBACK_STATE_ID);
    if (!doc) return { revision: 0, value: emptyFallback() };
    requireValue(doc.workspaceId === workspace.workspaceId && !doc.mediaIds.length && exactKeys(doc.value, ['format', 'config']) && doc.value.format === 'guan-fallback-state.v1', 'fallback_config_corrupt', 'Fallback记录损坏，未覆盖为空配置。', 409);
    return { revision: doc.revision, value: structuredClone(validateFallback(doc.value.config)) };
  }
  return Object.freeze({ read, async save(config, expectedRevision) {
    validateFallback(config);
    requireValue(Number.isSafeInteger(expectedRevision) && expectedRevision >= 0, 'fallback_config_invalid', 'Fallback版本无效。');
    const value = { format: 'guan-fallback-state.v1', config: structuredClone(config) };
    return runTrustedWrite(() => {
      const operationId = randomUUID(), expectedHash = hashJSON(value);
      try {
        const ack = workspace.writeDocument({ collection: 'extension', id: FALLBACK_STATE_ID, value, expectedRevision, operationId });
        requireValue(ack.persisted === true && ack.workspaceId === workspace.workspaceId && ack.collection === 'extension' && ack.id === FALLBACK_STATE_ID && ack.operationId === operationId && ack.revision === expectedRevision + 1 && ack.hash === expectedHash, 'fallback_save_unconfirmed', 'Fallback保存未确认。', 503);
      } catch (error) {
        const saved = workspace.readDocument('extension', FALLBACK_STATE_ID);
        if (saved?.revision !== expectedRevision + 1 || saved.hash !== expectedHash) throw error;
      }
      return read();
    });
  } });
}
