import { Allow, parse } from "partial-json";
import type { CanvasNodeData } from "@/types/canvas";

type PreviewField = { label: string; text: string };
type PreviewPrompt = { chinese: string; english: string };
type PreviewImage = {
    name: string; kind: string; fields: PreviewField[]; prompt: PreviewPrompt;
    variants: { id: string; prompt: PreviewPrompt }[];
};
export type ProductPlanningPreview = { overview: PreviewField[]; images: PreviewImage[] };
const text = (value: unknown): string => typeof value === "string" ? value : "";
const record = (value: unknown): Record<string, unknown> =>
    value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const fields = (value: Record<string, unknown>, definitions: [string, string][]): PreviewField[] =>
    definitions.flatMap(([key, label]) => text(value[key]) ? [{ label, text: text(value[key]) }] : []);
function prompt(value: unknown): PreviewPrompt {
    const source = record(value), segments = list(source.segments).map(record), design = list(source.designSegments).map(record);
    return {
        chinese: [text(source.chinese) || segments.map(item => text(item.chinese)).join(""),
            design.map(item => text(item.chinese)).join("")].filter(Boolean).join("\n\n"),
        english: [text(source.english) || segments.map(item => text(item.english)).join(""),
            design.map(item => text(item.english)).join("")].filter(Boolean).join("\n\n"),
    };
}

export function productPlanningPreviewText(node: CanvasNodeData, previews: ReadonlyMap<string, {
    slotId: string; text: string;
}> | null): string {
    const task = node.metadata?.gatewayGenerationTasks?.find(item => item.slotId === "product-image-plan");
    const preview = task && previews?.get(task.taskId);
    return preview?.slotId === task?.slotId ? preview?.text || "" : "";
}

// Partial JSON is display-only. Final validation and canvas writes stay in 商品策划请求.
export function readProductPlanningPreview(raw: string): ProductPlanningPreview {
    let value: Record<string, unknown>;
    try {
        const source = raw.trimStart().replace(/^```(?:json)?\s*/i, "");
        value = record(parse(source, Allow.STR | Allow.OBJ | Allow.ARR));
    } catch { return { overview: [], images: [] }; }
    const overview = [
        ...fields(record(value.overview), [
            ["buyers", "目标买家"], ["sellingPoints", "核心卖点"], ["concerns", "购买顾虑"],
            ["consistency", "一致性约束"], ["sequence", "图片顺序与分工"],
        ]),
        ...fields(value, [["style", "视觉风格"]]),
        ...(["assumptions", "pendingFacts"] as const).flatMap(key => {
            const content = list(value[key]).map(text).filter(Boolean).join("\n");
            return content ? [{ label: key === "assumptions" ? "制作假设" : "待确认", text: content }] : [];
        }),
    ];
    const kinds: Record<string, string> = { main: "主图", carousel: "轮播图", rich: "富内容" };
    const images = list(value.images).map(entry => {
        const image = record(entry), kind = text(image.kind);
        return {
            name: text(image.name), kind: Object.hasOwn(kinds, kind) ? kinds[kind] : "",
            fields: fields(image, [
                ["buyerQuestion", "买家问题"], ["evidence", "商品依据"], ["composition", "画面与构图"],
                ["constraints", "禁止改动"], ["copyLayout", "图片文字与排版"], ["checks", "人工检查"],
            ]),
            prompt: prompt(image.prompt),
            variants: Object.entries(record(image.variants)).map(([id, value]) => ({ id, prompt: prompt(value) })),
        };
    }).filter(image => image.name || image.kind || image.fields.length || image.prompt.chinese || image.variants.length);
    return { overview, images };
}
