// React Router的页面切换记录是瞬态技术状态，不属于SQLite业务文档。
// 只通过官方window选项使用本适配器，不修改全局Storage或第三方依赖。
function createPageStorage(): Storage {
    const values = new Map<string, string>();
    return {
        get length() { return values.size; },
        getItem(key: string) { return values.get(String(key)) ?? null; },
        setItem(key: string, value: string) { values.set(String(key), String(value)); },
        removeItem(key: string) { values.delete(String(key)); },
        clear() { values.clear(); },
        key(index: number) { return [...values.keys()][index] ?? null; },
    };
}

export function createRouterWindow(source: Window): Window {
    const session = createPageStorage();
    const methods = new Map<PropertyKey, { original: unknown; bound: unknown }>();
    // 使用空目标，避免WindowProxy的不可配置属性限制；原生方法仍绑定真实window。
    const facade: Window = new Proxy(Object.create(null) as Window, {
        get(_target, key) {
            if (key === "sessionStorage") return session;
            if (key === "localStorage" || key === "indexedDB") throw new Error("路由不能打开浏览器业务存储。");
            if (key === "window" || key === "self") return facade;
            const value: unknown = Reflect.get(source, key, source);
            if (typeof value !== "function") return value;
            const cached = methods.get(key);
            if (cached?.original === value) return cached.bound;
            const bound: unknown = value.bind(source);
            methods.set(key, { original: value, bound });
            return bound;
        },
        set(_target, key, value: unknown) {
            if (["sessionStorage", "localStorage", "indexedDB", "window", "self"].includes(String(key))) return false;
            return Reflect.set(source, key, value, source);
        },
        has(_target, key) { return key === "sessionStorage" || Reflect.has(source, key); },
    });
    return facade;
}
