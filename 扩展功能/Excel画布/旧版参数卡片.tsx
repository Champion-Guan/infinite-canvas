import { useEffect, useMemo, useRef } from "react";
import { Braces } from "lucide-react";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasNodeContext } from "@/types/canvas-plugin";
import type { CanvasNodeMetadata } from "@/types/canvas";
import { promptVariableTokens, completePromptVariableValues, variableLabel, productVariableTokens, productPlatformChangePatch, defaultProductLanguage, PRODUCT_LANGUAGE_OPTIONS, PRODUCT_PLATFORM_OPTIONS, WILDBERRIES_LANGUAGE, WILDBERRIES_PLATFORM } from "./旧版参数规则";
import { useExcelProductId, useExcelPromptContext } from "./Excel画布上下文";
import { restoreProductParameterValues } from "./Excel参数记忆";
import { useProductParameterEditing } from "./产品参数编辑操作";
import { ProductBriefForm } from "./产品资料表单";
import type { ProductParameterMetadata } from "./旧版参数规则";
import { ProductMainImageUploader } from "./产品主图上传";
import { ProductOptionSelect } from "./产品选项下拉";
import { ProductVariantEditor } from "./产品变体编辑";
import { productVariants } from "./产品变体规则";
import { ProductPlanningButton, ProductPlanOverview } from "./商品策划按钮";
import { ProductPlanningStreamPreview } from "./商品策划流式预览";
import { ProductPlatformRuleEditor } from "./平台规则编辑";
import { useGlobalPlatformRules } from "./平台规则订阅";

type ProductCardMetadata = ProductParameterMetadata;

