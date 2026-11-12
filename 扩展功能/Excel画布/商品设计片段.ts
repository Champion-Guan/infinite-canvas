import { readBilingualSegments, type AlignedBilingualText } from "../提示词/双语片段对齐";

export const PRODUCT_PLAN_DESIGN_PROTOCOL = "product-image-plan.v2";
type DesignReason = "protocol_required" | "protocol_unsupported" | "body_segments_required" | "body_segments_invalid"
    | "design_segments_required" | "design_segments_invalid";

export class ProductPlanDesignError extends Error {
    readonly code = "invalid_product_plan_design";
    constructor(readonly path: string, readonly reason: DesignReason) {
        super("策划的双语设计片段不完整，原方案已保留。");
        this.name = "ProductPlanDesignError";
    }
}

export function requireProductPlanDesignProtocol(version: unknown, required: boolean) {
    if (version !== undefined && version !== PRODUCT_PLAN_DESIGN_PROTOCOL)
        throw new ProductPlanDesignError("protocolVersion", "protocol_unsupported");
    if (required && version !== PRODUCT_PLAN_DESIGN_PROTOCOL)
        throw new ProductPlanDesignError("protocolVersion", "protocol_required");
    return version === PRODUCT_PLAN_DESIGN_PROTOCOL;
}

export function compileProductDesignSegments(value: unknown, path: string, required: boolean) {
    const input = value as { segments?: unknown; designSegments?: unknown } | null;
    if (input?.designSegments === undefined) {
        if (required) throw new ProductPlanDesignError(`${path}.designSegments`, "design_segments_required");
        return undefined;
    }
    if (input.segments === undefined) throw new ProductPlanDesignError(`${path}.segments`, "body_segments_required");
    const read = (segments: unknown, field: "segments" | "designSegments", reason: DesignReason) => {
        try {
            const aligned = readBilingualSegments({ segments });
            if (!aligned) throw Error("missing segments");
            return aligned;
        } catch { throw new ProductPlanDesignError(`${path}.${field}`, reason); }
    };
    const body = read(input.segments, "segments", "body_segments_invalid");
    const design = read(input.designSegments, "designSegments", "design_segments_invalid");
    if (body.chinese.length + design.chinese.length + 2 > 100_000 || body.english.length + design.english.length + 2 > 100_000
        || (body.alignment?.length || 0) + (design.alignment?.length || 0) > 400)
        throw new ProductPlanDesignError(`${path}.designSegments`, "design_segments_invalid");
    const chineseOffset = body.chinese.length + 2, englishOffset = body.english.length + 2;
    // 只在落卡前拼接一次，用户编辑后与生图执行共用同一份完整正文。
    const prompt: AlignedBilingualText = {
        chinese: `${body.chinese}\n\n${design.chinese}`,
        english: `${body.english}\n\n${design.english}`,
        alignment: [...(body.alignment || []), ...(design.alignment || []).map(([a, b, c, d]) =>
            [a + chineseOffset, b + chineseOffset, c + englishOffset, d + englishOffset] as [number, number, number, number])],
    };
    return { prompt, copyLayout: design.chinese };
}
