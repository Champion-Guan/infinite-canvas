import { useEffect, useMemo } from "react";
import { Braces } from "lucide-react";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasNodeContext } from "@/types/canvas-plugin";
import { promptVariableTokens, completePromptVariableValues, variableLabel, productVariableTokens } from "./旧版参数规则";
import { useExcelProductId, useExcelPromptContext } from "./Excel画布上下文";
import { restoreProductParameterValues } from "./Excel参数记忆";
import { useProductParameterEditing } from "./产品参数编辑操作";

export function PromptVariablesContent({ ctx }: { ctx: CanvasNodeContext }) {
    const productId = useExcelProductId();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const context = useExcelPromptContext(productId);
    const metadata = ctx.node.metadata || {};
    const linkedPromptNode = metadata.promptVariableSourceNodeId ? ctx.getNode(metadata.promptVariableSourceNodeId) : null;
    const linkedPrompt = linkedPromptNode ? String(linkedPromptNode.metadata?.content || linkedPromptNode.metadata?.prompt || "").trim() : "";
    const currentPrompt = linkedPrompt || metadata.promptVariableRawPrompt || "";
    const productTokens = useMemo(() => productVariableTokens(context), [context]);
    const linkedTokens = ctx.getNodes().filter((node) => node.metadata?.excelPromptBindingNodeId === ctx.node.id && !node.metadata?.promptVariablePreviewOf)
        .flatMap((node) => promptVariableTokens(node.metadata?.excelPromptRaw || node.metadata?.content || node.metadata?.prompt || ""));
    const tokens = Array.from(new Set([...(productTokens || []), ...(metadata.promptVariableTokens || []), ...linkedTokens, ...promptVariableTokens(currentPrompt)]));
    const values = metadata.promptVariableValues || {};

    useEffect(() => {
        const current = ctx.getNode(ctx.node.id)?.metadata?.promptVariableValues || {};
        const restored = restoreProductParameterValues(productId, current);
        if (Object.keys(restored).some((token) => restored[token] !== current[token])) {
            ctx.updateMetadata({ promptVariableValues: restored });
        }
    }, [ctx.node.id, productId]);

    useEffect(() => {
        if (!tokens.length) return;
        const nextValues = completePromptVariableValues(tokens, values);
        if (tokens.some((token) => values[token] === undefined)) ctx.updateMetadata({ promptVariableTokens: tokens, promptVariableValues: nextValues });
    }, [ctx, tokens, values]);

    const { updateValue, updateSupplement } = useProductParameterEditing(ctx, productId, tokens);

    return (
        <div
            data-canvas-no-zoom
            className="flex h-full w-full min-h-0 flex-col overflow-hidden rounded-[inherit] p-3 text-sm"
            style={{ color: theme.node.text }}
            onMouseDown={(event) => { if ((event.target as HTMLElement).closest("input, textarea, select, button")) event.stopPropagation(); }}
            onPointerDown={(event) => { if ((event.target as HTMLElement).closest("input, textarea, select, button")) event.stopPropagation(); }}
            onWheel={(event) => event.stopPropagation()}
        >
            <div className="mb-2 flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                    <span className="grid size-8 shrink-0 place-items-center rounded-lg" style={{ background: theme.toolbar.itemHover, color: theme.toolbar.activeText }}><Braces className="size-4" /></span>
                    <div className="min-w-0">
                        <div className="truncate text-sm font-semibold">产品参数设置</div>
                        <div className="truncate text-[11px] opacity-60">{metadata.promptVariableProductName || context.activeProductName || "当前 Excel 产品"}</div>
                    </div>
                </div>
            </div>

            <div className="thin-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
            {!tokens.length ? (
                <div className="rounded-xl border px-4 py-3 text-center text-xs opacity-65" style={{ borderColor: theme.node.stroke }}>
                    {context.templates.length ? "当前提示词没有可填写的变量" : "请先上传 Excel 并识别提示词"}
                </div>
            ) : (
                <div className="space-y-2">
                    {tokens.map((token) => (
                        <label key={token} className="block text-[11px] text-black dark:text-white">
                            <span className="mb-1 block truncate" title={token}>{variableLabel(token)}</span>
                            <input value={values[token] || ""} onChange={(event) => updateValue(token, event.target.value)} onClick={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()} className="h-8 w-full rounded-lg border bg-transparent px-2 text-xs outline-none transition focus:border-stone-700 focus:ring-2 focus:ring-stone-300/70 dark:focus:border-stone-200 dark:focus:ring-stone-500/50" style={{ borderColor: theme.node.stroke, color: theme.node.text }} placeholder={token} />
                        </label>
                    ))}
                </div>
            )}
            <label className="block text-[11px]">
                <span className="mb-1 block font-medium">提示词补充</span>
                <textarea aria-label="提示词补充" value={metadata.promptVariableSupplement || ""} onChange={(event) => updateSupplement(event.target.value)} rows={4}
                    className="min-h-24 w-full resize-y rounded-lg border bg-transparent px-2 py-2 text-xs outline-none focus:ring-2 focus:ring-stone-300/70 dark:focus:ring-stone-500/50"
                    style={{ borderColor: theme.node.stroke, color: theme.node.text }} placeholder="输入任意补充内容，将追加到所有连线提示词的末尾" />
                <span className="mt-1 block text-[10px] opacity-55">仅应用于本参数卡连接的提示词；清空即可取消补充。</span>
            </label>

            </div>
            <div className="mt-2 truncate text-[10px] opacity-55">{context.fileName || "未识别 Excel"} · {tokens.length} 个变量 · 连接提示词卡片后生成最终提示词</div>
        </div>
    );
}
