import { MAX_APPLICATION_VALUE_DEPTH, MAX_MEDIA_BATCH_BYTES, MAX_MEDIA_BATCH_COUNT, MEDIA_TYPES, StorageError, requireValue, validHash } from './协议.mjs';
import { isChannelBinding, sealedCredentialRef } from '../本机凭据/页面凭据引用.mjs';
import { validCredentialRef } from '../本机凭据/凭据协议.mjs';
import { deferCanvasMediaUrl, releaseDeferredCanvasMedia } from './画布媒体延迟恢复.mjs';

const LEGACY_CHUNK_BYTES = 16 * 1024 * 1024;
const credentialKey = /^(api[_-]?key|authorization|password|token|access[_-]?token|refresh[_-]?token|private[_-]?key|secret)$/i;
const imageDataPrefix = 'data:' + 'image/';
async function inlineImageBlob(value) {
  const match = /^data:(image\/[\w.+-]+);base64,([A-Za-z0-9+/=\r\n]+)$/.exec(value);
  requireValue(match && MEDIA_TYPES.includes(match[1]), 'invalid_media', '内嵌图片编码无效，原图片未修改。');
  return new Blob([Uint8Array.from(atob(match[2]), char => char.charCodeAt(0))], { type: match[1] });
}

// 值使用带类型的树，保留逻辑storageKey，不把临时网址或Blob对象写进JSON。
// 凭据只能交给显式注入的安全端口；没有端口时拒绝，不删字段、不明文降级。
export function createValueCodec({ client, secretPort, readBlobUrl, createObjectURL = blob => URL.createObjectURL(blob), revokeObjectURL = url => URL.revokeObjectURL(url) }) {
  const urls = new Set(), savedUrls = new Map(), savedMediaKeys = new Map(), legacyUrlBlobs = new Map();
  const loadedMedia = new Map(), decodedUrls = new Map(), mediaWrites = new WeakMap();
  let savedBlobs = new WeakMap();
  const credentialChecks = new Map();
  const deferredUrls = new Set();
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
      // 只合并同时发生的读取；不把所有已读媒体永久留在内存中。
      const pending = Promise.resolve().then(() => client.readMedia(id)).then(blob => {
        requireValue(blob instanceof Blob, 'invalid_response', '本机媒体响应不是文件。');
        return blob;
      });
      loadedMedia.set(id, pending);
      void pending.then(
        () => { if (loadedMedia.get(id) === pending) loadedMedia.delete(id); },
        () => { if (loadedMedia.get(id) === pending) loadedMedia.delete(id); },
      );
    }
    return loadedMedia.get(id);
  }
  async function encode(value, { credential = false } = {}) {
    const started = performance.now(), stats = { uploaded: 0, reused: 0, blobReads: 0, secrets: 0 };
    const visiting = new Set(), mediaIds = new Set(), mediaPartSizes = new Map();
    const pendingMedia = [], pendingDescriptors = [], descriptorsByBlob = new Map(), pendingStableMediaKeys = [], pendingBlobUrls = [];
    function queueMedia(blob) {
      if (mediaWrites.has(blob)) { stats.reused++; return mediaWrites.get(blob); }
      stats.uploaded++;
      let resolve, reject;
      const pending = new Promise((yes, no) => { resolve = yes; reject = no; });
      mediaWrites.set(blob, pending);
      void pending.catch(() => { if (mediaWrites.get(blob) === pending) mediaWrites.delete(blob); });
      pendingMedia.push({ blob, pending, resolve, reject });
      return pending;
    }
    function mediaGroups() {
      const groups = [];
      let group = [], bytes = 0;
      for (const entry of pendingMedia) {
        if (group.length && (group.length >= MAX_MEDIA_BATCH_COUNT || bytes + entry.blob.size > MAX_MEDIA_BATCH_BYTES)) {
          groups.push(group); group = []; bytes = 0;
        }
        group.push(entry); bytes += entry.blob.size;
      }
      if (group.length) groups.push(group);
      return groups;
    }
    async function uploadPendingMedia() {
      let offset = 0;
      for (const group of mediaGroups()) {
        try {
          let records;
          if (group.length > 1 && typeof client.writeMediaBatch === 'function') {
            records = await client.writeMediaBatch(group.map(({ blob }) => ({ blob, mime: blob.type || 'application/octet-stream' })));
          } else {
            records = [];
            for (const { blob } of group) records.push(await client.writeMedia(blob.type ? blob : new Blob([blob], { type: 'application/octet-stream' })));
          }
          requireValue(Array.isArray(records) && records.length === group.length, 'invalid_ack', '媒体批次落盘确认不完整。');
          records.forEach((saved, index) => {
            const entry = group[index];
            requireValue(validHash(saved?.id) && saved.size === entry.blob.size, 'invalid_ack', '媒体落盘确认与内容不符。');
            entry.resolve({ id: saved.id, size: saved.size });
          });
          offset += group.length;
        } catch (error) {
          for (const entry of pendingMedia.slice(offset)) entry.reject(error);
          throw error;
        }
      }
    }
    async function visit(item, depth = 0, key = '', parent) {
      requireValue(depth <= MAX_APPLICATION_VALUE_DEPTH, 'value_too_deep', '应用数据层级超过当前安全限制。');
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
        const inlineImage = key === 'url' && typeof parent?.storageKey === 'string' && item.startsWith(imageDataPrefix);
        if (!item.startsWith('blob:') && !inlineImage) return ['string', item];
        if (savedUrls.has(item)) return ['blob-url', reuse(savedUrls.get(item))];
        requireValue(inlineImage || legacyUrlBlobs.has(item) || typeof readBlobUrl === 'function', 'transient_url_unresolved', '临时媒体尚未转为本机文件；未保存失效网址。');
        const existing = legacyUrlBlobs.get(item);
        if (!existing) stats.blobReads++;
        const blob = existing || (inlineImage ? await inlineImageBlob(item) : await readBlobUrl(item));
        requireValue(blob instanceof Blob, 'transient_url_unresolved', '无法读取临时媒体。');
        const descriptor = await binary(blob);
        if (descriptor.size > 0 && descriptor.id === null) pendingBlobUrls.push({ url: item, descriptor });
        else savedUrls.set(item, structuredClone(descriptor));
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
          if (descriptor) for (const key of mediaKeysForField(item, name, stableKeys)) if (stableMediaMatches(item, key, descriptor)) {
            if (descriptor.size > 0 && descriptor.id === null) pendingStableMediaKeys.push({ item, key, descriptor });
            else savedMediaKeys.set(key, structuredClone(descriptor));
          }
        }
      }
      visiting.delete(item);
      return tree;
    }
    function reuse(descriptor) {
      includeMedia(descriptor);
      return structuredClone(descriptor);
    }
    function includeMedia(descriptor) {
      if (Object.hasOwn(descriptor, 'id')) {
        requireValue(Object.keys(descriptor).length === 3 && Number.isSafeInteger(descriptor.size) && descriptor.size >= 0 &&
          (descriptor.size === 0 ? descriptor.id === null : validHash(descriptor.id)),
        'invalid_media', '本机单体媒体描述无效。');
        if (descriptor.size > 0) {
          const known = mediaPartSizes.get(descriptor.id);
          requireValue(known === undefined || known === descriptor.size, 'invalid_media', '同一媒体标识的大小不一致。');
          if (known === undefined) mediaPartSizes.set(descriptor.id, descriptor.size);
          mediaIds.add(descriptor.id);
        }
        return;
      }
      for (let index = 0; index < descriptor.parts.length; index++) {
        const id = descriptor.parts[index], size = Math.min(LEGACY_CHUNK_BYTES, descriptor.size - index * LEGACY_CHUNK_BYTES);
        const known = mediaPartSizes.get(id);
        requireValue(size > 0 && (known === undefined || known === size), 'invalid_media', '同一媒体分片的大小不一致。');
        if (known === undefined) mediaPartSizes.set(id, size);
        mediaIds.add(id);
      }
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
      if (!stableKeys.length || (!((typeof entry === 'string' && (entry.startsWith('blob:') || name === 'url' && entry.startsWith(imageDataPrefix))) || entry instanceof Blob || entry instanceof ArrayBuffer))) return null;
      const key = stableKeys.find(candidate => stableMediaMatches(item, candidate, savedMediaKeys.get(candidate)));
      const descriptor = key ? savedMediaKeys.get(key) : undefined;
      if (!descriptor || !Object.hasOwn(descriptor, 'id')) return null;
      includeMedia(descriptor);
      stats.reused++;
      return [typeof entry === 'string' ? 'blob-url' : entry instanceof ArrayBuffer ? 'array-buffer' : 'blob', structuredClone(descriptor)];
    }
    function mediaDescriptor(encoded) {
      return Array.isArray(encoded) && (encoded[0] === 'blob' || encoded[0] === 'blob-url' || encoded[0] === 'array-buffer') && encoded[1] && typeof encoded[1] === 'object' ? encoded[1] : null;
    }
    async function binary(blob) {
      if (savedBlobs.has(blob)) return reuse(savedBlobs.get(blob));
      requireValue(!blob.type || MEDIA_TYPES.includes(blob.type), 'invalid_media', '媒体类型不受支持。');
      if (descriptorsByBlob.has(blob)) { stats.reused++; return descriptorsByBlob.get(blob); }
      const descriptor = { mime: blob.type, size: blob.size, id: null };
      descriptorsByBlob.set(blob, descriptor);
      if (blob.size) {
        pendingDescriptors.push({ blob, descriptor, pending: queueMedia(blob) });
        return descriptor;
      }
      savedBlobs.set(blob, structuredClone(descriptor));
      return reuse(descriptor);
    }
    let tree;
    try { tree = await visit(value, 0, credential ? 'token' : ''); }
    catch (error) {
      for (const item of pendingMedia) item.reject(error);
      throw error;
    }
    await uploadPendingMedia();
    for (const item of pendingDescriptors) {
      const saved = await item.pending;
      item.descriptor.id = saved.id;
      item.descriptor.size = saved.size;
      savedBlobs.set(item.blob, structuredClone(item.descriptor));
      includeMedia(item.descriptor);
    }
    for (const { url, descriptor } of pendingBlobUrls) { savedUrls.set(url, structuredClone(descriptor)); legacyUrlBlobs.delete(url); }
    for (const { item, key, descriptor } of pendingStableMediaKeys) {
      if (stableMediaMatches(item, key, descriptor)) savedMediaKeys.set(key, structuredClone(descriptor));
    }
    if (performance.now() - started > 500) console.debug('[存储性能] 值编码 ' + JSON.stringify({ elapsedMs: Math.round(performance.now() - started), ...stats }));
    return { tree, mediaIds: [...mediaIds].sort() };
  }
  async function decode(tree, { deferMediaUrls = false, yieldToMain = () => globalThis.scheduler?.yield
    ? globalThis.scheduler.yield() : new Promise(resolve => setTimeout(resolve, 0)) } = {}) {
    const decodedMedia = new Map(), mediaPartSizes = new Map();
    let visited = 0, sliceStarted = performance.now();
    function validateBinary(value) {
      requireValue(value && typeof value.mime === 'string' && (!value.mime || MEDIA_TYPES.includes(value.mime)) && Number.isSafeInteger(value.size) && value.size >= 0, 'invalid_value', '本机媒体描述不完整。');
      const direct = Object.hasOwn(value, 'id');
      if (direct) requireValue(Object.keys(value).length === 3 && (value.size === 0 ? value.id === null : validHash(value.id)), 'invalid_value', '本机单体媒体描述无效。');
      else requireValue(Array.isArray(value.parts) && value.parts.every(validHash) && value.parts.length === Math.ceil(value.size / LEGACY_CHUNK_BYTES), 'invalid_value', '本机旧分片媒体描述不完整。');
      return direct;
    }
    async function binary(value) {
      const direct = validateBinary(value);
      const identity = direct ? JSON.stringify([value.mime, value.size, value.id]) : JSON.stringify([value.mime, value.size, value.parts]);
      if (decodedMedia.has(identity)) return decodedMedia.get(identity);
      const pending = (async () => {
        if (direct) {
          const saved = value.size ? await readMedia(value.id) : new Blob([]);
          requireValue(saved.size === value.size, 'media_corrupt', '媒体大小不匹配。');
          const blob = saved.type === value.mime ? saved : new Blob([saved], { type: value.mime });
          decodedMedia.set(identity, blob);
          if (direct) savedBlobs.set(blob, structuredClone(value));
          return blob;
        }
        for (let index = 0; index < value.parts.length; index++) {
          const id = value.parts[index], size = Math.min(LEGACY_CHUNK_BYTES, value.size - index * LEGACY_CHUNK_BYTES), known = mediaPartSizes.get(id);
          requireValue(size > 0 && (known === undefined || known === size), 'invalid_value', '同一媒体分片的大小不一致。');
          if (known === undefined) mediaPartSizes.set(id, size);
        }
        const chunks = [];
        for (let index = 0; index < value.parts.length; index++) {
          const chunk = await readMedia(value.parts[index]);
          requireValue(chunk.size === Math.min(LEGACY_CHUNK_BYTES, value.size - index * LEGACY_CHUNK_BYTES), 'media_corrupt', '媒体分片大小不匹配。');
          chunks.push(chunk);
        }
        const blob = new Blob(chunks, { type: value.mime });
        decodedMedia.set(identity, blob);
        return blob;
      })();
      decodedMedia.set(identity, pending);
      try { return await pending; }
      catch (error) { if (decodedMedia.get(identity) === pending) decodedMedia.delete(identity); throw error; }
    }
    // 普通JSON节点同步恢复；仅遇到媒体或凭据I/O时挂起，避免每个字段创建微任务。
    function visit(node, depth = 0, key = '', parent) {
      // 大画布按时间片解码，让加载反馈和用户输入持续绘制；小快照不增加等待。
      if (++visited % 256 === 0 && performance.now() - sliceStarted >= 8) {
        return Promise.resolve().then(yieldToMain).then(() => {
          sliceStarted = performance.now();
          return visit(node, depth, key, parent);
        });
      }
      requireValue(depth <= MAX_APPLICATION_VALUE_DEPTH && Array.isArray(node), 'invalid_value', '本机应用值格式无效。');
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
        return (async () => {
          const sealed = await credentialCheck(value, () => secretPort.inspect(value));
          requireValue(sealed === 'guan-vault:' + value, 'secret_not_found', '凭据检查无效，没有用空密钥替代。');
          if (key === 'apiKey' && typeof parent?.baseUrl === 'string' && ['openai', 'gemini'].includes(parent.apiFormat) && secretPort.resolveChannel) {
            const profile = { kind: parent.apiFormat, endpoint: parent.baseUrl, credentialRef: value };
            return await credentialCheck(JSON.stringify(profile), () => secretPort.resolveChannel(profile)) || sealed;
          }
          return sealed;
        })();
      }
      if (tag === 'provider') {
        requireValue(isChannelBinding(value) && secretPort?.describeChannel, 'secret_port_required', '渠道绑定检查尚未接入。');
        return credentialCheck(value, () => secretPort.describeChannel(value)).then(() => value);
      }
      if (tag === 'blob' || tag === 'blob-url' || tag === 'array-buffer') {
        const identity = tag === 'blob-url' ? JSON.stringify(value) : null;
        if (identity && decodedUrls.has(identity)) return decodedUrls.get(identity);
        if (tag === 'blob-url' && deferMediaUrls) {
          validateBinary(value);
          const descriptor = structuredClone(value);
          const url = deferCanvasMediaUrl(async () => {
            const blob = await binary(descriptor);
            const source = createObjectURL(blob); urls.add(source);
            savedUrls.set(source, descriptor);
            return source;
          }, source => {
            revokeObjectURL(source); urls.delete(source);
            const direct = Object.hasOwn(descriptor, 'id');
            const identity = direct ? JSON.stringify([descriptor.mime, descriptor.size, descriptor.id])
              : JSON.stringify([descriptor.mime, descriptor.size, descriptor.parts]);
            decodedMedia.delete(identity);
          });
          deferredUrls.add(url);
          savedUrls.set(url, descriptor);
          decodedUrls.set(identity, url);
          return url;
        }
        return binary(value).then(blob => {
          if (Object.hasOwn(value, 'id')) savedBlobs.set(blob, structuredClone(value));
          if (tag === 'blob') return blob;
          if (tag === 'array-buffer') return blob.arrayBuffer();
          const url = createObjectURL(blob); urls.add(url);
          if (Object.hasOwn(value, 'id')) savedUrls.set(url, structuredClone(value));
          else legacyUrlBlobs.set(url, blob);
          decodedUrls.set(identity, url); return url;
        });
      }
      if (tag === 'array' && Array.isArray(value)) {
        const result = [];
        const fill = (start = 0) => {
          for (let index = start; index < value.length; index++) {
            const child = visit(value[index], depth + 1);
            if (child instanceof Promise) return child.then(entry => { result.push(entry); return fill(index + 1); });
            result.push(child);
          }
          return result;
        };
        return fill();
      }
      if (tag === 'object' && Array.isArray(value)) {
        const result = {}, keys = new Set();
        const context = {};
        for (const pair of value) {
          requireValue(Array.isArray(pair) && pair.length === 2 && typeof pair[0] === 'string' && !keys.has(pair[0]), 'invalid_value', '本机对象键重复或无效。');
          keys.add(pair[0]);
          if (['baseUrl', 'apiFormat'].includes(pair[0]) && pair[1]?.[0] === 'string' && typeof pair[1][1] === 'string') Object.defineProperty(context, pair[0], { value: pair[1][1], enumerable: true });
        }
        const assign = (key, value) => Object.defineProperty(result, key, { value, enumerable: true, writable: true, configurable: true });
        const fill = (start = 0) => {
          for (let index = start; index < value.length; index++) {
            const pair = value[index], child = visit(pair[1], depth + 1, pair[0], context);
            if (child instanceof Promise) return child.then(entry => { assign(pair[0], entry); return fill(index + 1); });
            assign(pair[0], child);
          }
          registerStableMediaRefs(result);
          return result;
        };
        return fill();
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
  function invalidateMedia() {
    // 保留正在显示的对象URL；只撤销已落盘缓存，重新导入相同字节必须重新确认上传。
    const deferred = [...deferredUrls].map(url => [url, savedUrls.get(url)]).filter(([, descriptor]) => descriptor);
    savedBlobs = new WeakMap(); savedUrls.clear(); savedMediaKeys.clear(); loadedMedia.clear(); decodedUrls.clear();
    for (const [url, descriptor] of deferred) savedUrls.set(url, descriptor);
  }
  return { encode, decode, invalidateMedia, close() { for (const url of urls) revokeObjectURL(url); for (const url of deferredUrls) releaseDeferredCanvasMedia(url); deferredUrls.clear(); urls.clear(); savedUrls.clear(); legacyUrlBlobs.clear(); savedBlobs = new WeakMap(); savedMediaKeys.clear(); loadedMedia.clear(); decodedUrls.clear(); credentialChecks.clear(); } };
}
