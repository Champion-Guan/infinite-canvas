// 局部关闭：保留已有来源和单源手动刷新，拒绝新增、自动刷新及全部拉取；不重置原配置。
export type BusinessFeature = "modelScripts" | "promptSources" | "promptRefresh" | "promptSourceCreate" | "promptRefreshAll";

export const businessFeatures: Readonly<Record<BusinessFeature, boolean>> = Object.freeze({
    modelScripts: false,
    promptSources: true,
    promptRefresh: false,
    promptSourceCreate: false,
    promptRefreshAll: false,
});

const names: Record<BusinessFeature, string> = {
    modelScripts: "自定义模型调用脚本",
    promptSources: "提示词来源管理与手动刷新",
    promptRefresh: "提示词自动刷新",
    promptSourceCreate: "新增提示词来源",
    promptRefreshAll: "全部提示词来源拉取",
};

export function requireBusinessFeature(feature: BusinessFeature): void {
    if (businessFeatures[feature] !== true) {
        throw Object.assign(new Error(`${names[feature]}已关闭；原有配置和缓存保留，不执行自定义脚本或替代请求。`), { code: "product_feature_disabled" });
    }
}

export function resolveBusinessConfigTab<T extends string>(tab: T): T | "channels" {
    return tab === "prompt-sources" && !businessFeatures.promptSources ? "channels" : tab;
}
