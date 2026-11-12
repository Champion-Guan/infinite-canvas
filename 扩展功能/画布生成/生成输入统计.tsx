import type { CSSProperties } from "react";
import { Tooltip } from "antd";
import { generationInputCountLabel, generationInputDetail, type GenerationInputCounts, type GenerationInputSummary } from "./生成输入规则";

export function GenerationInputChips({ summary, labels, style }: {
    summary: GenerationInputSummary; labels: Record<keyof GenerationInputCounts, string>; style: CSSProperties;
}) {
    const detail = generationInputDetail(summary);
    return <div className="contents" role="group" aria-label={summary.variants?.length ? `生成输入 · ${summary.variants.length} 个变体分别提交` : "生成输入"}>
        {(Object.keys(labels) as Array<keyof GenerationInputCounts>).map(key => {
            const value = generationInputCountLabel(summary, key);
            const chip = <div tabIndex={detail ? 0 : undefined} aria-label={`${labels[key]} ${value}`}
                className="inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[11px] focus-visible:outline-2 focus-visible:outline-offset-1" style={style}>
                <span>{labels[key]}</span><span className="font-medium">{value}</span>
            </div>;
            return detail ? <Tooltip key={key} trigger={["hover", "focus"]} title={<span className="whitespace-pre-wrap break-words">{detail}</span>}>{chip}</Tooltip>
                : <div key={key} className="contents">{chip}</div>;
        })}
    </div>;
}
