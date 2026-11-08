export const OPTIMIZATION_DIRECTIONS = [
    { id: "main-visual", label: "首屏主视觉", instruction: "提升首屏识别与主体层次，用已确认的商品特征传达核心价值。" },
    { id: "selling-points", label: "核心卖点图", instruction: "突出已提供并可验证的差异化卖点，不新增未经确认的性能或效果。" },
    { id: "usage-scene", label: "使用场景图", instruction: "强化与现有商品用途相符的真实使用情境，保留原图编辑和构图限制。" },
    { id: "multiple-views", label: "多角度图", instruction: "改善已有外观角度的表达；只使用参考资料支持的结构，不臆造看不到的部位。" },
    { id: "brand-story", label: "品牌故事图", instruction: "围绕已提供的品牌信息组织视觉叙事；品牌历史、资质与产地未提供时不得编造。" },
    { id: "comparison", label: "效果对比图", instruction: "只有资料存在可验证的对比证据时才强化对比表达，不编造前后效果、数据或竞品缺点。" },
    { id: "craft", label: "工艺制作图", instruction: "突出已确认的工艺和制作细节，不根据外观猜测制造流程、设备或手工程度。" },
    { id: "dimensions", label: "尺寸码图", instruction: "使已确认的尺寸或尺码关系更清楚；尺寸数值、单位与测量端点必须保持原样，缺失数据不补齐。" },
    { id: "specifications", label: "规格/参数表", instruction: "改善现有规格参数的信息层次，只整理已提供的数据，不增加未确认字段的数值。" },
    { id: "accessories", label: "配件/赠品图", instruction: "明确实际销售包装内已确认的配件和数量；没有明确赠送承诺时不得增加赠品或暗示赠送。" },
    { id: "series", label: "系列展示图", instruction: "仅在当前任务允许且资料已提供的范围内表现系列差异，不混用本卡对应变体与其他SKU或参考图。" },
    { id: "composition", label: "商品成分图", instruction: "强化已确认的材质、配方或成分信息；不推断配比、等级、认证或未提供的成分。" },
    { id: "after-sales", label: "售后保障图", instruction: "只有资料明确提供售后承诺时才改善质保、退换信息的表达，不自行添加保修期限或政策。" },
    { id: "usage-advice", label: "使用建议图", instruction: "让已提供的使用、搭配或养护建议更清楚，不增加未经确认的用途、步骤或安全承诺。" },
] as const;

export function normalizeOptimizationDirections(values: readonly string[] = []) {
    if (values.some(value => !OPTIMIZATION_DIRECTIONS.some(option => option.id === value)))
        throw Error("优化方向无效，请重新选择。");
    return OPTIMIZATION_DIRECTIONS.filter(option => values.includes(option.id)).map(option => option.id);
}
export function optimizationDirectionInstruction(values: readonly string[] = []) {
    const ids = normalizeOptimizationDirections(values);
    if (!ids.length) return "";
    return "用户为当前这一张提示词选择的优化角度（不拆成多张图片，不改变原图编辑与禁止改动约束；与硬约束冲突时说明原因）：\n" +
        OPTIMIZATION_DIRECTIONS.filter(option => ids.includes(option.id)).map(option => `${option.label}：${option.instruction}`).join("\n");
}
