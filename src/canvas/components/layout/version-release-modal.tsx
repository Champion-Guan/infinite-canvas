import type { CSSProperties } from "react";
import { Button, Modal, Progress, Tag, Timeline } from "antd";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { useVersionCheck } from "@/hooks/use-version-check";
import { updateMessages, installationMessages } from "@/services/software-updates";
import { useSoftwareUpdateActions } from "@/hooks/use-software-update-actions";

function getTagColor(type: string) {
    if (type === "新增" || type === "Added") return "green";
    if (type === "修复" || type === "Fixed") return "red";
    if (type === "调整" || type === "Changed") return "blue";
    if (type === "文档" || type === "Docs") return "purple";
    return "default";
}

function releaseTypeLabel(type: string, t: TFunction) {
    const key = ({ 新增: "added", 修复: "fixed", 调整: "changed", 优化: "optimized", 文档: "docs" } as Record<string, string>)[type];
    return key ? t(`version.types.${key}`) : type;
}

type VersionReleaseModalProps = {
    className?: string;
    style?: CSSProperties;
    label?: string;
};

export function VersionReleaseModal({ className, style, label }: VersionReleaseModalProps) {
    const { t } = useTranslation();
    const { open, setOpen, openReleaseModal, currentVersion, latestVersion, releases, checking, hasNewVersion, checkLatestRelease, status, refresh } = useVersionCheck();
    const actions = useSoftwareUpdateActions(status, refresh, open);

    return (
        <>
            <button
                type="button"
                className={className || "shrink-0 cursor-pointer text-xs font-medium text-stone-500 transition hover:text-stone-950 dark:text-stone-400 dark:hover:text-white"}
                style={style}
                onClick={openReleaseModal}
                title={t("version.viewUpdates")}
                aria-label={`版本 ${currentVersion}，查看更新日志`}
            >
                <span className="relative inline-flex">
                    {label || currentVersion}
                    {hasNewVersion ? <span className="absolute -right-1.5 -top-1 size-1.5 rounded-full bg-green-500" /> : null}
                </span>
            </button>
            <Modal title={t("version.title")} open={open} width={680} centered footer={null} onCancel={() => setOpen(false)}>
                <div className="guan-motion-pop">
                    <div data-guan-updates-summary className="mb-3 text-xs text-stone-500 dark:text-stone-400">{status?.channel || "GitHub Public / Stable"} · {status ? updateMessages[status.error || status.state] || "检查未完成" : "本机更新服务未连接"}</div>
                <div className="mb-5 grid grid-cols-2 gap-3">
                    <div className="rounded-lg border border-stone-200 p-3 dark:border-stone-800">
                        <div className="text-xs text-stone-500 dark:text-stone-400">{t("version.currentVersion")}</div>
                        <div className="mt-1 text-base font-semibold text-stone-950 dark:text-stone-100">{currentVersion}</div>
                    </div>
                    <div className="rounded-lg border border-stone-200 p-3 dark:border-stone-800">
                        <div className="flex items-center justify-between gap-3">
                            <div className="text-xs text-stone-500 dark:text-stone-400">{t("version.latestVersion")}</div>
                            <button
                                type="button"
                                className="cursor-pointer bg-transparent p-0 text-[11px] font-normal text-stone-400 underline-offset-2 transition hover:text-stone-700 hover:underline dark:text-stone-500 dark:hover:text-stone-300"
                                onClick={() => void checkLatestRelease(true)}
                                disabled={checking}
                            >
                                {t(checking ? "version.checking" : "version.checkUpdates")}
                            </button>
                        </div>
                        <div className="mt-1 text-base font-semibold text-stone-950 dark:text-stone-100">{latestVersion}</div>
                    </div>
                </div>
                <div data-guan-version-update-actions className="guan-update-timeline mb-5 space-y-2">
                    <div className="flex flex-wrap gap-2">
                        <Button loading={actions.downloading} disabled={!status?.hasNewVersion || actions.busy || actions.staging || status.download.state === "verified" || status.download.state === "trust-not-configured"} onClick={() => void actions.download()}>下载更新</Button>
                        <Button type="primary" disabled={!actions.canInstall || actions.busy || status?.install.state === "awaiting-browser-exit"} onClick={actions.approve}>安装更新</Button>
                        {status?.install.state === "awaiting-browser-exit" ? <Button disabled={actions.busy} onClick={() => void actions.defer()}>稍后安装</Button> : null}
                    </div>
                    {actions.downloading ? <Progress percent={status?.download.progress || 0} size="small" /> : null}
                    <div role="status" className="text-xs leading-5 text-stone-600 dark:text-stone-300">
                        下载：{updateMessages[status?.download.error || status?.download.state || "idle"] || "下载未完成"} · 安装：{installationMessages[status?.install.state || "unavailable"] || "状态尚未确认"}
                        {status?.install.reason || status?.install.stageError ? <div>{updateMessages[status.install.stageError || status.install.reason || ""] || "安装条件尚未满足，原版本保留"}</div> : null}
                    </div>
                    <div className="text-xs leading-5 text-stone-500 dark:text-stone-400">仅安装验签通过的稳定版。安装前请保存信息并关闭工作台页面；其他网站和应用无需退出。</div>
                    {status?.latest?.publishedAt ? <div className="text-xs text-stone-500 dark:text-stone-400">发布时间：{new Date(status.latest.publishedAt).toLocaleString()}</div> : null}
                </div>
                <div className="max-h-[56vh] overflow-y-auto pr-2">
                    <Timeline
                        items={releases.map((release) => ({
                            content: (
                                <div>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="text-sm font-semibold text-stone-950 dark:text-stone-100">{release.version === "Unreleased" ? t("version.unreleased") : release.version}</span>
                                        <span className="text-xs text-stone-500 dark:text-stone-400">{release.date}</span>
                                        <div className="flex min-w-0 items-center gap-1.5">
                                            {release.version === latestVersion ? <Tag color="green">{t("version.latest")}</Tag> : null}
                                            {release.version === currentVersion ? <Tag>{t("version.current")}</Tag> : null}
                                        </div>
                                    </div>
                                    <div className="mt-2 space-y-1.5">
                                        {release.items.map((item, index) => (
                                            <div key={`${release.version}-${index}`} className="flex items-start gap-2 text-sm leading-6 text-stone-700 dark:text-stone-300">
                                                <Tag color={getTagColor(item.type)} className="m-0 mt-0.5 shrink-0 whitespace-nowrap">
                                                    {releaseTypeLabel(item.type, t)}
                                                </Tag>
                                                <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{item.content}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ),
                        }))}
                    />
                </div>
                </div>
            </Modal>
        </>
    );
}
