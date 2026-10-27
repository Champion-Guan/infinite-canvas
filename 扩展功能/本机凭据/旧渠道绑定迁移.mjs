import { createHash, randomUUID } from 'node:crypto';
import { APP_NAMESPACES, requireValue } from '../本机存储/协议.mjs';
import { readFragmentGraph } from '../本机存储/分片值编码.mjs';
import { validCredentialRef } from './凭据协议.mjs';

const markerId = 'guan-credential-binding-migration-v1', format = 'guan-credential-binding-migration.v1';
const digest = value => createHash('sha256').update(value).digest('hex');
// 首次升级在页面开放前核验原加密配置；只建立固定绑定，不改画布/素材/配置根。
// 完成标记禁止后续页面伪造legacy secret树，在下次启动时重定向旧密钥。
export async function migrateLegacyChannelBindings({ workspace, gateway, runWrite }) {
  const previous = workspace.readDocument('extension', markerId);
  if (previous) {
    requireValue(previous.revision === 1 && previous.workspaceId === workspace.workspaceId && previous.value?.format === format &&
      previous.value.workspaceId === workspace.workspaceId && previous.value.completed === true && !previous.mediaIds.length,
      'credential_migration_invalid', '渠道迁移记录无效，原配置保留。', 409);
    return;
  }
  const profiles = new Map();
  function scan(tree, depth = 0) {
    requireValue(depth <= 32 && Array.isArray(tree), 'credential_migration_invalid', '原配置结构无效，未覆盖原数据。', 409);
    if (tree[0] === 'array') {
      requireValue(tree.length === 2 && Array.isArray(tree[1]), 'credential_migration_invalid', '原配置数组结构无效。', 409);
      for (const child of tree[1]) scan(child, depth + 1);
    }
    if (tree[0] !== 'object') return;
    requireValue(tree.length === 2 && Array.isArray(tree[1]) && tree[1].every(pair => Array.isArray(pair) && pair.length === 2 && typeof pair[0] === 'string') && new Set(tree[1].map(pair => pair[0])).size === tree[1].length, 'credential_migration_invalid', '原配置结构无效。', 409);
    const fields = new Map(tree[1]), key = fields.get('apiKey'), endpoint = fields.get('baseUrl'), kind = fields.get('apiFormat');
    if (key?.[0] === 'secret' && validCredentialRef(key[1]) && endpoint?.[0] === 'string' && kind?.[0] === 'string' && ['openai', 'gemini'].includes(kind[1])) {
      const profile = { kind: kind[1], endpoint: endpoint[1], credentialRef: key[1] }; profiles.set(JSON.stringify(profile), profile);
      requireValue(profiles.size <= 2048, 'credential_migration_invalid', '原渠道数量超过迁移范围，未覆盖原数据。', 409);
    }
    for (const [, child] of tree[1]) scan(child, depth + 1);
  }
  for (const namespace of APP_NAMESPACES) {
    const id = 'app-' + digest(namespace), root = workspace.readDocument('extension', id);
    if (!root) continue;
    requireValue(root.collection === 'extension' && root.id === id && root.workspaceId === workspace.workspaceId && root.value.namespace === namespace, 'credential_migration_invalid', '原配置命名空间不符。', 409);
    const entries = root.value.format === 'guan-app-storage.v1' ? root.value.entries : root.value.format === 'guan-app-storage.v2'
      ? await readFragmentGraph({ head: root.value.head, readDocument: async (...args) => workspace.readDocument(...args) }) : null;
    requireValue(Array.isArray(entries) && (root.value.format !== 'guan-app-storage.v2' || entries.length === root.value.entryCount), 'credential_migration_invalid', '原配置分片不完整。', 409);
    const keys = new Set();
    for (const entry of entries) {
      requireValue(Array.isArray(entry) && entry.length === 2 && typeof entry[0] === 'string' && !keys.has(entry[0]) && Array.isArray(entry[1]?.mediaIds), 'credential_migration_invalid', '原配置记录目录无效。', 409);
      keys.add(entry[0]); scan(entry[1]?.tree);
    }
    const after = workspace.readDocument('extension', id);
    requireValue(after?.hash === root.hash && after.revision === root.revision, 'credential_migration_changed', '原配置迁移期间发生变化，请重新打开。', 409);
  }
  for (const profile of profiles.values()) {
    try { await gateway.bindExistingProfile(profile); }
    catch (error) {
      // 旧版受保护本机地址、空地址等保留为不可读引用，在设置中重新配置；不阻断全部画布恢复。
      if (error?.code !== 'invalid_provider_endpoint') throw error;
    }
  }
  await runWrite(() => {
    const value = { format, workspaceId: workspace.workspaceId, completed: true }, operationId = randomUUID();
    try {
      const ack = workspace.writeDocument({ collection: 'extension', id: markerId, value, expectedRevision: 0, operationId });
      requireValue(ack.persisted && ack.workspaceId === workspace.workspaceId && ack.id === markerId && ack.operationId === operationId && ack.revision === 1 && ack.hash === digest(JSON.stringify(value)),
        'credential_migration_unconfirmed', '渠道绑定迁移尚未确认，原配置保留。', 503);
    } catch (error) {
      const saved = workspace.readDocument('extension', markerId);
      if (saved?.revision !== 1 || saved.hash !== digest(JSON.stringify(value))) throw error;
    }
  });
}
