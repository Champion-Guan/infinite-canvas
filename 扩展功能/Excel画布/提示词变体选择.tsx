import { useLayoutEffect, useRef } from "react";
import { Checkbox, Tooltip } from "antd";
import type { CanvasNodeContext } from "@/types/canvas-plugin";
import { productVariants, variantLabel, type ProductVariantMetadata } from "./产品变体规则";
import styles from "./提示词变体选择.module.css";
import { useCapsuleMouseDrag } from "../产品/胶囊鼠标拖动";

export function centerPromptVariant(container: HTMLElement, item: HTMLElement, reduced = false) {
    const viewport = container.getBoundingClientRect(), target = item.getBoundingClientRect();
    if (!viewport.width || !container.offsetWidth) return;
    const scale = viewport.width / container.offsetWidth;
    const offset = container.scrollLeft + (target.left + target.width / 2 - viewport.left - viewport.width / 2) / scale;
    const left = Math.max(0, Math.min(container.scrollWidth - container.clientWidth, offset));
    if (Math.abs(left - container.scrollLeft) > 0.5) container.scrollTo({ left, behavior: reduced ? "instant" : "smooth" });
}

export function updatePromptVariantSelection(ctx: CanvasNodeContext, parameterId: string, ids: readonly string[], enabled: boolean) {
    const parameter = ctx.getNode(parameterId);
    if (!parameter || parameter.type !== "guan:prompt-variables") return;
    const selected = new Set(ids), variants = productVariants(parameter.metadata);
    if (!variants.some(variant => selected.has(variant.id) && variant.enabled !== enabled)) return;
    ctx.applyOps([{ type: "update_node", id: parameter.id, metadata: {
        productVariants: variants.map(variant => selected.has(variant.id) ? { ...variant, enabled } : variant),
    } as ProductVariantMetadata }]);
}

export function PromptVariantSelectAll({ ctx, parameterId, ids }: { ctx: CanvasNodeContext; parameterId: string; ids: string[] }) {
    const variants = productVariants(ctx.getNode(parameterId)?.metadata).filter(variant => ids.includes(variant.id));
    const selected = variants.filter(variant => variant.enabled).length;
    if (!variants.length) return null;
    return <Tooltip title="与产品参数卡同步；取消勾选的变体不参与批量生成，仍可单独生成">
        <span className={`${styles.selection} inline-flex shrink-0 cursor-default`} onPointerDown={event => event.stopPropagation()} onMouseDown={event => event.stopPropagation()}>
            <Checkbox aria-label="全选提示词变体" checked={selected === variants.length} indeterminate={selected > 0 && selected < variants.length}
                onChange={event => updatePromptVariantSelection(ctx, parameterId, ids, event.target.checked)}>全选</Checkbox>
        </span>
    </Tooltip>;
}

export function PromptVariantTabs({ ctx, parameterId, ids, value, onChange }: {
    ctx: CanvasNodeContext; parameterId: string; ids: string[]; value?: string; onChange(id: string): void;
}) {
    const navigation = useRef<HTMLDivElement>(null);
    useCapsuleMouseDrag(navigation, ctx.node.id);
    const center = (id: string) => {
        const container = navigation.current;
        const item = container && Array.from(container.children).find(element => (element as HTMLElement).dataset.promptVariantId === id);
        if (container && item) centerPromptVariant(container, item as HTMLElement,
            window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true);
    };
    const order = ids.join("\n");
    useLayoutEffect(() => {
        const container = navigation.current;
        if (!container) return;
        const item = Array.from(container.children).find(element => (element as HTMLElement).dataset.promptVariantId === value) as HTMLElement | undefined;
        if (!item) return;
        const reveal = () => centerPromptVariant(container, item, window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true);
        reveal();
        if (typeof ResizeObserver === "undefined") return;
        const observer = new ResizeObserver(reveal);
        observer.observe(container); observer.observe(item);
        return () => observer.disconnect();
    }, [value, order, ctx.node.id]);
    const variants = productVariants(ctx.getNode(parameterId)?.metadata);
    return <div ref={navigation} className={`${styles.tabs} guan-scroll-region thin-scrollbar`} role="tablist" aria-label="提示词变体"
        onPointerDown={event => event.stopPropagation()} onMouseDown={event => event.stopPropagation()}
        onDoubleClick={event => event.stopPropagation()}>
        {ids.map(id => {
            const variant = variants.find(item => item.id === id);
            const name = variant ? variantLabel(variant) : id;
            return <div key={id} data-prompt-variant-id={id} className={`${styles.tab} ${value === id ? styles.active : ""}`}>
                <Checkbox aria-label={`生成变体 ${name}`} disabled={!variant} checked={Boolean(variant?.enabled)}
                    onChange={event => { center(id); updatePromptVariantSelection(ctx, parameterId, [id], event.target.checked); }} />
                <button type="button" role="tab" aria-selected={value === id} tabIndex={value === id ? 0 : -1}
                    title={value === id ? "点击勾选或取消生成此变体" : "查看此变体提示词"}
                    onClick={() => {
                        center(id);
                        if (value !== id) { onChange(id); return; }
                        const current = productVariants(ctx.getNode(parameterId)?.metadata).find(item => item.id === id);
                        if (current) updatePromptVariantSelection(ctx, parameterId, [id], !current.enabled);
                    }}
                    onKeyDown={event => {
                        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                        event.preventDefault();
                        const index = event.key === "Home" ? 0 : event.key === "End" ? ids.length - 1
                            : (ids.indexOf(id) + (event.key === "ArrowRight" ? 1 : -1) + ids.length) % ids.length;
                        onChange(ids[index]);
                        center(ids[index]);
                        event.currentTarget.closest('[role="tablist"]')?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[index]?.focus({ preventScroll: true });
                    }}
                    className={styles.label} style={{ opacity: variant?.enabled ? 1 : 0.5 }}>{name}</button>
            </div>;
        })}
    </div>;
}
