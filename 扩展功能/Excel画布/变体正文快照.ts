import type { CanvasNodeMetadata } from "@/types/canvas";
import type { ProductVariantMetadata } from "./产品变体规则";

// 勾选只改变生成范围；正文缓存仍在任何资料、图片、顺序或名称变化时失效。
export function variantContentSnapshot(previous: CanvasNodeMetadata | undefined, current: CanvasNodeMetadata | undefined) {
    if (previous === current || !previous || !current) return current;
    const before = previous as ProductVariantMetadata, next = current as ProductVariantMetadata;
    for (const key of new Set([...Object.keys(before), ...Object.keys(next)])) {
        if (key !== "productVariants" && before[key as keyof CanvasNodeMetadata] !== next[key as keyof CanvasNodeMetadata]) return current;
    }
    const a = before.productVariants || [], b = next.productVariants || [];
    if (a.length !== b.length) return current;
    for (let index = 0; index < a.length; index++) {
        if (a[index] === b[index]) continue;
        for (const key of new Set([...Object.keys(a[index]), ...Object.keys(b[index])])) {
            if (key !== "enabled" && a[index][key as keyof typeof a[number]] !== b[index][key as keyof typeof b[number]]) return current;
        }
    }
    return previous;
}
