import { useEffect, useLayoutEffect, useRef } from "react";
import { Tooltip } from "antd";
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
    ctx.updateNodeMetadata(parameter.id, {
        productVariants: variants.map(variant => selected.has(variant.id) ? { ...variant, enabled } : variant),
    } as ProductVariantMetadata);
}

export function applyPromptVariantSelectionBatch(ctx: CanvasNodeContext, parameterId: string, updates: ReadonlyMap<string, boolean>) {
    const parameter = ctx.getNode(parameterId);
    if (!parameter || parameter.type !== "guan:prompt-variables") return;
    const variants = productVariants(parameter.metadata);
    let changed = false;
    const next = variants.map(variant => {
        const enabled = updates.get(variant.id);
        if (enabled === undefined || variant.enabled === enabled) return variant;
        changed = true;
        return { ...variant, enabled };
    });
    if (changed) ctx.updateNodeMetadata(parameter.id, { productVariants: next } as ProductVariantMetadata);
}

export function mergePromptVariantSelection(updates: Map<string, boolean>, ids: readonly string[], enabled: boolean) {
    for (const id of ids) updates.set(id, enabled);
}

type QueueSelection = (ids: readonly string[], enabled: boolean, source?: HTMLInputElement) => void;

function syncPromptVariantSelectAll(source: HTMLInputElement) {
    if (typeof source.closest !== "function") return;
    const card = source.closest<HTMLElement>('[data-product-prompt-card]');
    if (!card) return;
    const inputs = Array.from(card.querySelectorAll<HTMLInputElement>('[data-prompt-variant-id] input[type="checkbox"]:not(:disabled)'));
    const selectAll = card.querySelector<HTMLInputElement>('input[aria-label="全选提示词变体"]');
    if (!selectAll || !inputs.length) return;
    const selected = inputs.filter(input => input.checked).length;
    selectAll.checked = selected === inputs.length;
    selectAll.indeterminate = selected > 0 && selected < inputs.length;
}

export function usePromptVariantSelectionQueue(ctx: CanvasNodeContext, parameterId: string | undefined): QueueSelection {
    const latest = useRef(ctx);
    latest.current = ctx;
    const pending = useRef(new Map<string, Map<string, boolean>>());
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const flush = () => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = null;
        if (!pending.current.size) return;
        const updates = pending.current;
        pending.current = new Map();
        for (const [id, values] of updates) applyPromptVariantSelectionBatch(latest.current, id, values);
    };
    const flushRef = useRef(flush);
    flushRef.current = flush;
    useEffect(() => () => flushRef.current(), []);
    return (ids: readonly string[], enabled: boolean, source?: HTMLInputElement) => {
        if (!parameterId) return;
        if (source) syncPromptVariantSelectAll(source);
        const values = pending.current.get(parameterId) ?? new Map<string, boolean>();
        mergePromptVariantSelection(values, ids, enabled);
        pending.current.set(parameterId, values);
        if (timer.current !== null) clearTimeout(timer.current);
        timer.current = setTimeout(() => flushRef.current(), 50);
    };
}

function VariantCheckbox({ checked, mixed = false, label, disabled, onChange }: {
    checked: boolean; mixed?: boolean; label: string; disabled?: boolean; onChange(checked: boolean, input?: HTMLInputElement): void;
}) {
    const input = useRef<HTMLInputElement>(null);
    useLayoutEffect(() => {
        if (!input.current) return;
        input.current.checked = checked;
        input.current.indeterminate = mixed;
    }, [checked, mixed]);
    return <input ref={input} type="checkbox" className={styles.checkbox} aria-label={label}
        disabled={disabled} defaultChecked={checked} onChange={event => onChange(event.currentTarget.checked, event.currentTarget)} />;
}

type SelectionProps = { ctx: CanvasNodeContext; parameterId: string; ids: string[]; queueSelection: QueueSelection };

export function PromptVariantSelectAll({ ctx, parameterId, ids, queueSelection }: SelectionProps) {
    const variants = productVariants(ctx.getNode(parameterId)?.metadata).filter(variant => ids.includes(variant.id));
    const selected = variants.filter(variant => variant.enabled).length;
    if (!variants.length) return null;
    return <Tooltip title="与产品参数卡同步；取消勾选的变体不参与批量生成，仍可单独生成">
        <span className="inline-flex shrink-0 cursor-default" onPointerDown={event => event.stopPropagation()} onMouseDown={event => event.stopPropagation()}>
            <label className={styles.selectAll}><VariantCheckbox label="全选提示词变体" checked={selected === variants.length} mixed={selected > 0 && selected < variants.length}
                onChange={(checked, input) => {
                    const card = input?.closest('[data-product-prompt-card]');
                    card?.querySelectorAll<HTMLInputElement>('[data-prompt-variant-id] input[type="checkbox"]:not(:disabled)').forEach(item => {
                        item.checked = checked;
                    });
                    if (input) syncPromptVariantSelectAll(input);
                    queueSelection(ids, checked, input);
                }} />全选</label>
        </span>
    </Tooltip>;
}

export function PromptVariantTabs({ ctx, parameterId, ids, value, onChange, queueSelection }: SelectionProps & {
    value?: string; onChange(id: string): void;
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
                <VariantCheckbox label={`生成变体 ${name}`} disabled={!variant} checked={Boolean(variant?.enabled)}
                    onChange={(checked, input) => queueSelection([id], checked, input)} />
                <button type="button" role="tab" aria-selected={value === id} tabIndex={value === id ? 0 : -1}
                    title={value === id ? "点击勾选或取消生成此变体" : "查看此变体提示词"}
                    onClick={event => {
                        center(id);
                        if (value !== id) { onChange(id); return; }
                        const input = event?.currentTarget.parentElement?.querySelector<HTMLInputElement>("input[type='checkbox']");
                        const current = input ? input.checked : Boolean(productVariants(ctx.getNode(parameterId)?.metadata).find(item => item.id === id)?.enabled);
                        const next = !current;
                        if (input) input.checked = next;
                        queueSelection([id], next, input || undefined);
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
                    className={styles.label}>{name}</button>
            </div>;
        })}
    </div>;
}
