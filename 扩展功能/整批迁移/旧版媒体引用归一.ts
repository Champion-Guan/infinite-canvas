const cachedMediaFields = new Set(["content", "url", "src", "previewUrl", "posterUrl", "originalUrl", "deliveryUrl"]);
const persistentMediaKey = (value: unknown) => typeof value === "string" && /^(image|video|audio|file):/.test(value);

// blob地址只属于旧页面；素材已按storageKey迁入，显示缓存由新页面重建。
// 没有持久编号时预检失败，不能用空白素材代替。
export function normalizeLegacyMediaReferences<T>(value: T): T {
  function visit(item: unknown): unknown {
    if (Array.isArray(item)) return item.map(visit);
    if (item && typeof item === "object") {
      const object = item as Record<string, unknown>;
      const hasMedia = [object.storageKey, object.originalStorageKey, object.deliveryStorageKey].some(persistentMediaKey);
      return Object.fromEntries(Object.entries(object).flatMap(([key, child]) => {
        if (hasMedia && cachedMediaFields.has(key) && typeof child === "string" && child.startsWith("blob:")) return [];
        return [[key, visit(child)]];
      }));
    }
    if (typeof item === "string" && item.startsWith("blob:")) throw new Error("旧备份存在没有持久素材编号的临时媒体地址，请在旧版保存素材后重新导出；尚未导入产品或配置。");
    return item;
  }
  return visit(value) as T;
}
