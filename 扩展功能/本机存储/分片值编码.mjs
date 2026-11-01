import { requireValue, serializeDocument } from './协议.mjs';

export const FRAGMENT_FORMAT = 'guan-app-fragment.v1';
export const MAX_FRAGMENT_BYTES = 1024 * 1024 * 100; // 100MB 单个文档，禁用分片
export const MAX_LOGICAL_BYTES = 1_000_000_000; // 1GB 无分片限制
export const MAX_GRAPH_FRAGMENTS = 4096; // 兼容升级前已保存的多块数据
const INLINE_BYTES = 1_000_000_000, FIELD_BYTES = 1_000_000_000, INLINE_DEPTH = 30, MAX_GRAPH_DEPTH = 128;
const utf8 = new TextEncoder();
const bytes = value => utf8.encode(JSON.stringify(value)).length;
const sha = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', utf8.encode(value)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
const sameKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const validRef = value => sameKeys(value, ['id']) && typeof value.id === 'string' && /^app-part-[a-f0-9]{64}$/.test(value.id);
const typedObject = value => Array.isArray(value) && value.length === 2 && value[0] === 'object' && Array.isArray(value[1]);
function shallow(value, depth = 0) {
  if (depth > INLINE_DEPTH) return false;
  if (typedObject(value) && bytes(value) > FIELD_BYTES) return false;
  return value === null || typeof value !== 'object' || Object.values(value).every(child => shallow(child, depth + 1));
}

// 禁用分片机制：直接保存为单个文档，无大小限制（除系统限制外）
export async function buildFragmentPlan(value) {
  const sizes = new WeakMap(), depths = new WeakMap(), stringSizes = new Map();
  function sizeOf(item) {
    if (typeof item === 'string') {
      if (stringSizes.has(item)) return stringSizes.get(item);
      const size = bytes(item);
      if (stringSizes.size < 8192) stringSizes.set(item, size);
      return size;
    }
    if (item === null || typeof item !== 'object') return bytes(item);
    if (!sizes.has(item)) {
      const entries = Array.isArray(item) ? item : Object.entries(item);
      let size = 2 + Math.max(0, entries.length - 1);
      for (const entry of entries) size += Array.isArray(item) ? sizeOf(entry) : sizeOf(entry[0]) + 1 + sizeOf(entry[1]);
      sizes.set(item, size);
    }
    return sizes.get(item);
  }
  function inlineDepth(item) {
    if (item === null || typeof item !== 'object') return 0;
    if (!depths.has(item)) {
      let depth = 0;
      if (typedObject(item) && sizeOf(item) > FIELD_BYTES) depth = Infinity;
      else for (const child of Object.values(item)) depth = Math.max(depth, 1 + inlineDepth(child));
      depths.set(item, depth);
    }
    return depths.get(item);
  }
  const logicalBytes = sizeOf(value), fragments = new Map();

  // 直接保存为单个文档，不进行分片
  async function save(body) {
    const value = { format: FRAGMENT_FORMAT, ...body }, text = JSON.stringify(value);
    const hash = await sha(text), id = 'app-part-' + hash;
    serializeDocument('extension', id, value, []);
    if (!fragments.has(id)) fragments.set(id, { id, hash, value });
    return { id };
  }

  const rootPart = await save({ kind: 'json', data: value });
  return { head: rootPart, fragments, logicalBytes };
}

export async function verifyFragment(document, reference) {
  requireValue(validRef(reference) && document?.collection === 'extension' && document.id === reference.id && Array.isArray(document.mediaIds) && document.mediaIds.length === 0 && document.value?.format === FRAGMENT_FORMAT,
    'fragment_corrupt', '数据块缺失、身份或格式不符，未作为空值读取。', 409);
  const text = serializeDocument('extension', reference.id, document.value, []);
  requireValue(utf8.encode(text).length <= MAX_FRAGMENT_BYTES && await sha(text) === reference.id.slice(9), 'fragment_corrupt', '数据块大小或内容哈希不匹配。', 409);
  return document.value;
}

