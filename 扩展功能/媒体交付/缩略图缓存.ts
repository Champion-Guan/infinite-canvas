type Entry = { source: string; bytes: number };

// 仅缓存派生缩略图。data URL 淘汰后，已交给界面的字符串仍然有效；
// 不撤销正在显示的地址，也不触碰节点、原图或持久化数据。
export function createThumbnailCache({ maxEntries = 128, maxBytes = 8 * 1024 * 1024 } = {}) {
    const entries = new Map<string, Entry>();
    const flights = new Map<string, Promise<string | undefined>>();
    let bytes = 0;
    const get = (key: string) => {
        const entry = entries.get(key);
        if (!entry) return undefined;
        entries.delete(key);
        entries.set(key, entry);
        return entry.source;
    };
    const remove = (key: string) => {
        flights.delete(key);
        const entry = entries.get(key);
        if (entry) bytes -= entry.bytes;
        return entries.delete(key);
    };
    return {
        get,
        delete: remove,
        status: () => ({ entries: entries.size, bytes, pending: flights.size, maxEntries, maxBytes }),
        resolve(key: string, read: () => Promise<Blob | undefined>): Promise<string | undefined> {
            const cached = get(key);
            if (cached) return Promise.resolve(cached);
            const pending = flights.get(key);
            if (pending) return pending;
            const flight = Promise.resolve().then(read).then(async blob => {
                if (!blob || flights.get(key) !== flight) return undefined;
                const source = await new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    const finish = (error?: Error) => {
                        reader.onload = null;
                        reader.onerror = null;
                        reader.onabort = null;
                        if (error) reject(error);
                        else resolve(String(reader.result || ""));
                    };
                    reader.onload = () => finish();
                    reader.onerror = () => finish(new Error("缩略图读取失败"));
                    reader.onabort = () => finish(new Error("缩略图读取已取消"));
                    reader.readAsDataURL(blob);
                });
                if (flights.get(key) !== flight) return undefined;
                const cost = source.length * 2;
                if (source && maxEntries > 0 && cost <= maxBytes) {
                    entries.set(key, { source, bytes: cost });
                    bytes += cost;
                    while (entries.size > maxEntries || bytes > maxBytes) {
                        const oldest = entries.keys().next().value!;
                        const entry = entries.get(oldest)!;
                        entries.delete(oldest);
                        bytes -= entry.bytes;
                    }
                }
                return source || undefined;
            }).catch(() => undefined).finally(() => { if (flights.get(key) === flight) flights.delete(key); });
            flights.set(key, flight);
            return flight;
        },
    };
}
