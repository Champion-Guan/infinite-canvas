import type { CSSProperties } from "react";
import { OutsideTooltip } from "../主题/原生可关闭浮层";
import { generationInputCountLabel, type GenerationInputCounts, type GenerationInputSummary } from "./生成输入规则";

const columns: Array<[keyof GenerationInputCounts, string]> = [
    ["textCount", "提示词"], ["imageCount", "参考图"], ["videoCount", "视频"], ["audioCount", "音频"],
];

export function GenerationInputDetails({ summary, showImages }: { summary: GenerationInputSummary; showImages: boolean }) {
    return <div data-canvas-no-zoom data-canvas-shortcuts-ignore style={{ width: "min(340px, calc(100vw - 48px))" }}
        onPointerDown={event => event.stopPropagation()} onMouseDown={event => event.stopPropagation()} onWheel={event => event.stopPropagation()}>
        <div className="mb-2 flex items-center justify-between gap-3 text-xs font-medium">
            <span>生成输入明细</span>{summary.variants?.length ? <span className="shrink-0 font-normal opacity-60">{summary.variants.length} 个变体</span> : null}
        </div>
        {summary.error ? <p role="alert" className="max-h-40 overflow-y-auto break-words text-xs">{summary.error}</p>
            : <div tabIndex={0} aria-label="变体输入明细" className="thin-scrollbar overflow-y-auto overscroll-contain rounded border border-current/10"
                style={{ maxHeight: "min(320px, 50dvh)" }}>
                <table className="w-full table-fixed border-collapse text-left text-xs leading-5">
                    <colgroup><col />{columns.map(([key]) => <col key={key} style={{ width: 44 }} />)}</colgroup>
                    <thead className="sticky top-0 z-10 bg-[#1f1f1f]">
                        <tr><th scope="col" className="px-2 py-1.5 font-medium">变体</th>
                            {columns.map(([key, label]) => <th scope="col" key={key} className="py-1.5 text-center font-medium">{label}</th>)}
                        </tr>
                    </thead>
                    <tbody>{summary.variants?.flatMap(variant => [
                        <tr key={variant.id} className="border-t border-current/10">
                            <th scope="row" className="break-words px-2 py-1.5 font-medium [overflow-wrap:anywhere]">{variant.name}</th>
                            {columns.map(([key]) => <td key={key} className="py-1.5 text-center tabular-nums">{variant[key]}</td>)}
                        </tr>,
                        ...(showImages && variant.images.length ? [<tr key={`${variant.id}:images`}>
                            <td colSpan={5} className="px-2 pb-2 text-[11px] opacity-65">
                                <ul className="space-y-0.5 [overflow-wrap:anywhere]">{variant.images.map((name, index) => <li key={index}>{name}</li>)}</ul>
                            </td>
                        </tr>] : []),
                    ])}</tbody>
                </table>
            </div>}
    </div>;
}

export function GenerationInputChips({ summary, labels, style }: {
    summary: GenerationInputSummary; labels: Record<keyof GenerationInputCounts, string>; style: CSSProperties;
}) {
    const detail = Boolean(summary.error || summary.variants?.length);
    return <div className="contents" role="group" aria-label={summary.variants?.length ? `生成输入 · ${summary.variants.length} 个变体分别提交` : "生成输入"}>
        {(Object.keys(labels) as Array<keyof GenerationInputCounts>).map(key => {
            const value = generationInputCountLabel(summary, key);
            const chip = <div tabIndex={detail ? 0 : undefined} aria-label={`${labels[key]} ${value}`}
                className="inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[11px] focus-visible:outline-2 focus-visible:outline-offset-1" style={style}>
                <span>{labels[key]}</span><span className="font-medium">{value}</span>
            </div>;
            return detail ? <OutsideTooltip key={key} trigger={["hover", "focus"]} placement="topLeft"
                title={<GenerationInputDetails summary={summary} showImages={key === "imageCount"} />}
                styles={{ root: { maxWidth: "calc(100vw - 24px)" }, container: { padding: 12 } }}>{chip}</OutsideTooltip>
                : <div key={key} className="contents">{chip}</div>;
        })}
    </div>;
}
