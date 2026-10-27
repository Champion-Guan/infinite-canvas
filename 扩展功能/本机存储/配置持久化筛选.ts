import type { PersistStorage, StorageValue } from "zustand/middleware";

type ConfigState = { config: unknown; webdav: unknown };

// 页签、开关面板等界面状态不进入 JSON 序列化；真正修改配置才交给保存队列。
// 只比较不可变配置引用，保存失败会失效，避免吞掉相同内容的重试。
export function createConfigPersistence<T extends ConfigState>(storage: PersistStorage<T>, name: string) {
    let latest: { value: StorageValue<T>; pending?: Promise<unknown> } | undefined;
    const filtered: PersistStorage<T> = {
        getItem: key => storage.getItem(key),
        setItem(key, value) {
            if (key !== name) return storage.setItem(key, value);
            if (latest && latest.value.version === value.version && latest.value.state.config === value.state.config && latest.value.state.webdav === value.state.webdav) return latest.pending;
            const entry = { value, pending: undefined as Promise<unknown> | undefined };
            latest = entry;
            try {
                const result = storage.setItem(key, value);
                entry.pending = Promise.resolve(result).catch(error => {
                    if (latest === entry) latest = undefined;
                    throw error;
                });
                // Zustand 的界面 setter 不要求调用方 await；错误仍由保存状态与显式排空报告。
                entry.pending.catch(() => {});
                return entry.pending;
            } catch (error) {
                latest = undefined;
                throw error;
            }
        },
        removeItem(key) {
            if (key === name) latest = undefined;
            return storage.removeItem(key);
        },
    };
    return {
        storage: filtered,
        seed(state: T) { latest = { value: { state, version: 0 } }; },
    };
}
