// 用户已选择的产品策略；只通过获批适配接入，不读取 URL 或改写用户配置。
export type ProductFeature = "webdav" | "externalAgent" | "analytics" | "localProxy" | "nodePlugins" | "languageSwitch" | "themeSwitch" | "authorVersion" | "docsLink";

export const productFeatures: Readonly<Record<ProductFeature, boolean>> = Object.freeze({
    webdav: false,
    externalAgent: false,
    analytics: false,
    localProxy: true,
    nodePlugins: false,
    languageSwitch: false,
    themeSwitch: false,
    authorVersion: false,
    docsLink: false,
});

export const pageFeatures: Readonly<Record<"home" | "image" | "video" | "canvas" | "assets" | "prompts" | "config", boolean>> = Object.freeze({ home: false, image: false, video: false, canvas: false, assets: false, prompts: false, config: false });
// 不启用作者部署、插件发布或文档站构建，不修改作者工作流或远程设置。
export const buildFeatures = Object.freeze({ authorDeployments: false, authorDocs: false });

export const closedFeatureIds: readonly string[] = Object.freeze([
    "P01", "P02", "P03", "P04", "P05", "P06", "P07",
    "U01", "U03", "U04", "S08",
    "G01", "G02", "G03", "G04", "G05", "G06", "G07",
    "X01", "X02", "X03", "X04", "X05", "X06", "X07", "X08",
    "B01", "B02", "B03", "B04",
]);

const names: Record<ProductFeature, string> = {
    webdav: "WebDAV 同步", externalAgent: "外部 Agent", analytics: "访问统计",
    localProxy: "原版本地请求代理", nodePlugins: "原版节点插件",
    languageSwitch: "语言切换", themeSwitch: "主题切换", authorVersion: "原作者版本检测", docsLink: "作者文档入口",
};

export function requireProductFeature(feature: ProductFeature): void {
    if (productFeatures[feature] !== true) {
        throw Object.assign(new Error(`${names[feature] ?? "此功能"}已在本产品关闭；原有数据仍保留。`), { code: "product_feature_disabled" });
    }
}

export function resolveConfigTab<T extends string>(tab: T): T | "channels" {
    return (tab === "webdav" && !productFeatures.webdav) || (tab === "local-proxy" && !productFeatures.localProxy) ? "channels" : tab;
}

// 只关闭独立页面，不连带关闭侧栏、选择器或渠道配置弹窗。
export function isPageEnabled(slug: string): boolean {
    return Object.hasOwn(pageFeatures, slug) && pageFeatures[slug as keyof typeof pageFeatures] === true;
}

export function isCanvasMenuEnabled(key: string): boolean {
    if (key === "home") return isPageEnabled("home");
    if (key === "projects") return isPageEnabled("canvas");
    if (key === "docs") return productFeatures.docsLink;
    return true;
}

export function entryProjectId(projects: ReadonlyArray<{ id: string; updatedAt: string }>): string | null {
    let current: { id: string; updatedAt: string } | undefined;
    for (const project of projects) {
        if (project.id && (!current || project.updatedAt > current.updatedAt)) current = project;
    }
    return current?.id ?? null;
}
