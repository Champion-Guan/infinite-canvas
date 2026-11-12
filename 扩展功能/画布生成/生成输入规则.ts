export type GenerationInputCounts = { textCount: number; imageCount: number; videoCount: number; audioCount: number };
export type GenerationInputSummary = GenerationInputCounts & {
    variants?: Array<GenerationInputCounts & { id: string; name: string; images: string[] }>;
    error?: string;
};
export function generationInputCountLabel(summary: GenerationInputSummary, key: keyof GenerationInputCounts) {
    const unit = key === "imageCount" ? "张" : "个";
    if (summary.error) return "待核对";
    if (!summary.variants?.length) return `${summary[key]} ${unit}`;
    const counts = summary.variants.map(variant => variant[key]), min = Math.min(...counts), max = Math.max(...counts);
    if (max === 0) return `0 ${unit}`;
    return `${min === max ? min : `${min}–${max}`} ${unit}/变体`;
}
export function generationInputDetail(summary: GenerationInputSummary) {
    if (summary.error) return summary.error;
    return summary.variants?.map(variant => `${variant.name}：提示词 ${variant.textCount} 个，参考图 ${variant.imageCount} 张，视频 ${variant.videoCount} 个，音频 ${variant.audioCount} 个`
        + (variant.images.length ? `\n${variant.images.join("、")}` : "")).join("\n\n") || "";
}
