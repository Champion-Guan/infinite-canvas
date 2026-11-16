// 引用仅活在本页内存；编码器仍保存原媒体描述，不把此占位地址写入数据库。
const entries = new Map();
const aliases = new Map();

export function deferCanvasMediaUrl(read, release = () => {}, preview) {
  const url = `blob:guan-deferred:${crypto.randomUUID()}`;
  const entry = { read, release, preview: undefined, flight: null, owners: 0, epoch: 0 };
  if (preview) entry.preview = { ...preview, async readBlob() {
    const epoch = entry.epoch;
    const blob = await preview.readBlob();
    if (epoch !== entry.epoch) { preview.release?.(); throw Error('画布已休眠，媒体读取已释放。'); }
    return blob;
  } };
  entries.set(url, entry);
  return url;
}

export function releaseDeferredCanvasMedia(url) {
  const entry = entries.get(url);
  if (entry?.resolved) entry.release(entry.resolved);
  entry?.preview?.release?.();
  entry && entry.epoch++;
  entries.delete(url);
  for (const [source, value] of aliases) if (value === entry) aliases.delete(source);
}
const entryFor = value => entries.get(value) ?? aliases.get(value);
export const deferredCanvasMediaPreview = value => typeof value === 'string' ? entryFor(value)?.preview : undefined;
export function hasDeferredCanvasMedia(value, { ignoreKeyedImageUrls = false, deferImageNodes = false } = {}) {
  if (typeof value === 'string') {
    const entry = entryFor(value);
    return Boolean(entry && (entries.has(value) || entry.resolved !== value));
  }
  if (!value || typeof value !== 'object') return false;
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return false;
  if (deferImageNodes && value.type === 'image' && value.metadata?.storageKey) return false;
  return Object.entries(value).some(([key, child]) =>
    !(ignoreKeyedImageUrls && key === 'url' && value.storageKey?.startsWith?.('image:'))
    && hasDeferredCanvasMedia(child, { ignoreKeyedImageUrls, deferImageNodes }));
}

export function retainCanvasMedia(value) {
  const retained = new Set();
  const collect = item => {
    if (typeof item === 'string') { const entry = entryFor(item); if (entry) retained.add(entry); return; }
    if (!item || typeof item !== 'object') return;
    if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) return;
    Object.values(item).forEach(collect);
  };
  collect(value);
  for (const entry of retained) entry.owners++;
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    for (const entry of retained) entry.owners--;
    // StrictMode的同步重挂载会先续租；真实休眠卸载后才回收原图。
    queueMicrotask(() => {
      for (const entry of retained) if (!entry.owners) {
        entry.epoch++;
        if (entry.resolved) entry.release(entry.resolved);
        entry.preview?.release?.();
        entry.resolved = undefined;
        entry.flight = null;
      }
    });
  };
}

export function sameDeferredCanvasMedia(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const first = entryFor(a), second = entryFor(b);
  return Boolean(first && first === second);
}

/**
 * @template T
 * @param {T} value
 * @returns {Promise<T>}
 */
export async function restoreCanvasMedia(value, { deferImageNodes = false, deferKeyedImageUrls = false } = {}) {
  const pending = new Set(), visited = new WeakSet();
  const collect = item => {
    if (typeof item === 'string') {
      const entry = entryFor(item);
      if (entry && (entries.has(item) || entry.resolved !== item)) pending.add(item);
      return;
    }
    if (!item || typeof item !== 'object' || visited.has(item)) return;
    if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) return;
    if (deferImageNodes && item.type === 'image' && item.metadata?.storageKey) return;
    visited.add(item);
    for (const [key, child] of Object.entries(item)) {
      if (deferKeyedImageUrls && key === 'url' && item.storageKey?.startsWith?.('image:')) continue;
      collect(child);
    }
  };
  collect(value);
  if (!pending.size) return value;
  const urls = [...pending], replacements = new Map();
  let cursor = 0;
  // 多张当前画布图片有界并发；其他产品不读取，失败可继续读取原引用。
  await Promise.all(Array.from({ length: Math.min(4, urls.length) }, async () => {
    while (cursor < urls.length) {
      const url = urls[cursor++], entry = entryFor(url);
      if (!entry.flight) {
        const epoch = entry.epoch;
        const flight = Promise.resolve().then(entry.read).then(source => {
          if (epoch !== entry.epoch) { entry.release(source); throw Error('画布已休眠，媒体读取已释放。'); }
          entry.resolved = source; aliases.set(source, entry); return source;
        });
        entry.flight = flight;
        void flight.catch(() => { if (entry.flight === flight) entry.flight = null; });
      }
      replacements.set(url, await entry.flight);
    }
  }));
  const clones = new WeakMap();
  const replace = item => {
    if (typeof item === 'string') return replacements.get(item) ?? item;
    if (!item || typeof item !== 'object') return item;
    if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) return item;
    if (deferImageNodes && item.type === 'image' && item.metadata?.storageKey) return item;
    if (clones.has(item)) return clones.get(item);
    const result = Array.isArray(item) ? [] : Object.create(Object.getPrototypeOf(item));
    clones.set(item, result);
    for (const [key, child] of Object.entries(item)) Object.defineProperty(result, key, {
      value: replace(child), enumerable: true, configurable: true, writable: true,
    });
    return result;
  };
  return replace(value);
}
