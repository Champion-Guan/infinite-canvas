import { useEffect, useState } from "react";
import { App, Button, Select, Switch } from "antd";
import { useVersionCheck } from "@/hooks/use-version-check";
import { VersionReleaseModal } from "@/components/layout/version-release-modal";
import { formatDisplayVersion } from "@/constant/env";
import { updateMessages, installationMessages, updateRequest, type UpdatePreferences } from "./软件更新客户端";
import { UpgradeTaskReview } from "./升级任务核实";

export function ConfigSoftwareUpdates() {
    const { message, modal } = App.useApp();
    const { status, refresh, unavailable, currentVersion, checking, checkLatestRelease } = useVersionCheck();
    const [saving, setSaving] = useState(false);
    const [operating, setOperating] = useState(false);
    const save = async (input: Partial<UpdatePreferences>) => {
        setSaving(true);
        try { await updateRequest("preferences", input); await refresh(); message.success("软件更新设置已保存"); }
        catch (e) { message.error(e instanceof Error ? e.message : "更新设置未保存"); }
        finally { setSaving(false); }
    };
    const prefs = status?.preferences;
    const downloading = ["verifying-manifest", "downloading"].includes(status?.download.state || "");
    const staging = Boolean(status?.install.staging);
    const managed = Boolean(status?.install.allowed);
    const waiting = status?.install.state === "awaiting-browser-exit";
    const installing = ["prepared", "stopping", "switching", "starting", "rolling-back"].includes(status?.install.state || "");
    useEffect(() => {
        if (!downloading && !staging && !waiting && !installing) return;
        const timer = setInterval(() => void refresh(), 2000);
        return () => clearInterval(timer);
    }, [downloading, staging, waiting, installing, refresh]);
    const operate = async (operation: "stage" | "approve" | "defer") => {
        setOperating(true);
        try { await updateRequest(operation); await refresh(); }
        catch (e) { message.error(e instanceof Error ? e.message : "更新操作未完成"); throw e; }
        finally { setOperating(false); }
    };
    const approve = () => modal.confirm({ title: "准备安装更新", content: "请确认画布已经保存，所有生成任务已经结束。确认后请关闭工作台页面，安装器会备份数据并再次核实任务，其他网站可以继续使用。",
        okText: "已保存，任务已结束", cancelText: "暂不安装", onOk: () => operate("approve") });
    const download = async () => {
        try { await updateRequest("download"); await refresh(); }
        catch (e) { message.error(e instanceof Error ? e.message : "下载未开始"); }
    };
    return (
        <section data-guan-updates-panel className="space-y-4 text-sm text-stone-700 dark:text-stone-200">
            <div className="grid grid-cols-2 gap-3">
                <div>当前版本：{formatDisplayVersion(currentVersion)}</div><div>当前渠道最新版本：{formatDisplayVersion(status?.latest?.version || "")}</div>
                <div>更新渠道：{status?.channel || "GitHub Public / Stable"}</div><div>上次检查：{status?.lastCheckedAt ? new Date(status.lastCheckedAt).toLocaleString() : "尚未检查"}</div>
            </div>
            <div className="flex flex-wrap items-center gap-5">
                <label className="flex items-center gap-2"><Switch aria-label="自动检查更新" checked={prefs?.autoCheck ?? true} disabled={!prefs || saving} onChange={autoCheck => void save({ autoCheck })} />自动检查（启动及每 6 小时）</label>
                <label className="flex items-center gap-2"><Switch aria-label="自动下载更新" checked={prefs?.autoDownload ?? true} disabled={!prefs || saving} onChange={autoDownload => void save({ autoDownload })} />自动下载（仅可信签名包）</label>
                <label className="flex items-center gap-2"><Switch aria-label="自动安装更新" checked={prefs?.autoInstall ?? false} disabled={!managed || saving} onChange={autoInstall => void save({ autoInstall })} />确认并关闭页面后安装</label>
            </div>
            <div className="flex items-center gap-3"><span>更新网络</span><Select aria-label="更新网络" className="min-w-44" value={prefs?.network || "auto"} disabled={!prefs || saving} options={[{ value: "auto", label: "自动（有代理则使用代理）" }, { value: "direct", label: "直连" }, { value: "proxy", label: "本地代理" }]} onChange={network => void save({ network })} /></div>
            <div className="flex items-center gap-3"><Button loading={checking} onClick={() => void checkLatestRelease(true)}>检查更新</Button><Button disabled={!status?.hasNewVersion || status?.download.state === "trust-not-configured" || status?.download.state === "verified" || downloading} onClick={() => void download()}>下载更新</Button><VersionReleaseModal label="更新日志" /></div>
            <div className="flex items-center gap-3"><Button loading={staging} disabled={!managed || status?.download.state !== "verified" || staging || waiting || installing || operating} onClick={() => void operate("stage").catch(() => {})}>暂存更新</Button><span className="text-xs text-stone-500 dark:text-stone-400">仅解包复核，不启动新版本或修改个人数据</span></div>
            <div data-guan-updates-confirmation className="flex items-center gap-3"><Button disabled={!managed || !prefs?.autoInstall || operating || !(status?.install.canApprove ?? status?.install.state === "staged")} onClick={approve}>确认并准备安装</Button><Button disabled={!managed || !waiting || operating} onClick={() => void operate("defer").catch(() => {})}>稍后安装</Button></div>
            <UpgradeTaskReview blockers={status?.install.blockers || []} refresh={refresh} />
            <div role="status">{status ? updateMessages[status.state] || status.state : unavailable ? "本机更新服务不可用，请刷新页面后重试" : "本机更新服务读取中"}{status?.error ? `：${updateMessages[status.error] || "检查未完成，原版本保留"}` : ""}</div>
            <div role="status" className="text-xs text-stone-500 dark:text-stone-400">下载：{updateMessages[status?.download.state || "idle"] || "下载未完成"} · {status?.download.progress || 0}%{status?.download.error ? ` · ${updateMessages[status.download.error] || "下载未完成"}` : ""}。{managed ? "下载后需暂存并确认，关闭工作台页面后安装。" : "源码开发模式只检查及下载可信签名包；客户安装版支持升级。"}</div>
            <div role="status" className="text-xs text-stone-500 dark:text-stone-400">安装：{installationMessages[status?.install.state || "disabled"] || "状态尚未确认"}{status?.install.currentVersion ? ` · 受控版本 ${status.install.currentVersion}` : ""}{status?.install.targetVersion ? ` · 目标版本 ${status.install.targetVersion}` : ""}{status?.install.reason ? ` · ${updateMessages[status.install.reason] || "安装安全条件尚未满足"}` : ""}{status?.install.stageError ? ` · ${updateMessages[status.install.stageError] || "暂存未完成，原版本保留"}` : ""}</div>
            {status?.latest ? <div className="whitespace-pre-wrap break-words"><div>发布时间：{new Date(status.latest.publishedAt).toLocaleString()}</div>{status.latest.notes || "暂无更新说明"}</div> : null}
            <div><div className="mb-2 font-medium">更新检查记录（最近 30 次，非安装记录）</div>{status?.history.slice().reverse().map((entry, index) => <div key={`${entry.at}-${index}`} className="text-xs leading-6">{new Date(entry.at).toLocaleString()} · {entry.version || "—"} · {updateMessages[entry.error || entry.state] || "检查未完成"}</div>)}</div>
        </section>
    );
}
