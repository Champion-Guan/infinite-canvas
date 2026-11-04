import { WILDBERRIES_PLATFORM, productPlatformRules, type ProductParameterMetadata } from "./旧版参数规则";
import { PRODUCT_IMAGE_MODEL, type ProductImagePlan } from "./商品提示词规则";

// 渠道约定只在本次任务中传入，不进入通用角色。
export function productPlanningRequirements(metadata: ProductParameterMetadata) {
    const platform = metadata.productPlatform || WILDBERRIES_PLATFORM;
    return {
        platform, textLanguage: metadata.productLanguage || "",
        channelRules: productPlatformRules({ ...metadata, productPlatform: platform }),
        production: platform === WILDBERRIES_PLATFORM ? {
            mainAndCarousel: { width: 1800, height: 2400, format: "png", maxMB: 10, overlayText: false, promotionalLabels: false },
            rich: { required: true, width: 800, height: 500, format: "png", maxMB: 5, video: false },
            main: "完整展示实际销售商品或套装；细节图可按需要展示局部，不误导整体结构和数量。",
        } : null,
        imageModel: PRODUCT_IMAGE_MODEL,
        instructions: "根据商品事实智能决定图片类型和数量。未给出的渠道规格不得套用其他平台规则；必要制作假设列入 assumptions。每个变体使用其专属照片与事实，共用图片分工和风格，不能混用颜色、尺寸、数量或款式。输出格式及文件大小需要导出后检查。",
    };
}

export function validateProductPlanRequirements(plan: ProductImagePlan, metadata: ProductParameterMetadata) {
    if ((metadata.productPlatform || WILDBERRIES_PLATFORM) !== WILDBERRIES_PLATFORM || !plan.images.length) return;
    if (!plan.images.some(image => image.kind === "main") || !plan.images.some(image => image.kind === "rich"))
        throw Error("本次 Wildberries 制作需求包含主图和富内容，请重新策划。");
    for (const image of plan.images) {
        const expected = image.kind === "rich" ? [800, 500, 5] : [1800, 2400, 10];
        if (image.delivery.width !== expected[0] || image.delivery.height !== expected[1]
            || image.delivery.format !== "png" || image.delivery.maxMB !== expected[2])
            throw Error(`“${image.name}”不符合本次任务提供的交付要求，请重新策划。`);
    }
}
