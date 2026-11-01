import { useEffect, useMemo, useRef, useState } from "react";
import { Braces, Sparkles } from "lucide-react";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasNodeContext } from "@/types/canvas-plugin";
import type { CanvasNodeMetadata } from "@/types/canvas";
import { promptVariableTokens, completePromptVariableValues, variableLabel, productVariableTokens, WILDBERRIES_LANGUAGE, WILDBERRIES_PLATFORM, WILDBERRIES_RULES_TEXT } from "./旧版参数规则";
import { useExcelProductId, useExcelPromptContext } from "./Excel画布上下文";
import { restoreProductParameterValues } from "./Excel参数记忆";
import { useProductParameterEditing } from "./产品参数编辑操作";

type ProductCardMetadata = CanvasNodeMetadata & {
    productPlatform?: string;
    productLanguage?: string;
    productPlatformRules?: string;
    productMainImageStorageKey?: string;
    productMainImageUrl?: string;
    productMainImageWidth?: number;
    productMainImageHeight?: number;
    productMainImageBytes?: number;
    productMainImageMimeType?: string;
};

export function PromptVariablesContent({ ctx }: { ctx: CanvasNodeContext }) {
    const productId = useExcelProductId();
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
    const mainImageInputRef = useRef<HTMLInputElement>(null);
    const [mainImageUrl, setMainImageUrl] = useState(cardMetadata.productMainImageUrl || "");
    const [imageBusy, setImageBusy] = useState(false);
    const [imageError, setImageError] = useState("");

    const { updateValue, updateSupplement, updateMetadata } = useProductParameterEditing(ctx, productId, tokens);

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
        const language = platform === WILDBERRIES_PLATFORM ? WILDBERRIES_LANGUAGE : (cardMetadata.productLanguage || "");
        const rules = platform === WILDBERRIES_PLATFORM ? (cardMetadata.productPlatformRules || WILDBERRIES_RULES_TEXT) : "";
        const patch: ProductCardMetadata = {};
        if (cardMetadata.productPlatform !== platform) patch.productPlatform = platform;
        if (cardMetadata.productLanguage !== language) patch.productLanguage = language;
        if (cardMetadata.productPlatformRules !== rules) patch.productPlatformRules = rules;
        if (Object.keys(patch).length) updateMetadata(patch);
    }, [cardMetadata.productLanguage, cardMetadata.productPlatform, cardMetadata.productPlatformRules, updateMetadata]);

    useEffect(() => {
        let cancelled = false;
        if (!cardMetadata.productMainImageStorageKey) {
            setMainImageUrl(cardMetadata.productMainImageUrl || "");
            return () => { cancelled = true; };
        }
        void import("@/services/image-storage").then(({ resolveImageUrl }) => resolveImageUrl(cardMetadata.productMainImageStorageKey!, cardMetadata.productMainImageUrl || "")).then((url) => {
            if (!cancelled) setMainImageUrl(url);
        });
        return () => { cancelled = true; };
    }, [cardMetadata.productMainImageStorageKey, cardMetadata.productMainImageUrl]);

    const selectPlatform = (platform: string) => {
        const language = platform === WILDBERRIES_PLATFORM ? WILDBERRIES_LANGUAGE : (cardMetadata.productLanguage || "");
        updateMetadata({
            productPlatform: platform,
            productLanguage: language,
            productPlatformRules: platform === WILDBERRIES_PLATFORM ? WILDBERRIES_RULES_TEXT : "",
        } as CanvasNodeMetadata);
    };
    const uploadProductImage = async (file?: File) => {
        if (!file) return;
        setImageBusy(true);
        setImageError("");
        try {
            const { uploadImage } = await import("@/services/image-storage");
            const image = await uploadImage(file, { assetProjectId: productId });
            setMainImageUrl(image.url);
            updateMetadata({
                productMainImageStorageKey: image.storageKey,
                productMainImageUrl: image.url,
                productMainImageWidth: image.width,
                productMainImageHeight: image.height,
                productMainImageBytes: image.bytes,
                productMainImageMimeType: image.mimeType,
            } as CanvasNodeMetadata);
        } catch (error) {
            setImageError(error instanceof Error ? error.message : "产品主图上传失败");
        } finally {
            setImageBusy(false);
        }
    };

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
                <button
                    type="button"
                    disabled
                    title="功能暂未开放"
                    className="inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium opacity-60"
                    style={{ borderColor: theme.node.stroke, color: theme.node.text }}
                >
                    <Sparkles aria-hidden="true" className="size-3.5" />
                    AI写提示词
                </button>
            </div>

            <div className="thin-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
            <section className="space-y-2 rounded-xl border p-2.5" style={{ borderColor: theme.node.stroke }}>
                <div className="grid grid-cols-2 gap-2">
                    <label className="block text-[11px]">
                        <span className="mb-1 block font-medium">上架平台</span>
                        <select value={cardMetadata.productPlatform || WILDBERRIES_PLATFORM} onChange={(event) => selectPlatform(event.target.value)} className="h-8 w-full rounded-lg border bg-transparent px-2 text-xs outline-none" style={{ borderColor: theme.node.stroke, color: theme.node.text }}>
                            <option value={WILDBERRIES_PLATFORM}>Wildberries</option>
                            <option value="Ozon">Ozon</option>
                            <option value="自定义">自定义</option>
                        </select>
                    </label>
                    <label className="block text-[11px]">
                        <span className="mb-1 block font-medium">语言</span>
                        <select value={cardMetadata.productLanguage || (cardMetadata.productPlatform === WILDBERRIES_PLATFORM ? WILDBERRIES_LANGUAGE : "")} disabled={(cardMetadata.productPlatform || WILDBERRIES_PLATFORM) === WILDBERRIES_PLATFORM} onChange={(event) => updateMetadata({ productLanguage: event.target.value } as CanvasNodeMetadata)} className="h-8 w-full rounded-lg border bg-transparent px-2 text-xs outline-none disabled:cursor-not-allowed disabled:opacity-70" style={{ borderColor: theme.node.stroke, color: theme.node.text }}>
                            <option value="">未指定</option>
                            <option value={WILDBERRIES_LANGUAGE}>俄文</option>
                            <option value="中文">中文</option>
                            <option value="英文">英文</option>
                        </select>
                    </label>
                </div>
                {(cardMetadata.productPlatform || WILDBERRIES_PLATFORM) === WILDBERRIES_PLATFORM ? (
                    <div className="whitespace-pre-line rounded-lg bg-black/[.06] px-2.5 py-2 text-[10px] leading-5 opacity-75 dark:bg-white/[.08]">{cardMetadata.productPlatformRules || WILDBERRIES_RULES_TEXT}</div>
                ) : null}
            </section>
            <section className="space-y-2 rounded-xl border p-2.5" style={{ borderColor: theme.node.stroke, background: theme.toolbar.itemHover }}>
                <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-medium">产品主图</span>
                    <button type="button" className="rounded-md border px-2 py-1 text-[11px] transition hover:opacity-80" style={{ borderColor: theme.node.stroke, color: theme.node.text }} onClick={() => mainImageInputRef.current?.click()} disabled={imageBusy}>
                        {imageBusy ? "处理中…" : mainImageUrl ? "更换图片" : "上传图片"}
                    </button>
                    <input ref={mainImageInputRef} type="file" accept="image/*,.heic,.heif" className="hidden" onChange={(event) => { void uploadProductImage(event.target.files?.[0]); event.currentTarget.value = ""; }} />
                </div>
                {mainImageUrl ? (
                    <img src={mainImageUrl} alt="产品主图" className="max-h-40 w-full rounded-lg object-contain" />
                ) : (
                    <div className="grid min-h-20 place-items-center rounded-lg border border-dashed text-[11px] opacity-60" style={{ borderColor: theme.node.stroke }}>上传用户产品图片，作为生成参考</div>
                )}
                {imageError ? <div className="text-[10px] text-red-600 dark:text-red-400">{imageError}</div> : null}
            </section>
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
