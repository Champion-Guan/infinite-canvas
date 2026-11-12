import { ParameterImageThumbnail } from "./参数图片预览";
import { MediaThumbnail } from "../媒体交付/媒体缩略图";
import { projectImageReferences, type ImageReferenceLabel } from "./图片引用标签规则";

export function ImageReferenceToken({ image, label }: { image?: ImageReferenceLabel; label: string }) {
    if (!image) return <span className="rounded bg-amber-400/15 text-amber-700 dark:text-amber-300">{label}</span>;
    return <ParameterImageThumbnail image={image} name={label.replace(/\u2003/g, "")} hoverPreview
        className="rounded bg-sky-500/10 text-sky-800 outline-offset-1 hover:bg-sky-500/20 focus-visible:outline-2 dark:text-sky-200"
        style={{ display: "inline", padding: 0, border: 0, font: "inherit", lineHeight: "inherit", color: "inherit", verticalAlign: "baseline", pointerEvents: "auto", whiteSpace: "pre-wrap" }}>
        {label}
        <MediaThumbnail storageKey={image.storageKey} fallback={image.url} alt=""
            className="object-cover" style={{ position: "absolute", width: ".85em", height: ".85em", left: "1.075em", top: "50%", transform: "translateY(-50%)" }} />
    </ParameterImageThumbnail>;
}
export function ImageReferenceText({ text, images }: { text: string; images: ImageReferenceLabel[] }) {
    const view = projectImageReferences(text, images);
    let cursor = 0;
    return <>{view.occurrences.flatMap((item, index) => {
        const before = view.text.slice(cursor, item.start); cursor = item.end;
        return [before, <ImageReferenceToken key={index} image={item.image} label={item.label} />];
    })}{view.text.slice(cursor)}</>;
}