export function PromptVariablesContent({ ctx }: { ctx: CanvasNodeContext }) {
    const productId = useExcelProductId();
    useGlobalPlatformRules();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const context = useExcelPromptContext(productId);
    const metadata = ctx.node.metadata || {};
    const cardMetadata = metadata as ProductCardMetadata;
    const linkedPromptNode = metadata.promptVariableSourceNodeId ? ctx.getNode(metadata.promptVariableSourceNodeId) : null;
    const linkedPrompt = linkedPromptNode ? String(linkedPromptNode.metadata?.content || linkedPromptNode.metadata?.prompt || "").trim() : "";
    const currentPrompt = linkedPrompt || metadata.promptVariableRawPrompt || "";
    const productTokens = useMemo(() => productVariableTokens(context), [context]);
    const linkedTokens = ctx.getNodes().filter((node) => node.metadata?.excelPromptBindingNodeId === ctx.node.id && !node.metadata?.promptVariablePreviewOf)
        .flatMap((node) => promptVariableTokens(node.metadata?.excelPromptRaw || node.metadata?.content || node.metadata?.prompt || ""));
    const tokens = Array.from(new Set([...(productTokens || []), ...(metadata.promptVariableTokens || []), ...linkedTokens, ...promptVariableTokens(currentPrompt)]));
    const values = useMemo(() => metadata.promptVariableValues || {}, [metadata.promptVariableValues]);
    const initialized = useRef<{ nodeId: string; productId: string } | null>(null);

    const { updateValue, updateSupplement, updateBrief, updateMetadata } = useProductParameterEditing(ctx, productId, tokens);
    const platform = cardMetadata.productPlatform || WILDBERRIES_PLATFORM;
    const language = cardMetadata.productLanguage ?? defaultProductLanguage(platform);

    useEffect(() => {
        const node = ctx.getNode(ctx.node.id);
        if (!node) return;
        const current = node.metadata?.promptVariableValues || {};
        const firstMount = initialized.current?.nodeId !== ctx.node.id || initialized.current.productId !== productId;
        const restored = firstMount ? restoreProductParameterValues(productId, current) : current;
        initialized.current = { nodeId: ctx.node.id, productId };
        const missing = tokens.some((token) => restored[token] === undefined);
        if (missing || Object.keys(restored).some((token) => restored[token] !== current[token])) {
            // 记忆恢复与空变量补齐在同一次更新中提交，避免后一个effect用旧空值覆盖记忆。
            ctx.updateMetadata({ promptVariableTokens: tokens, promptVariableValues: missing ? completePromptVariableValues(tokens, restored) : restored });
        }
    }, [ctx, productId, tokens]);

    useEffect(() => {
        const platform = cardMetadata.productPlatform || WILDBERRIES_PLATFORM;
        const language = cardMetadata.productLanguage ?? defaultProductLanguage(platform);
        const patch: ProductCardMetadata = {};
        if (cardMetadata.productPlatform !== platform) patch.productPlatform = platform;
        if (cardMetadata.productLanguage !== language) patch.productLanguage = language;
        if (Object.keys(patch).length) updateMetadata(patch);
    }, [cardMetadata.productLanguage, cardMetadata.productPlatform, updateMetadata]);

    const selectPlatform = (platform: string) => {
        const current = ctx.getNode(ctx.node.id)?.metadata as ProductParameterMetadata | undefined;
        if (!current || (current.productPlatform || WILDBERRIES_PLATFORM) === platform) return;
        updateMetadata(productPlatformChangePatch(current, platform));
    };

    return (
        <div
            data-canvas-no-zoom
            className="flex h-full w-full min-h-0 flex-col overflow-hidden rounded-[inherit] p-3 text-sm"
            style={{ color: theme.node.text }}
            onMouseDown={(event) => { if ((event.target as HTMLElement).closest("input, textarea, select, button, [data-card-panel-anchor]")) event.stopPropagation(); }}
            onPointerDown={(event) => { if ((event.target as HTMLElement).closest("input, textarea, select, button, [data-card-panel-anchor]")) event.stopPropagation(); }}
            onWheel={(event) => event.stopPropagation()}
        >
            <div className="mb-2 flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                    <span className="grid size-8 shrink-0 place-items-center rounded-lg" style={{ background: theme.toolbar.itemHover, color: theme.toolbar.activeText }}><Braces className="size-4" /></span>
                    <div className="min-w-0">
                        <div className="truncate text-sm font-semibold">产品参数设置</div>
                        <div className="truncate text-[11px] opacity-60">{metadata.promptVariableProductName || cardMetadata.productBrief?.nameCategory || context.activeProductName || "当前产品"}</div>
                    </div>
                </div>
                <ProductPlanningButton ctx={ctx} productId={productId} />
            </div>

            <div className="guan-scroll-region thin-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
            <section className="space-y-2 rounded-xl border p-2.5" style={{ borderColor: theme.node.stroke }}>
                <div className="grid grid-cols-2 gap-2">
                    <div className="block text-[11px]">
                        <span className="mb-1 block font-medium">上架平台</span>
                        <ProductOptionSelect value={platform} options={PRODUCT_PLATFORM_OPTIONS} onChange={selectPlatform} borderColor={theme.node.stroke} textColor={theme.node.text} label="上架平台" />
                    </div>
                    <div className="block text-[11px]">
                        <span className="mb-1 block font-medium">语言</span>
                        <ProductOptionSelect value={language === "俄语" ? WILDBERRIES_LANGUAGE : language} options={PRODUCT_LANGUAGE_OPTIONS} onChange={value => updateMetadata({ productLanguage: value } as CanvasNodeMetadata)} borderColor={theme.node.stroke} textColor={theme.node.text} label="语言" />
                    </div>
                </div>
                <ProductPlatformRuleEditor key={`${ctx.node.id}:${platform}`} ctx={ctx} />
            </section>
            <ProductPlanningStreamPreview node={ctx.node} />
            <ProductPlanOverview metadata={cardMetadata} ctx={ctx} productId={productId} />
            <ProductMainImageUploader ctx={ctx} productId={productId} />
            <ProductVariantEditor ctx={ctx} onChange={updateMetadata} tokens={tokens} />
            {!tokens.length ? (
                <ProductBriefForm values={cardMetadata.productBrief} platform={platform} borderColor={theme.node.stroke} textColor={theme.node.text} shared={productVariants(metadata).length > 0} onChange={updateBrief} />
            ) : (
                <div className="space-y-2">
                    {productVariants(metadata).length ? <h3 className="text-xs font-semibold">共用 Excel 变量</h3> : null}
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
                    className="guan-scroll-field min-h-24 w-full resize-y rounded-lg border bg-transparent px-2 py-2 text-xs outline-none focus:ring-2 focus:ring-stone-300/70 dark:focus:ring-stone-500/50"
                    style={{ borderColor: theme.node.stroke, color: theme.node.text }} placeholder="输入任意补充内容，将追加到所有连线提示词的末尾" />
                <span className="mt-1 block text-[10px] opacity-55">仅应用于本参数卡连接的提示词；清空即可取消补充。</span>
            </label>

            </div>
            <div className="mt-2 truncate text-[10px] opacity-55">{context.fileName || "未识别 Excel"} · {tokens.length} 个变量{tokens.length ? " · 连接提示词卡片后生成最终提示词" : ""}</div>
        </div>
    );
}
