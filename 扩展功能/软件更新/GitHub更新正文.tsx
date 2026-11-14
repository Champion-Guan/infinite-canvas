import { lazy, Suspense } from "react";
import type { Components } from "streamdown";
import { Tag } from "antd";

const Markdown = lazy(() => import("streamdown").then(module => ({ default: module.Streamdown })));
const allowedElements = ["h1", "h2", "h3", "h4", "h5", "h6", "p", "ul", "ol", "li", "strong", "em", "del", "a", "code", "pre", "blockquote", "hr", "table", "thead", "tbody", "tr", "th", "td", "br"];
const bodyElements = allowedElements.filter(element => element !== "h1");
const badgeStyle = { display: "inline-flex", alignItems: "center", height: 22, lineHeight: "20px", margin: 0 } as const;
const components: Components = {
    h1: ({ children }) => <h1 className="mb-3 text-base font-semibold leading-6 text-stone-950 dark:text-stone-100">{children}</h1>,
    h2: ({ children }) => <h2 className="mb-2 mt-4 text-sm font-semibold leading-[22px] text-stone-950 dark:text-stone-100">{children}</h2>,
    h3: ({ children }) => <h3 className="mb-1 mt-3 text-[13px] font-semibold leading-[22px]">{children}</h3>,
    p: ({ children }) => <p className="my-2">{children}</p>,
    strong: ({ children }) => <strong className="font-medium">{children}</strong>,
    ul: ({ children }) => <ul className="my-2 list-outside list-disc space-y-1 pl-5">{children}</ul>,
    ol: ({ children }) => <ol className="my-2 list-outside list-decimal space-y-1 pl-5">{children}</ol>,
    li: ({ children }) => <li>{children}</li>,
};

export function GitHubReleaseNotes({ notes, publishedAt, version, currentVersion }: { notes: string; publishedAt?: string; version?: string; currentVersion?: string }) {
    return <section aria-label="本版更新说明" className="min-w-0" style={{ fontFamily: "inherit", letterSpacing: 0 }}>
        {version ? <header className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="text-base font-semibold text-stone-950 dark:text-stone-100" style={{ margin: 0, lineHeight: "22px" }}>AI-Workbench v{version.replace(/^v/, "")}</h1>
            {publishedAt ? <time dateTime={publishedAt} className="text-xs text-stone-500 dark:text-stone-400" style={{ lineHeight: "22px" }}>{publishedAt.slice(0, 10)}</time> : null}
            <div className="flex items-center gap-1.5">
                <Tag color="green" style={badgeStyle}>最新</Tag>
                {version.replace(/^v/, "") === currentVersion?.replace(/^v/, "") ? <Tag style={badgeStyle}>当前</Tag> : null}
            </div>
        </header> : null}
        <Suspense fallback={<p role="status">正在加载更新说明…</p>}>
            <Markdown mode="static" skipHtml allowedElements={version ? bodyElements : allowedElements} components={components} controls={false}
                className="min-w-0 break-words text-[13px] leading-[22px] text-stone-700 dark:text-stone-300">
                {notes || "暂无更新说明"}
            </Markdown>
        </Suspense>
    </section>;
}
