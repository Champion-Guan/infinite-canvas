import { Tag, Timeline } from "antd";
import { useTranslation } from "react-i18next";
import { formatDisplayVersion } from "@/constant/env";
import type { ReleaseInfo } from "@/lib/release";

function getTagColor(type: string) {
    if (type === "新增" || type === "Added") return "green";
    if (type === "修复" || type === "Fixed") return "red";
    if (type === "调整" || type === "Changed") return "blue";
    if (type === "文档" || type === "Docs") return "purple";
    return "default";
}

const typeKeys: Record<string, string> = { 新增: "added", 修复: "fixed", 调整: "changed", 优化: "optimized", 文档: "docs" };

export function ReleaseTimeline({ releases, currentVersion, latestVersion }: {
    releases: readonly ReleaseInfo[];
    currentVersion: string;
    latestVersion?: string;
}) {
    const { t } = useTranslation();
    if (!releases.length) return <section aria-label="版本历史" className="min-w-0">
        <p className="text-sm text-stone-500 dark:text-stone-400">当前渠道暂无版本更新记录</p>
    </section>;
    return <section aria-label="版本历史" className="min-w-0">
        <Timeline items={releases.map(release => ({
            key: release.version,
            content: <div>
                <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-stone-950 dark:text-stone-100">
                        {release.version === "Unreleased" ? t("version.unreleased") : formatDisplayVersion(release.version)}
                    </span>
                    <span className="text-xs text-stone-500 dark:text-stone-400">{release.date}</span>
                    <div className="flex min-w-0 items-center gap-1.5">
                        {release.version === latestVersion ? <Tag color="green">{t("version.latest")}</Tag> : null}
                        {release.version.replace(/^v/, "") === currentVersion.replace(/^v/, "") ? <Tag>{t("version.current")}</Tag> : null}
                    </div>
                </div>
                <div className="mt-2 space-y-1.5">
                    {release.items.map((item, index) => <div key={`${release.version}-${index}`}
                        className="flex items-start gap-2 text-sm leading-6 text-stone-700 dark:text-stone-300">
                        <Tag color={getTagColor(item.type)} className="m-0 mt-0.5 shrink-0 whitespace-nowrap">
                            {typeKeys[item.type] ? t(`version.types.${typeKeys[item.type]}`) : item.type}
                        </Tag>
                        <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{item.content}</span>
                    </div>)}
                </div>
            </div>,
        }))} />
    </section>;
}
