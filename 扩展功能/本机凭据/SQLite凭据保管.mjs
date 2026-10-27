import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { StorageError, requireValue, validUUID } from '../本机存储/协议.mjs';
import { CREDENTIAL_FORMAT, validCredentialRef, validCredentialValue } from './凭据协议.mjs';

const markerId = 'guan-credential-vault';
const hash = value => createHash('sha256').update(value).digest('hex');
const keysMatch = (value, keys) => value && !Array.isArray(value) && typeof value === 'object' && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const same = (a, b) => a.length === b.length && timingSafeEqual(a, b);
const unavailable = () => new StorageError('credential_unavailable', '本机凭据不可用；原配置保留，没有改为空密钥或明文保存。', 503);

// 只在可信本机进程内装配。SQLite保存AES-GCM密文，独立Keychain标识保存主密钥。
// 不增加schema、不自动删除凭据；备份自然包含密文，但没有本机主密钥不能解密。
export async function openSQLiteCredentialVault({ workspace, keyProvider, initialize = false } = {}) {
  requireValue(validUUID(workspace?.workspaceId) && ['readDocument', 'writeDocument', 'listDocuments'].every(name => typeof workspace[name] === 'function') &&
    typeof keyProvider?.read === 'function' && typeof keyProvider?.create === 'function' && typeof initialize === 'boolean', 'invalid_credential_config', '凭据保管必须显式装配工作区和主密钥端口。');
  const workspaceId = workspace.workspaceId, marker = workspace.readDocument('extension', markerId);
  let master, cipherKey, refKey;
  try {
    if (!marker) {
      requireValue(initialize, 'credential_initialization_required', '凭据保管尚未初始化；没有自动创建替代密钥。', 409);
      // 无标记的非空业务库不能被当作新的凭据库接管。超列表上限同样拒绝。
      requireValue(workspace.listDocuments('extension').length === 0 && workspace.listDocuments('canvas').length === 0,
        'credential_initialization_denied', '只能在明确初始化的空工作区建立凭据保管。', 409);
      master = await keyProvider.create(workspaceId);
    } else master = await keyProvider.read(workspaceId);
    requireValue(Buffer.isBuffer(master) && master.length === 32, 'credential_master_invalid', '主密钥端口没有返回有效密钥。', 503);
    cipherKey = Buffer.from(hkdfSync('sha256', master, workspaceId, CREDENTIAL_FORMAT + ':encrypt', 32));
    refKey = Buffer.from(hkdfSync('sha256', master, workspaceId, CREDENTIAL_FORMAT + ':reference', 32));
    const fingerprint = createHmac('sha256', refKey).update(CREDENTIAL_FORMAT + ':' + workspaceId).digest('hex');
    if (marker) requireValue(keysMatch(marker.value, ['format', 'workspaceId', 'fingerprint']) && marker.value.format === CREDENTIAL_FORMAT && marker.value.workspaceId === workspaceId &&
      marker.value.fingerprint === fingerprint && marker.mediaIds.length === 0, 'credential_master_mismatch', '凭据主密钥或工作区标记不匹配；没有重新生成。', 409);
    else {
      const value = { format: CREDENTIAL_FORMAT, workspaceId, fingerprint }, operationId = randomUUID();
      const ack = workspace.writeDocument({ collection: 'extension', id: markerId, value, expectedRevision: 0, operationId });
      requireValue(ack?.persisted === true && ack.workspaceId === workspaceId && ack.id === markerId && ack.collection === 'extension' && ack.operationId === operationId && ack.revision === 1 && ack.hash === hash(JSON.stringify(value)),
        'credential_ack_invalid', '凭据保管初始化没有收到匹配落盘确认。', 503);
    }
  } catch (error) {
    cipherKey?.fill(0); refKey?.fill(0);
    if (error instanceof StorageError) throw error;
    throw unavailable();
  } finally { if (Buffer.isBuffer(master)) master.fill(0); }
  let closed = false, pending = 0, tail = Promise.resolve();
  function run(fn) {
    requireValue(!closed, 'credential_closed', '凭据保管已关闭。', 503);
    pending++;
    const task = tail.then(fn).catch(error => { if (error instanceof StorageError) throw error; throw unavailable(); })
      .finally(() => { pending--; });
    tail = task.then(() => {}, () => {}); return task;
  }
  const aad = ref => Buffer.from(CREDENTIAL_FORMAT + ':' + workspaceId + ':' + ref);
  function decrypt(ref, doc) {
    requireValue(doc?.workspaceId === workspaceId && doc.collection === 'extension' && doc.id === ref && doc.revision === 1 && doc.mediaIds.length === 0 &&
      keysMatch(doc.value, ['format', 'workspaceId', 'iv', 'sealed', 'tag']) && doc.value.format === CREDENTIAL_FORMAT && doc.value.workspaceId === workspaceId &&
      /^[0-9a-f]{24}$/.test(doc.value.iv) && /^[0-9a-f]{32}$/.test(doc.value.tag) && typeof doc.value.sealed === 'string' && /^(?:[0-9a-f]{2}){1,2048}$/.test(doc.value.sealed),
    'credential_corrupt', '凭据密文无效或被修改；没有返回空密钥。', 409);
    let plain;
    try {
      const decipher = createDecipheriv('aes-256-gcm', cipherKey, Buffer.from(doc.value.iv, 'hex'));
      decipher.setAAD(aad(ref)); decipher.setAuthTag(Buffer.from(doc.value.tag, 'hex'));
      plain = Buffer.concat([decipher.update(Buffer.from(doc.value.sealed, 'hex')), decipher.final()]);
      const value = new TextDecoder('utf-8', { fatal: true }).decode(plain);
      requireValue(validCredentialValue(value) && 'secret:' + createHmac('sha256', refKey).update(value).digest('hex') === ref, 'credential_corrupt', '凭据引用与解密内容不匹配。', 409);
      return value;
    } catch { throw new StorageError('credential_corrupt', '凭据解密校验未通过；原记录保留。', 409); }
    finally { plain?.fill(0); }
  }
  return Object.freeze({
    store(value) {
      requireValue(validCredentialValue(value), 'invalid_credential', '凭据必须是1至2048字节的完整文本。');
      return run(() => {
        // 带密钥的引用防止用公开哈希猜测短密码；同一主密钥下重复保存和丢ACK重试复用原条目。
        const ref = 'secret:' + createHmac('sha256', refKey).update(value).digest('hex'), existing = workspace.readDocument('extension', ref);
        if (existing) {
          const saved = Buffer.from(decrypt(ref, existing)), wanted = Buffer.from(value);
          try { requireValue(same(saved, wanted), 'credential_corrupt', '凭据引用发生冲突，拒绝覆盖。', 409); }
          finally { saved.fill(0); wanted.fill(0); }
          return ref;
        }
        const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', cipherKey, iv), plain = Buffer.from(value);
        let sealed;
        try { cipher.setAAD(aad(ref)); sealed = Buffer.concat([cipher.update(plain), cipher.final()]); }
        finally { plain.fill(0); }
        const document = { format: CREDENTIAL_FORMAT, workspaceId, iv: iv.toString('hex'), sealed: sealed.toString('hex'), tag: cipher.getAuthTag().toString('hex') };
        const operationId = randomUUID(), ack = workspace.writeDocument({ collection: 'extension', id: ref, value: document, expectedRevision: 0, operationId });
        requireValue(ack?.persisted === true && ack.workspaceId === workspaceId && ack.collection === 'extension' && ack.id === ref && ack.operationId === operationId && ack.revision === 1 && ack.hash === hash(JSON.stringify(document)),
          'credential_ack_invalid', '凭据没有收到匹配落盘确认。', 503);
        return ref;
      });
    },
    read(ref) {
      requireValue(validCredentialRef(ref), 'invalid_secret_ref', '凭据引用无效。');
      return run(() => {
        const doc = workspace.readDocument('extension', ref);
        requireValue(doc, 'secret_not_found', '本机凭据缺失；没有替换为新密钥。', 404);
        return decrypt(ref, doc);
      });
    },
    inspect(ref) {
      requireValue(validCredentialRef(ref), 'invalid_secret_ref', '凭据引用无效。');
      return run(() => {
        const doc = workspace.readDocument('extension', ref);
        requireValue(doc, 'secret_not_found', '本机凭据缺失；没有替换为新密钥。', 404);
        decrypt(ref, doc);
        return 'guan-vault:' + ref;
      });
    },
    getStatus: () => ({ closed, pending }),
    close() {
      requireValue(pending === 0, 'credential_busy', '凭据操作尚未结束，不能关闭。', 409);
      closed = true; cipherKey.fill(0); refKey.fill(0);
    },
  });
}
