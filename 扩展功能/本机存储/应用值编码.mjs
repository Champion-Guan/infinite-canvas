import { MEDIA_TYPES, StorageError, requireValue, validHash } from './协议.mjs';
import { isChannelBinding, sealedCredentialRef } from '../本机凭据/页面凭据引用.mjs';
import { validCredentialRef } from '../本机凭据/凭据协议.mjs';

const CHUNK_BYTES = 16 * 1024 * 1024;
export const MAX_VALUE_MEDIA_BYTES = 512 * 1024 * 1024;
const credentialKey = /^(api[_-]?key|authorization|password|token|access[_-]?token|refresh[_-]?token|private[_-]?key|secret)$/i;

// 值使用带类型的树，保留逻辑storageKey，不把临时网址或Blob对象写进JSON。
// 凭据只能交给显式注入的安全端口；没有端口时拒绝，不删字段、不明文降级。
export function createValueCodec({ client, secretPort, readBlobUrl, createObjectURL = blob => URL.createObjectURL(blob), revokeObjectURL = url => URL.revokeObjectURL(url) }) {
  const urls = new Set(), savedUrls = new Map(), savedBlobs = new WeakMap(), savedMediaKeys = new Map();
  const loadedMedia = new Map(), decodedUrls = new Map(), confirmedMedia = new Map(), mediaWrites = new Map();
  const credentialChecks = new Map();
  function credentialCheck(key, operation) {
    if (!credentialChecks.has(key)) {
      const flight = Promise.resolve().then(operation);
      credentialChecks.set(key, flight);
      if (credentialChecks.size > 256) credentialChecks.delete(credentialChecks.keys().next().value);
      void flight.catch(() => { if (credentialChecks.get(key) === flight) credentialChecks.delete(key); });
    }
    return credentialChecks.get(key);
  }
  async function readMedia(id) {
    if (!loadedMedia.has(id)) {
      // readMedia端口已校验内容哈希；只保留已确认内容的长度，供新临时地址复用。
      const pending = Promise.resolve().then(() => client.readMedia(id)).then(blob => {
        if (blob instanceof Blob) confirmedMedia.set(id, blob.size);
        return blob;
      });
      loadedMedia.set(id, pending);
      pending.catch(() => { if (loadedMedia.get(id) === pending) loadedMedia.delete(id); });
    }
    return loadedMedia.get(id);
  }
  async function persistMedia(chunk, stats) {
    const id = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await chunk.arrayBuffer()))].map(byte => byte.toString(16).padStart(2, '0')).join('');
    if (confirmedMedia.get(id) === chunk.size) { stats.reused++; return id; }
    if (!mediaWrites.has(id)) {
      stats.uploaded++;
      const pending = Promise.resolve().then(() => client.writeMedia(chunk)).then(saved => {
        requireValue(saved?.id === id, 'invalid_ack', '媒体分片落盘确认与内容不符。');
        confirmedMedia.set(id, chunk.size);
        return id;
      });
      mediaWrites.set(id, pending);
      const clear = () => { if (mediaWrites.get(id) === pending) mediaWrites.delete(id); };
      pending.then(clear, clear);
    }
    return mediaWrites.get(id);
  }
  async function encode(value, { credential = false } = {}) {
    const started = performance.now(), stats = { uploaded: 0, reused: 0, blobReads: 0, secrets: 0 };
    const visiting = new Set(), mediaIds = new Set();
    let totalBytes = 0;
    async function visit(item, depth = 0, key = '', parent) {
      requireValue(depth <= 32, 'value_too_deep', '应用数据层级超过当前安全限制。');
      if (credentialKey.test(key) && item !== null && item !== undefined && item !== '') {
        requireValue(typeof item === 'string' && secretPort?.store && secretPort?.inspect, 'secret_port_required', '凭据保管尚未接入；未将密钥明文写入SQLite。');
        const sealed = sealedCredentialRef(item);
        if (sealed) { await credentialCheck(sealed, () => secretPort.inspect(sealed)); return ['secret', sealed]; }
        if (key === 'apiKey' && typeof parent?.baseUrl === 'string' && ['openai', 'gemini'].includes(parent.apiFormat)) {
          requireValue(secretPort.bindChannel, 'secret_port_required', '渠道凭据绑定尚未接入。');
          const binding = isChannelBinding(item)
            ? await credentialCheck(JSON.stringify([item, parent.apiFormat, parent.baseUrl]), () => secretPort.bindChannel(parent))
            : await secretPort.bindChannel(parent);
          return ['provider', binding];
        }
        if (isChannelBinding(item)) {
          requireValue(secretPort.describeChannel, 'secret_port_required', '渠道凭据检查尚未接入。');
          await credentialCheck(item, () => secretPort.describeChannel(item)); return ['provider', item];
        }
        requireValue(!/^(?:provider:|secret:|guan-vault:)/i.test(item), 'invalid_secret_ref', '本机凭据标识无效，未当作新密钥保存。');
        stats.secrets++; const ref = await secretPort.store(item);
        requireValue(typeof ref === 'string' && /^secret:[A-Za-z0-9_-]{1,128}$/.test(ref), 'invalid_secret_ref', '凭据端口未返回有效引用。');
        return ['secret', ref];
      }
      if (item === undefined) return ['undefined'];
      if (item === null) return ['null'];
      if (typeof item === 'boolean') return ['boolean', item];
      if (typeof item === 'number') {
        requireValue(Number.isFinite(item), 'invalid_value', '应用数据包含非有限数值。');
        return ['number', item];
      }
      if (typeof item === 'string') {
        if (!item.startsWith('blob:')) return ['string', item];
        if (savedUrls.has(item)) return ['blob-url', reuse(savedUrls.get(item))];
        requireValue(typeof readBlobUrl === 'function', 'transient_url_unresolved', '临时媒体尚未转为本机文件；未保存失效网址。');
        stats.blobReads++; const blob = await readBlobUrl(item);
        requireValue(blob instanceof Blob, 'transient_url_unresolved', '无法读取临时媒体。');
        const descriptor = await binary(blob);
        savedUrls.set(item, structuredClone(descriptor));
        return ['blob-url', descriptor];
      }
      if (item instanceof Blob) return ['blob', await binary(item)];
      if (item instanceof ArrayBuffer) return ['array-buffer', await binary(new Blob([item]))];
      if (item instanceof Date) {
        requireValue(Number.isFinite(item.getTime()), 'invalid_value', '日期无效。');
        return ['date', item.toISOString()];
      }
      requireValue(typeof item === 'object' && !visiting.has(item) && (Array.isArray(item) || Object.getPrototypeOf(item) === Object.prototype || Object.getPrototypeOf(item) === null), 'invalid_value', '仅支持普通对象、数组、日期、Blob和ArrayBuffer；循环或未知类型没有被丢弃。');
      visiting.add(item);
      let tree;
      if (Array.isArray(item)) {
        tree = ['array', []];
        for (const entry of item) tree[1].push(await visit(entry, depth + 1));
      } else {
        tree = ['object', []];
        const stableKeys = stableMediaKeys(item);
        for (const [name, entry] of Object.entries(item)) {
          const reused = await reuseStableMedia(item, name, entry, stableKeys);
          const encoded = reused || await visit(entry, depth + 1, name, item);
          tree[1].push([name, encoded]);
          const descriptor = mediaDescriptor(encoded);
          if (descriptor) for (const key of mediaKeysForField(item, name, stableKeys)) if (stableMediaMatches(item, key, descriptor)) savedMediaKeys.set(key, structuredClone(descriptor));
        }
      }
      visiting.delete(item);
      return tree;
    }
    function reuse(descriptor) {
      totalBytes += descriptor.size;
      requireValue(totalBytes <= MAX_VALUE_MEDIA_BYTES, 'invalid_media', '单次应用值媒体总量超过512MiB或类型不支持。');
      for (const id of descriptor.parts) mediaIds.add(id);
      return structuredClone(descriptor);
    }
    function stableMediaKeys(item) {
      return Object.entries(item).filter(([name, value]) => /(?:^|)storageKey$/i.test(name) && typeof value === 'string' && value.length > 0)
        .map(([, value]) => value);
    }
    function stableMediaMatches(item, key, descriptor) {
      if (!descriptor) return false;
      const field = Object.entries(item).find(([name, value]) => /storageKey$/i.test(name) && value === key)?.[0] || 'storageKey';
      const prefix = field.replace(/storageKey$/i, '');
      const size = item[prefix ? `${prefix}Bytes` : 'bytes'];
      const mime = item[prefix ? `${prefix}MimeType` : 'mimeType'];
      return (size === undefined || size === null || size === '' || size === descriptor.size) && (mime === undefined || mime === null || mime === '' || mime === descriptor.mime);
    }
    function mediaKeysForField(item, name, stableKeys) {
      if (stableKeys.length === 1) return stableKeys;
      const mediaPrefix = name.replace(/(?:content|dataUrl|url|blob)$/i, '').toLowerCase();
      const matches = Object.entries(item).filter(([field, value]) => /storageKey$/i.test(field) && typeof value === 'string' && stableKeys.includes(value) && (field.replace(/storageKey$/i, '').toLowerCase() === mediaPrefix || (!mediaPrefix && field === 'storageKey'))).map(([, value]) => value);
      return matches.length ? matches : stableKeys.filter(key => Object.entries(item).some(([field, value]) => field === 'storageKey' && value === key));
    }
    async function reuseStableMedia(item, name, entry, stableKeys) {
      if (!stableKeys.length || (!((typeof entry === 'string' && entry.startsWith('blob:')) || entry instanceof Blob || entry instanceof ArrayBuffer))) return null;
      const key = stableKeys.find(candidate => stableMediaMatches(item, candidate, savedMediaKeys.get(candidate)));
      const descriptor = key ? savedMediaKeys.get(key) : undefined;
      if (!descriptor) return null;
      totalBytes += descriptor.size;
      requireValue(totalBytes <= MAX_VALUE_MEDIA_BYTES, 'invalid_media', '单次应用值媒体总量超过512MiB或类型不支持。');
      for (const id of descriptor.parts) mediaIds.add(id);
      stats.reused++;
      return [typeof entry === 'string' ? 'blob-url' : entry instanceof ArrayBuffer ? 'array-buffer' : 'blob', structuredClone(descriptor)];
    }
    function mediaDescriptor(encoded) {
      return Array.isArray(encoded) && (encoded[0] === 'blob' || encoded[0] === 'blob-url' || encoded[0] === 'array-buffer') && encoded[1] && typeof encoded[1] === 'object' ? encoded[1] : null;
    }
    async function binary(blob) {
      if (savedBlobs.has(blob)) return reuse(savedBlobs.get(blob));
      requireValue(!blob.type || MEDIA_TYPES.includes(blob.type), 'invalid_media', '单次应用值媒体总量超过512MiB或类型不支持。');
      requireValue(totalBytes + blob.size <= MAX_VALUE_MEDIA_BYTES, 'invalid_media', '单次应用值媒体总量超过512MiB或类型不支持。');
      const parts = [];
      for (let offset = 0; offset < blob.size; offset += CHUNK_BYTES) {
        // structuredClone、原图/交付图双主键和恢复URL会创建新Blob身份；按已确认内容去重。
        parts.push(await persistMedia(blob.slice(offset, offset + CHUNK_BYTES, 'application/octet-stream'), stats));
      }
      // 只缓存全部媒体分片均已ACK的不可变Blob；失败或可变ArrayBuffer不复用。
      const descriptor = { mime: blob.type, size: blob.size, parts };
      savedBlobs.set(blob, structuredClone(descriptor));
      return reuse(descriptor);
    }
    const tree = await visit(value, 0, credential ? 'token' : '');
    if (performance.now() - started > 500) console.debug('[存储性能] 值编码 ' + JSON.stringify({ elapsedMs: Math.round(performance.now() - started), ...stats }));
    return { tree, mediaIds: [...mediaIds].sort() };
  }
  async function decode(tree) {
    let bytes = 0;
    async function binary(value) {
      requireValue(value && typeof value.mime === 'string' && (!value.mime || MEDIA_TYPES.includes(value.mime)) && Number.isSafeInteger(value.size) && value.size >= 0 && Array.isArray(value.parts) && value.parts.every(validHash) && value.parts.length === Math.ceil(value.size / CHUNK_BYTES), 'invalid_value', '本机媒体描述不完整。');
      bytes += value.size;
      requireValue(bytes <= MAX_VALUE_MEDIA_BYTES, 'invalid_media', '媒体总量超过当前安全限制。');
      const chunks = [];
      for (let index = 0; index < value.parts.length; index++) {
        const chunk = await readMedia(value.parts[index]);
        requireValue(chunk.size === Math.min(CHUNK_BYTES, value.size - index * CHUNK_BYTES), 'media_corrupt', '媒体分片大小不匹配。');
        chunks.push(chunk);
      }
      return new Blob(chunks, { type: value.mime });
    }
    async function visit(node, depth = 0, key = '', parent) {
      requireValue(depth <= 32 && Array.isArray(node), 'invalid_value', '本机应用值格式无效。');
      const [tag, value] = node;
      if (tag === 'null' && node.length === 1) return null;
      if (tag === 'undefined' && node.length === 1) return undefined;
      requireValue(node.length === 2, 'invalid_value', '本机应用值长度不符。');
      if (tag === 'string' && typeof value === 'string' && !value.startsWith('blob:')) return value;
      if (tag === 'boolean' && typeof value === 'boolean') return value;
      if (tag === 'number' && typeof value === 'number' && Number.isFinite(value)) return value;
      if (tag === 'date' && typeof value === 'string' && Number.isFinite(Date.parse(value))) return new Date(value);
      if (tag === 'secret') {
        requireValue(validCredentialRef(value) && secretPort?.inspect, 'secret_port_required', '凭据端口不可用，没有用空密钥替代。');
        const sealed = await credentialCheck(value, () => secretPort.inspect(value));
        requireValue(sealed === 'guan-vault:' + value, 'secret_not_found', '凭据检查无效，没有用空密钥替代。');
        if (key === 'apiKey' && typeof parent?.baseUrl === 'string' && ['openai', 'gemini'].includes(parent.apiFormat) && secretPort.resolveChannel) {
          const profile = { kind: parent.apiFormat, endpoint: parent.baseUrl, credentialRef: value };
          return await credentialCheck(JSON.stringify(profile), () => secretPort.resolveChannel(profile)) || sealed;
        }
        return sealed;
      }
      if (tag === 'provider') {
        requireValue(isChannelBinding(value) && secretPort?.describeChannel, 'secret_port_required', '渠道绑定检查尚未接入。');
        await credentialCheck(value, () => secretPort.describeChannel(value));
        return value;
      }
      if (tag === 'blob' || tag === 'blob-url' || tag === 'array-buffer') {
        const blob = await binary(value);
        savedBlobs.set(blob, structuredClone(value));
        if (tag === 'blob') return blob;
        if (tag === 'array-buffer') return blob.arrayBuffer();
        const identity = JSON.stringify(value);
        if (decodedUrls.has(identity)) return decodedUrls.get(identity);
        const url = createObjectURL(blob); urls.add(url); savedUrls.set(url, structuredClone(value)); decodedUrls.set(identity, url); return url;
      }
      if (tag === 'array' && Array.isArray(value)) {
        const result = [];
        for (const entry of value) result.push(await visit(entry, depth + 1));
        return result;
      }
      if (tag === 'object' && Array.isArray(value)) {
        const result = {}, keys = new Set();
        const context = {};
        for (const pair of value) {
          requireValue(Array.isArray(pair) && pair.length === 2 && typeof pair[0] === 'string' && !keys.has(pair[0]), 'invalid_value', '本机对象键重复或无效。');
          keys.add(pair[0]);
          if (['baseUrl', 'apiFormat'].includes(pair[0]) && pair[1]?.[0] === 'string' && typeof pair[1][1] === 'string') Object.defineProperty(context, pair[0], { value: pair[1][1], enumerable: true });
        }
        for (const pair of value) {
          Object.defineProperty(result, pair[0], { value: await visit(pair[1], depth + 1, pair[0], context), enumerable: true, writable: true, configurable: true });
        }
        registerStableMediaRefs(result);
        return result;
      }
      throw new StorageError('invalid_value', '无法识别本机应用值，不作空值处理。');
    }
    return visit(tree);
  }
  function registerStableMediaRefs(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    const keys = stableMediaKeysOutsideCodec(value);
    for (const [, entry] of Object.entries(value)) {
      const descriptor = entry instanceof Blob ? savedBlobs.get(entry) : typeof entry === 'string' && entry.startsWith('blob:') ? savedUrls.get(entry) : null;
      if (!descriptor) continue;
      for (const key of keys) savedMediaKeys.set(key, structuredClone(descriptor));
    }
  }
  function stableMediaKeysOutsideCodec(value) {
    return Object.entries(value).filter(([name, entry]) => /(?:^|)storageKey$/i.test(name) && typeof entry === 'string' && entry.length > 0).map(([, entry]) => entry);
  }
  return { encode, decode, close() { for (const url of urls) revokeObjectURL(url); urls.clear(); savedUrls.clear(); savedBlobs.clear?.(); savedMediaKeys.clear(); loadedMedia.clear(); decodedUrls.clear(); confirmedMedia.clear(); mediaWrites.clear(); credentialChecks.clear(); } };
}
