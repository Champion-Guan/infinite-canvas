import { useEffect, useRef, useState } from "react";
import { App } from "antd";
import { LoaderCircle, Play } from "lucide-react";
import type { CanvasNodeContext } from "@/types/canvas-plugin";
import { getGenerationCount } from "@/lib/canvas/canvas-generation-helpers";
import { useEffectiveConfig } from "@/stores/use-config-store";
import { AppleAntButton } from "../主题/苹果交互按钮";
import { generateSingleProductVariant } from "../画布生成/单变体生成";
import { pulseProductPromptWarning } from "./商品提示词阻止反馈";
import { productVariants, variantLabel } from "./产品变体规则";
import { promptDocument } from "./商品提示词规则";
import { productVariantConfigNode } from "./共用商品提示词";
import { updatePromptVariantSelection } from "./提示词变体选择";

export function ProductVariantGenerateButton({ ctx, productId, variantId }: {
    ctx: CanvasNodeContext; productId: string; variantId?: string;
}) {
    const { message } = App.useApp();
    const effectiveConfig = useEffectiveConfig();
    const busy = useRef(false), mounted = useRef(false);
    const [generating, setGenerating] = useState<string | null>(null);
    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
    }, []);
    const doc = promptDocument(ctx.node), parameter = doc && ctx.getNode(doc.parameterId);
    const variant = productVariants(parameter?.metadata).find(item => item.id === variantId);
    const name = variant ? variantLabel(variant) : doc?.variantName || "当前图片";
    const configIds = new Set(ctx.getConnections().filter(edge => edge.fromNodeId === ctx.node.id).map(edge => edge.toNodeId));
    const configs = [...configIds].map(id => ctx.getNode(id)).filter(node => node?.type === "config"
        && (node.metadata?.generationMode || "image") === "image");
    const config = configs.length === 1 ? productVariantConfigNode(configs[0]!, variantId) : undefined;
    const count = config ? getGenerationCount(String(config.metadata?.count || effectiveConfig.canvasImageCount || effectiveConfig.count || 1)) : undefined;
    const countLabel = count === undefined ? "" : ` · 共 ${count} 张`;
    const start = async () => {
        if (busy.current) return;
        busy.current = true; setGenerating(name + countLabel);
        try {
            await generateSingleProductVariant(productId, { promptNodeId: ctx.node.id, variantId,
                onSubmitted: () => {
                    const id = variantId || doc?.variantId;
                    if (doc && id) updatePromptVariantSelection(ctx, doc.parameterId, [id], false);
                },
            });
        }
        catch (error) {
            if (!pulseProductPromptWarning(error)) message.error(error instanceof Error ? error.message : "生成未开始，请重试。");
        } finally {
            busy.current = false;
            if (mounted.current) setGenerating(null);
        }
    };
    return <div data-product-variant-generate={ctx.node.id} data-canvas-no-zoom
            className="mt-2 shrink-0 border-t border-current/10 pt-2"
            onPointerDown={event => event.stopPropagation()} onMouseDown={event => event.stopPropagation()}
            onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}>
            <AppleAntButton type="primary" disabled={generating !== null} aria-busy={generating !== null}
                aria-label={`仅生成${name}`} title={`仅生成${name}，使用已连接的生图配置`}
                onClick={() => void start()} className="!h-9 !w-full !rounded-lg shadow-md">
                <span className="inline-flex min-w-0 max-w-full items-center gap-1.5">
                    {generating !== null ? <LoaderCircle aria-hidden className="size-4 shrink-0 animate-spin motion-reduce:animate-none" />
                        : <Play aria-hidden className="size-4 shrink-0" />}
                    <span className="truncate">{generating !== null ? `正在生成 · ${generating}` : `生成 · ${name}${countLabel}`}</span>
                </span>
            </AppleAntButton>
        </div>;
}
