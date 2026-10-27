// 同一媒体并发恢复共用一次读取；替换和删除必须释放旧URL，迟到读取不可复活已删除的缓存。
export function createMediaUrlCache() {
    const urls = new Map<string, string>();
    const flights = new Map<string, Promise<string>>();
    const set = (key: string, url: string) => {
        flights.delete(key);
        const previous = urls.get(key);
        if (previous && previous !== url) URL.revokeObjectURL(previous);
        urls.set(key, url);
    };
    return {
        get: (key: string) => urls.get(key),
        set,
        delete(key: string) {
            flights.delete(key);
            const previous = urls.get(key);
            if (previous) URL.revokeObjectURL(previous);
            return urls.delete(key);
        },
        resolve(key: string, read: () => Promise<Blob | null | undefined>, fallback: string): Promise<string> {
            const cached = urls.get(key);
            if (cached) return Promise.resolve(cached);
            const pending = flights.get(key);
            if (pending) return pending.then(value => value || fallback);
            const flight = Promise.resolve().then(read).then(blob => {
                if (flights.get(key) !== flight) return urls.get(key) || "";
                if (!blob) return "";
                const url = URL.createObjectURL(blob);
                set(key, url);
                return url;
            }).finally(() => { if (flights.get(key) === flight) flights.delete(key); });
            flights.set(key, flight);
            return flight.then(value => value || fallback);
        },
    };
}
