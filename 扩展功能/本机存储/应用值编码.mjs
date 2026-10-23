import { MEDIA_TYPES, StorageError, requireValue, validHash } from './协议.mjs';

const CHUNK_BYTES = 16 * 1024 * 1024;
export const MAX_VALUE_MEDIA_BYTES = 512 * 1024 * 1024;
const credentialKey = /^(api[_-]?key|authorization|password|token|access[_-]?token|refresh[_-]?token|private[_-]?key|secret)$/i;

// 值使用带类型的树，保留逻辑storageKey，不把临时网址或Blob对象写进JSON。
// 凭据只能交给显式注入的安全端口；没有端口时拒绝，不删字段、不明文降级。
export function createValueCodec({ client, secretPort, readBlobUrl, createObjectURL = blob => URL.createObjectURL(blob), revokeObjectURL = url => URL.revokeObjectURL(url) }) {
  const urls = new Set();
  async function encode(value, { credential = false } = {}) {
    const visiting = new Set(), mediaIds = new Set();
    let totalBytes = 0;
    async function visit(item, depth = 0, key = '') {
      requireValue(depth <= 32, 'value_too_deep', '应用数据层级超过当前安全限制。');
      if (credentialKey.test(key) && item !== null && item !== undefined && item !== '') {
        requireValue(typeof item === 'string' && secretPort?.store && secretPort?.read, 'secret_port_required', '凭据保管尚未接入；未将密钥明文写入SQLite。');
        const ref = await secretPort.store(item);
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
        requireValue(typeof readBlobUrl === 'function', 'transient_url_unresolved', '临时媒体尚未转为本机文件；未保存失效网址。');
        const blob = await readBlobUrl(item);
        requireValue(blob instanceof Blob, 'transient_url_unresolved', '无法读取临时媒体。');
        return ['blob-url', await binary(blob)];
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
        for (const [name, entry] of Object.entries(item)) tree[1].push([name, await visit(entry, depth + 1, name)]);
      }
      visiting.delete(item);
      return tree;
    }
    async function binary(blob) {
      totalBytes += blob.size;
      requireValue(totalBytes <= MAX_VALUE_MEDIA_BYTES && (!blob.type || MEDIA_TYPES.includes(blob.type)), 'invalid_media', '单次应用值媒体总量超过512MiB或类型不支持。');
      const parts = [];
      for (let offset = 0; offset < blob.size; offset += CHUNK_BYTES) {
        const saved = await client.writeMedia(blob.slice(offset, offset + CHUNK_BYTES, 'application/octet-stream'));
        requireValue(validHash(saved.id), 'invalid_ack', '媒体分片没有有效落盘确认。');
        parts.push(saved.id); mediaIds.add(saved.id);
      }
      return { mime: blob.type, size: blob.size, parts };
    }
    const tree = await visit(value, 0, credential ? 'token' : '');
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
        const chunk = await client.readMedia(value.parts[index]);
        requireValue(chunk.size === Math.min(CHUNK_BYTES, value.size - index * CHUNK_BYTES), 'media_corrupt', '媒体分片大小不匹配。');
        chunks.push(chunk);
      }
      return new Blob(chunks, { type: value.mime });
    }
    async function visit(node, depth = 0) {
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
        requireValue(typeof value === 'string' && /^secret:[A-Za-z0-9_-]{1,128}$/.test(value) && secretPort?.read, 'secret_port_required', '凭据端口不可用，没有用空密钥替代。');
        const secret = await secretPort.read(value);
        requireValue(typeof secret === 'string', 'secret_not_found', '凭据引用失效，没有用空密钥替代。');
        return secret;
      }
      if (tag === 'blob' || tag === 'blob-url' || tag === 'array-buffer') {
        const blob = await binary(value);
        if (tag === 'blob') return blob;
        if (tag === 'array-buffer') return blob.arrayBuffer();
        const url = createObjectURL(blob); urls.add(url); return url;
      }
      if (tag === 'array' && Array.isArray(value)) {
        const result = [];
        for (const entry of value) result.push(await visit(entry, depth + 1));
        return result;
      }
      if (tag === 'object' && Array.isArray(value)) {
        const result = {}, keys = new Set();
        for (const pair of value) {
          requireValue(Array.isArray(pair) && pair.length === 2 && typeof pair[0] === 'string' && !keys.has(pair[0]), 'invalid_value', '本机对象键重复或无效。');
          keys.add(pair[0]);
          Object.defineProperty(result, pair[0], { value: await visit(pair[1], depth + 1), enumerable: true, writable: true, configurable: true });
        }
        return result;
      }
      throw new StorageError('invalid_value', '无法识别本机应用值，不作空值处理。');
    }
    return visit(tree);
  }
  return { encode, decode, close() { for (const url of urls) revokeObjectURL(url); urls.clear(); } };
}
