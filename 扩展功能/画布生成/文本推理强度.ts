export const TEXT_REASONING_EFFORTS = ["none", "low", "medium", "high", "xhigh", "max"] as const;
export type TextReasoningEffort = typeof TEXT_REASONING_EFFORTS[number];
export const STANDARD_TEXT_REASONING_EFFORTS: readonly TextReasoningEffort[] = ["low", "medium", "high", "xhigh"];
const MAX_TEXT_REASONING_EFFORTS: readonly TextReasoningEffort[] = ["low", "medium", "high", "xhigh", "max"];
const MODEL_TEXT_REASONING_EFFORTS = new Map<string, readonly TextReasoningEffort[]>([
    ["gpt-6-astra", MAX_TEXT_REASONING_EFFORTS],
    ["gpt-6.1-sol", MAX_TEXT_REASONING_EFFORTS],
    ["gpt-6.1-terra", TEXT_REASONING_EFFORTS],
    ["gpt-6-luna", TEXT_REASONING_EFFORTS],
]);

export function isTextReasoningEffort(value: unknown): value is TextReasoningEffort {
    return typeof value === "string" && (TEXT_REASONING_EFFORTS as readonly string[]).includes(value);
}

// 旧版auto、已移除的ultra及无效偏好按“中”读取，不改写旧任务的请求快照。
export function normalizeTextReasoningEffort(value: unknown): TextReasoningEffort {
    return isTextReasoningEffort(value) ? value : "medium";
}

export function normalizeModelReasoningEfforts(value: unknown): TextReasoningEffort[] | undefined {
    if (!Array.isArray(value)) return undefined;
    return TEXT_REASONING_EFFORTS.filter(effort => value.includes(effort));
}

export function defaultModelTextReasoningEfforts(name: string): readonly TextReasoningEffort[] {
    return MODEL_TEXT_REASONING_EFFORTS.get(name) ?? STANDARD_TEXT_REASONING_EFFORTS;
}

export function modelAllowsTextReasoningEffort(name: string, effort: TextReasoningEffort): boolean {
    const known = MODEL_TEXT_REASONING_EFFORTS.get(name);
    return !known || known.includes(effort);
}

export function modelTextReasoningEffortOptions(selected: string): readonly TextReasoningEffort[] {
    const split = selected.indexOf("::");
    const name = split < 0 ? selected : selected.slice(split + 2);
    return TEXT_REASONING_EFFORTS.filter(effort => effort !== "none" || modelAllowsTextReasoningEffort(name, effort));
}

type ReasoningConfig = { model?: string; textModel?: string; channels?: Array<{
    id: string; models: Array<{ name: string; reasoningEfforts?: readonly TextReasoningEffort[] }>;
}> };
export function modelTextReasoningEfforts(config: ReasoningConfig, selected = config.model || config.textModel || ""): readonly TextReasoningEffort[] {
    const split = selected.indexOf("::");
    const channelId = split < 0 ? undefined : selected.slice(0, split);
    const name = split < 0 ? selected : selected.slice(split + 2);
    const channel = channelId ? config.channels?.find(item => item.id === channelId)
        : config.channels?.find(item => item.models.some(model => model.name === name));
    const declared = channel?.models.find(model => model.name === name)?.reasoningEfforts;
    return declared ? declared.filter(effort => isTextReasoningEffort(effort) && modelAllowsTextReasoningEffort(name, effort))
        : defaultModelTextReasoningEfforts(name);
}

export function requireTextReasoningEffort(value: unknown, supported: readonly TextReasoningEffort[] = STANDARD_TEXT_REASONING_EFFORTS): TextReasoningEffort {
    if (value === "ultra") throw Error("推理强度 Ultra 已移除，请重新选择推理强度。");
    const effort = normalizeTextReasoningEffort(value);
    if (!supported.includes(effort)) throw Error(`当前渠道模型未声明支持推理强度 ${effort}，请调整强度或在渠道设置中核对模型能力。`);
    return effort;
}
