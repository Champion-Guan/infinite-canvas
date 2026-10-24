// 待审查合并恢复批次：恢复画布音视频、节点信息、提示词管理及联网刷新。
export const closedFeatureIds = Object.freeze(["S06", "AI超分占位"]);
export const auxiliaryFeatures = Object.freeze({ urlCredentials: false, nodeInfo: true, superResolve: false, promptNetwork: true });

export function isGenerationModeEnabled(mode: string): boolean {
    return mode === "image" || mode === "text" || mode === "video" || mode === "audio";
}

export function requireAuxiliaryFeature(feature: keyof typeof auxiliaryFeatures): void {
    if (!auxiliaryFeatures[feature]) throw Object.assign(new Error("此功能已关闭；原有配置、任务和本地数据保留。"), { code: "product_feature_disabled" });
}

export function requireGenerationMode(mode: string): void {
    if (!isGenerationModeEnabled(mode)) throw Object.assign(new Error("不支持的生成模式。"), { code: "product_feature_disabled" });
}

// 仅作用于读取结果。远程封面/参考图不再自动加载，原缓存不修改。
export function offlinePrompt<T extends { coverUrl: string; referenceImageUrls: string[]; githubUrl: string; sourceUrl?: string }>(item: T): T {
    const isEmbeddedImage = (url: string) => /^data:image\/(?:png|jpeg|webp|gif|avif);base64,/i.test(url);
    return { ...item, coverUrl: isEmbeddedImage(item.coverUrl) ? item.coverUrl : "", referenceImageUrls: item.referenceImageUrls.filter(isEmbeddedImage), githubUrl: "", sourceUrl: "" };
}
