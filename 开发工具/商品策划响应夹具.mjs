// 旧全文夹具仍用于兼容检查；模拟新策划请求时补齐v2的独立设计片段。
export function designProtocolPlan(value) {
    const plan = structuredClone(value);
    plan.protocolVersion = 'product-image-plan.v2';
    for (const image of plan.images) {
        const convert = pair => pair.designSegments ? pair : {
            ...pair,
            segments: pair.segments || [{ chinese: pair.chinese, english: pair.english }],
            designSegments: [{ chinese: image.copyLayout, english: 'Keep the planned typography legible and the actual product unobstructed.' }],
        };
        image.prompt = convert(image.prompt);
        image.variants = Object.fromEntries(Object.entries(image.variants || {}).map(([id, pair]) => [id, convert(pair)]));
    }
    return plan;
}