// 新保存使用单文档；旧分片仍按原目录重组，升级不能丢失已保存的数据。
export async function readFragmentGraph({ head, readDocument }) {
  const cache = new Map(), visiting = new Set();
  let loaded = 0;
  const bounded = result => {
    requireValue(result.size <= MAX_LOGICAL_BYTES && result.depth <= MAX_GRAPH_DEPTH, 'fragment_budget_exceeded', '分片重组超过大小或层级安全范围。', 413);
    return result;
  };
  async function visit(ref, depth = 0) {
    requireValue(validRef(ref) && depth <= MAX_GRAPH_DEPTH && !visiting.has(ref.id), 'fragment_corrupt', '数据块引用、层级或循环无效。', 409);
    if (cache.has(ref.id)) return cache.get(ref.id);
    requireValue(++loaded <= MAX_GRAPH_FRAGMENTS, 'fragment_budget_exceeded', '读取的数据块数量超过安全范围。', 413);
    visiting.add(ref.id);
    const body = await verifyFragment(await readDocument('extension', ref.id), ref);
    let result;
    if (body.kind === 'json') {
      requireValue(sameKeys(body, ['format', 'kind', 'data']), 'fragment_corrupt', '内联数据块结构无效。', 409);
      result = bounded({ value: body.data, size: bytes(body.data), depth: 1 });
    } else if (body.kind === 'single') {
      requireValue(sameKeys(body, ['format', 'kind', 'part']), 'fragment_corrupt', '单元素数据块结构无效。', 409);
      const child = await visit(body.part, depth + 1);
      result = bounded({ value: [child.value], size: child.size + 2, depth: child.depth + 1 });
    } else if (body.kind === 'array' || body.kind === 'text') {
      requireValue(sameKeys(body, ['format', 'kind', 'parts']) && Array.isArray(body.parts) && body.parts.length > 0 && body.parts.length <= 64, 'fragment_corrupt', '分片目录结构无效。', 409);
      const values = []; let size = 2, childDepth = 0, length = 0, lastCode = 0;
      for (const part of body.parts) {
        const child = await visit(part, depth + 1);
        requireValue(body.kind === 'array' ? Array.isArray(child.value) : typeof child.value === 'string', 'fragment_corrupt', '数据块类型与目录不匹配。', 409);
        size += child.size - 2 + (body.kind === 'array' && length && child.value.length ? 1 : 0); childDepth = Math.max(childDepth, child.depth);
        if (body.kind === 'text' && child.value.length) {
          const firstCode = child.value.charCodeAt(0);
          if (lastCode >= 0xd800 && lastCode <= 0xdbff && firstCode >= 0xdc00 && firstCode <= 0xdfff) size -= 8;
          lastCode = child.value.charCodeAt(child.value.length - 1);
        }
        length += child.value.length;
        bounded({ size, depth: childDepth + 1 });
        requireValue(body.kind !== 'array' || length <= 1_000_000, 'fragment_budget_exceeded', '数组展开数量超过安全范围。', 413);
        values.push(child.value);
      }
      const value = body.kind === 'array' ? values.flat() : values.join('');
      result = bounded({ value, size: body.kind === 'text' ? bytes(value) : size, depth: childDepth + 1 });
    } else if (body.kind === 'typed-object') {
      requireValue(sameKeys(body, ['format', 'kind', 'entries']), 'fragment_corrupt', '带类型对象目录无效。', 409);
      const child = await visit(body.entries, depth + 1), entries = [], names = new Set();
      requireValue(Array.isArray(child.value), 'fragment_corrupt', '带类型对象字段目录无效。', 409);
      let size = 13, childDepth = child.depth;
      for (const pair of child.value) {
        requireValue(Array.isArray(pair) && pair.length === 2 && typeof pair[0] === 'string' && !names.has(pair[0]) && Array.isArray(pair[1]) && pair[1].length === 2, 'fragment_corrupt', '带类型对象字段重复或无效。', 409);
        const [tag, payload] = pair[1];
        requireValue(tag === 'inline' && shallow(payload) || tag === 'ref' && validRef(payload), 'fragment_corrupt', '带类型字段引用无效。', 409);
        const item = tag === 'ref' ? await visit(payload, depth + 1) : { value: payload, size: bytes(payload), depth: 1 };
        size += bytes(pair[0]) + item.size + 3 + (entries.length ? 1 : 0); childDepth = Math.max(childDepth, item.depth);
        bounded({ size, depth: childDepth + 1 }); names.add(pair[0]); entries.push([pair[0], item.value]);
      }
      const value = ['object', entries];
      result = bounded({ value, size: bytes(value), depth: childDepth + 1 });
    } else if (body.kind === 'object') {
      requireValue(sameKeys(body, ['format', 'kind', 'entries']), 'fragment_corrupt', '对象数据块结构无效。', 409);
      const child = await visit(body.entries, depth + 1), value = {}, names = new Set();
      requireValue(Array.isArray(child.value), 'fragment_corrupt', '对象字段目录无效。', 409);
      for (const pair of child.value) {
        requireValue(Array.isArray(pair) && pair.length === 2 && typeof pair[0] === 'string' && !names.has(pair[0]), 'fragment_corrupt', '对象字段重复或无效。', 409);
        names.add(pair[0]); Object.defineProperty(value, pair[0], { value: pair[1], enumerable: true, configurable: true, writable: true });
      }
      result = bounded({ value, size: child.size, depth: child.depth + 1 });
    } else requireValue(false, 'fragment_corrupt', '未知数据块版本或类型。', 409);
    visiting.delete(ref.id); cache.set(ref.id, result); return result;
  }
  return (await visit(head)).value;
}
