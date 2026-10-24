import { requireValue, serializeDocument } from './协议.mjs';

export const FRAGMENT_FORMAT = 'guan-app-fragment.v1';
export const MAX_FRAGMENT_BYTES = 1024 * 1024;
export const MAX_LOGICAL_BYTES = 32 * 1024 * 1024;
export const MAX_GRAPH_FRAGMENTS = 4096;
const INLINE_BYTES = 768 * 1024, FIELD_BYTES = 192 * 1024, INLINE_DEPTH = 30, MAX_GRAPH_DEPTH = 128;
const utf8 = new TextEncoder();
const bytes = value => utf8.encode(JSON.stringify(value)).length;
const sha = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', utf8.encode(value)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
const sameKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const validRef = value => sameKeys(value, ['id']) && typeof value.id === 'string' && /^app-part-[a-f0-9]{64}$/.test(value.id);
const typedObject = value => Array.isArray(value) && value.length === 2 && value[0] === 'object' && Array.isArray(value[1]);
function shallow(value, depth = 0) {
  if (depth > INLINE_DEPTH) return false;
  // 大的带类型对象按字段隔离，不能被外层数组重新合并成整产品块。
  if (typedObject(value) && bytes(value) > FIELD_BYTES) return false;
  return value === null || typeof value !== 'object' || Object.values(value).every(child => shallow(child, depth + 1));
}

// 只接收应用值编码器产生的普通JSON，不用于绕过凭据检测。
// 固定数组分页保持局部修改的块边界；先生成完整计划，后由应用适配器提交根目录。
export async function buildFragmentPlan(value) {
  // 同一快照的子树会在分片判定中反复经过；大小与可内联深度只计算一次。
  // 缓存仅活在本次计划内，不跨可变对象复用，也不改变内容寻址格式。
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
  requireValue(logicalBytes <= MAX_LOGICAL_BYTES, 'logical_value_too_large', '逻辑命名空间超过当前32MiB分片验收范围。', 413);
  async function save(body) {
    const value = { format: FRAGMENT_FORMAT, ...body }, text = JSON.stringify(value), size = utf8.encode(text).length;
    requireValue(size <= MAX_FRAGMENT_BYTES, 'fragment_too_large', '数据块超过1MiB上限，没有提交根目录。', 413);
    const hash = await sha(text), id = 'app-part-' + hash;
    serializeDocument('extension', id, value, []);
    if (!fragments.has(id)) fragments.set(id, { id, hash, value });
    requireValue(fragments.size <= MAX_GRAPH_FRAGMENTS, 'fragment_budget_exceeded', '数据块数量超过当前4096块验收范围。', 413);
    return { id };
  }
  async function pack(value, depth = 0) {
    requireValue(depth <= MAX_GRAPH_DEPTH, 'fragment_depth_exceeded', '分片结构层级超过安全范围。');
    if (typedObject(value) && sizeOf(value) > FIELD_BYTES) {
      const entries = [];
      for (const pair of value[1]) {
        requireValue(Array.isArray(pair) && pair.length === 2 && typeof pair[0] === 'string', 'invalid_fragment_value', '带类型对象字段无效。');
        entries.push([pair[0], sizeOf(pair[1]) > FIELD_BYTES ? ['ref', await pack(pair[1], depth + 1)] : ['inline', pair[1]]]);
      }
      return save({ kind: 'typed-object', entries: await pack(entries, depth + 1) });
    }
    if (sizeOf(value) <= INLINE_BYTES && inlineDepth(value) <= INLINE_DEPTH) return save({ kind: 'json', data: value });
    if (typeof value === 'string') {
      let parts = [];
      // 按UTF-16固定位置切分，重组后保留原字符（含跨块代理对及孤立代理项）。
      for (let offset = 0; offset < value.length; offset += 8192) parts.push(await save({ kind: 'json', data: value.slice(offset, offset + 8192) }));
      while (parts.length > 64) {
        const next = [];
        for (let offset = 0; offset < parts.length; offset += 64) next.push(await save({ kind: 'text', parts: parts.slice(offset, offset + 64) }));
        parts = next;
      }
      return save({ kind: 'text', parts });
    }
    if (Array.isArray(value)) {
      if (value.length === 1) return save({ kind: 'single', part: await pack(value[0], depth + 1) });
      const width = value.length > 64 ? 64 : Math.ceil(value.length / 2), parts = [];
      for (let offset = 0; offset < value.length; offset += width) parts.push(await pack(value.slice(offset, offset + width), depth + 1));
      // 多级分页也限制根块扇出，避免百万条小记录把根目录撑大。
      while (parts.length > 64) {
        const next = [];
        for (let offset = 0; offset < parts.length; offset += 64) next.push(await save({ kind: 'array', parts: parts.slice(offset, offset + 64) }));
        parts.splice(0, parts.length, ...next);
      }
      return save({ kind: 'array', parts });
    }
    requireValue(value && typeof value === 'object', 'invalid_fragment_value', '分片只接收普通JSON值。');
    return save({ kind: 'object', entries: await pack(Object.entries(value), depth + 1) });
  }
  return { head: await pack(value), fragments, logicalBytes };
}

export async function verifyFragment(document, reference) {
  requireValue(validRef(reference) && document?.collection === 'extension' && document.id === reference.id && Array.isArray(document.mediaIds) && document.mediaIds.length === 0 && document.value?.format === FRAGMENT_FORMAT,
    'fragment_corrupt', '数据块缺失、身份或格式不符，未作为空值读取。', 409);
  const text = serializeDocument('extension', reference.id, document.value, []);
  requireValue(utf8.encode(text).length <= MAX_FRAGMENT_BYTES && await sha(text) === reference.id.slice(9), 'fragment_corrupt', '数据块大小或内容哈希不匹配。', 409);
  return document.value;
}

// 不依赖集合列表，避免列表1000条上限造成静默遗漏；通过根引用逐块校验。
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
      requireValue(sameKeys(body, ['format', 'kind', 'data']) && shallow(body.data), 'fragment_corrupt', '内联数据块结构无效。', 409);
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
        // 数组页的外括号不属于展开结果；文本拼接还可能合并跨页代理对。
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
