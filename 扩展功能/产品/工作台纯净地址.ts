type RouteAddress = { pathname: string; search: string; hash: string };

// React Router 7 的 masked 历史状态保留内部路由；浏览器的每次导航只写根地址。
// 使用既有 window 适配选项，不改全局 History、不新增业务存储或画布副本。
export function createCleanAddressHistory(source: Window): History {
    const history = source.history;
    const path = (value: URL): RouteAddress => ({ pathname: value.pathname, search: value.search, hash: value.hash });
    const savedRoute = (state: unknown): RouteAddress | null => {
        const candidate = (state as { masked?: Partial<RouteAddress> } | null)?.masked;
        if (!candidate || typeof candidate.pathname !== "string" || !/^\/(?!\/)/.test(candidate.pathname)
            || typeof candidate.search !== "string" || typeof candidate.hash !== "string") return null;
        const url = new URL(candidate.pathname + candidate.search + candidate.hash, source.location.origin);
        return url.origin === source.location.origin ? path(url) : null;
    };
    const current = () => savedRoute(history.state) || path(new URL(source.location.href));
    const write = (operation: "pushState" | "replaceState", data: unknown, unused: string, url?: string | URL | null) => {
        const address = current();
        const next = new URL(url == null ? address.pathname + address.search + address.hash : String(url), source.location.origin);
        if (next.origin !== source.location.origin) throw new DOMException("工作台路由不能切换到其他来源。", "SecurityError");
        const state = data && typeof data === "object" ? data : {};
        history[operation]({ ...state, masked: savedRoute(data) || path(next) }, unused, "/");
    };
    // 首次打开旧书签仍进入对应画布；根地址刷新则恢复本标签页自己的历史位置。
    const visible = new URL(source.location.href);
    const initial = visible.pathname !== "/" || visible.search || visible.hash ? path(visible) : current();
    history.replaceState({ ...(history.state || {}), masked: initial }, "", "/");

    const methods = new Map<PropertyKey, unknown>();
    return new Proxy(Object.create(null) as History, {
        get(_target, key) {
            if (key === "pushState" || key === "replaceState") {
                if (!methods.has(key)) methods.set(key, (data: unknown, unused: string, url?: string | URL | null) => write(key, data, unused, url));
                return methods.get(key);
            }
            const value: unknown = Reflect.get(history, key, history);
            if (typeof value !== "function") return value;
            if (!methods.has(key)) methods.set(key, value.bind(history));
            return methods.get(key);
        },
        set(_target, key, value: unknown) { return Reflect.set(history, key, value, history); },
    });
}
