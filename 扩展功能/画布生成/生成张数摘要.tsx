import { variantImageCountText, type VariantImageCount } from "./生成张数规则";

export function VariantImageCountSummary({ summary }: { summary: VariantImageCount }) {
    return <div role="status" aria-live="polite" className="space-y-1 text-xs leading-5">
        <p className="font-medium">{variantImageCountText(summary)}</p>
        {summary.perVariant === null && !summary.error ? <p className="break-words opacity-65">
            {summary.variants.map(variant => `${variant.name} ${variant.count} 张`).join("、")}
        </p> : null}
    </div>;
}
