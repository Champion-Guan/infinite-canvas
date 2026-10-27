import type { CanvasNodeData } from "@/types/canvas";
import { resolvePromptVariables, PRODUCT_PROMPT_SUPPLEMENT_SEPARATOR } from "./变量使用规则";

// 在原画布资源读取处使用当前源卡与参数，避免旧预览/旧resolved缓存绕过约束。
// undefined 让图片、视频、音频及其他插件继续走作者原读取逻辑。
export function readProtectedGenerationText(node: CanvasNodeData, nodes: CanvasNodeData[]): string | undefined {
    if (node.type !== "text") return undefined;
    const metadata = node.metadata || {};
    const source = metadata.promptVariablePreviewOf && metadata.promptVariableSourceNodeId
        ? nodes.find(item => item.id === metadata.promptVariableSourceNodeId) : node;
    if (!source) return resolvePromptVariables(String(metadata.content ?? metadata.prompt ?? ""));
    const parameterId = metadata.promptVariablePreviewOf || source.metadata?.excelPromptBindingNodeId;
    const parameter = parameterId ? nodes.find(item => item.id === parameterId && item.type === "guan:prompt-variables") : undefined;
    const raw = String(source.metadata?.content ?? source.metadata?.excelPromptRaw ?? source.metadata?.prompt ?? "");
    return resolvePromptVariables(raw, parameter?.metadata?.promptVariableValues, parameter ? parameter.metadata?.promptVariableSupplement || "" : undefined);
}

// 新发起重试时优先使用仍可追溯的当前变量组装；普通历史任务继续保留原提示词快照。
// 未决任务响应恢复仍由原任务协议处理，不在这里修改已提交的请求。
export function readProtectedRetryPrompt(saved: string | undefined, current: string) {
    if (current.includes("\n\n【变量与画面约束】") || current && (current.includes(PRODUCT_PROMPT_SUPPLEMENT_SEPARATOR) || saved?.includes(PRODUCT_PROMPT_SUPPLEMENT_SEPARATOR))) return current;
    return resolvePromptVariables(saved || current);
}
