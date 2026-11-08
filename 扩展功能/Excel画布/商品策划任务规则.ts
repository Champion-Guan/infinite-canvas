import { WILDBERRIES_PLATFORM, productPlatformRules, type ProductParameterMetadata } from "./旧版参数规则";
import type { ProductImagePlan } from "./商品提示词规则";
import { productImageLanguageRequirement } from "./商品图片语言";

// 渠道约定只在本次任务中传入，不进入通用角色。
export function productPlanningRequirements(metadata: ProductParameterMetadata) {
    const platform = metadata.productPlatform || WILDBERRIES_PLATFORM;
    const keywords = metadata.productBrief?.imageKeywords?.trim();
    return {
        platform, textLanguage: metadata.productLanguage || "",
        imageTextLanguageRequirement: productImageLanguageRequirement(metadata.productLanguage),
        imageTextPlanning: "逐张按图片用途决定必要文字，不展示用户关键词不等于无字。数量或套装图可清晰标注已确认的总数、单品数量与配件名称，尺寸图可标注真实数值和单位，其他图片可按需要提供简洁说明；文字、字体层级与位置都写入该图完整提示词。不得编造未提供的数量或参数，也不要求每张图都加字。",
        imageKeywordRequirement: keywords ? {
            text: keywords,
            selection: "由AI根据整套图片分工、买家问题、构图留白和渠道要求选择适合展示关键词的图片，不要求每张图片都展示，也不把全部关键词重复堆到每张图。未选中关键词的图片仍可按用途添加总数、尺寸等必要文字。",
            rendering: "关键词是要在图片中实际显示的文字，不只是策划主题或隐藏描述。为选中图片在完整中英文生图提示词中写明具体上图文字、字体风格与字重、字号层级、颜色对比、构图位置、对齐与安全留白；copyLayout与提示词保持一致，不能仅留作后期排版建议。",
            language: "普通关键词按本次图片文字语言准确表达，不改变原意；未指定语言时保留原文。品牌名、产品名、型号、数字和单位保留。中英文提示词引用相同的实际上图文字。",
        } : null,
        channelRules: productPlatformRules({ ...metadata, productPlatform: platform }),
        production: platform === WILDBERRIES_PLATFORM ? {
            mainAndCarousel: { width: 1800, height: 2400, format: "png", maxMB: 10, overlayText: "as-needed", promotionalLabels: false },
            rich: { required: true, width: 800, height: 500, format: "png", maxMB: 5, video: false },
            main: "完整展示实际销售商品或套装；细节图可按需要展示局部，不误导整体结构和数量。",
        } : null,
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
