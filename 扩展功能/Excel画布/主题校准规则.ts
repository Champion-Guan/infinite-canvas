import type { CanvasNodeData } from "@/types/canvas";

export function themeCalibrationInput(nodes: CanvasNodeData[], parameterId: string) {
    return nodes.filter(node => node.metadata?.excelPromptBindingNodeId === parameterId && !node.metadata?.promptVariablePreviewOf).slice(0, 12)
        .map(node => {
            const source = String(node.metadata?.content ?? node.metadata?.excelPromptRaw ?? "");
            return { id: node.id, prompt: source.slice(0, 6000), source };
        });
}

export function themeCalibrationOps(answer: string, input: ReturnType<typeof themeCalibrationInput>, current: CanvasNodeData[], parameterId: string) {
    const results: unknown = JSON.parse(answer.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
    if (!Array.isArray(results) || results.length > 12) throw Error("主题分析返回格式不正确，原数据已保留");
    const labels = new Map<string, string>();
    for (const item of results) {
        if (!item || typeof item.id !== "string" || typeof item.theme !== "string" || !item.theme.trim() || item.theme.length > 40 || !input.some(node => node.id === item.id) || labels.has(item.id)) throw Error("主题分析未通过校验，原数据已保留");
        labels.set(item.id, item.theme.trim());
    }
    return input.filter(source => labels.has(source.id) && current.some(node => node.id === source.id && node.metadata?.excelPromptBindingNodeId === parameterId && String(node.metadata?.content ?? node.metadata?.excelPromptRaw ?? "") === source.source))
        .map(source => ({ type: "update_node" as const, id: source.id, metadata: { excelPromptTheme: labels.get(source.id)! } }));
}
