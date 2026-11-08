import { useState } from "react";
import { App, Button, Skeleton, Switch, type SwitchProps } from "antd";
import { OutsideSelect as Select } from "@/扩展功能/主题/原生可关闭浮层";
import { useVersionCheck } from "@/hooks/use-version-check";
import { formatDisplayVersion } from "@/constant/env";
import { updateMessages, updateRequest, type UpdatePreferences } from "./软件更新客户端";
import { OnlineInstallActions } from "./在线安装操作";

// 读取前没有开关状态；以等尺寸占位代替假默认值，真实值到达后首次挂载。
function UpdatePreferenceSwitch({ value, ...props }: Omit<SwitchProps, "checked" | "defaultChecked" | "defaultValue">) {
    if (typeof value !== "boolean") return <span aria-hidden="true"
        data-update-preference-placeholder className="inline-flex h-[22px] w-11 shrink-0">
        <Skeleton.Button active={false} shape="round" style={{ width: 44, minWidth: 44, height: 22 }} />
    </span>;
    return <Switch {...props} checked={value} />;
}

export function ConfigSoftwareUpdates({ active = true }: { active?: boolean }) {
    const { message } = App.useApp();
    const { status, refresh, unavailable, currentVersion, checking, checkLatestRelease } = useVersionCheck(active);
    const [saving, setSaving] = useState(false);
    const save = async (input: Partial<UpdatePreferences>) => {
        setSaving(true);
        try {
            await updateRequest("preferences", input);
            await refresh();
            if (input.developerMode !== undefined) await checkLatestRelease();
            message.success("软件更新设置已保存");
        }
        catch (e) { message.error(e instanceof Error ? e.message : "更新设置未保存"); }
        finally { setSaving(false); }
    };
    const prefs = status?.preferences;
    const downloading = ["verifying-manifest", "downloading"].includes(status?.download.state || "");
    const managed = Boolean(status?.install.allowed);
    const channelBusy = status?.install.staging || ["prepared", "stopping", "switching", "starting", "restarting-manager", "rolling-back"].includes(status?.install.state || "");
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
            <div className="flex flex-wrap items-center gap-5" aria-busy={!prefs} role={prefs ? undefined : "status"} aria-label={prefs ? undefined : "正在读取更新设置"}>
                <label className="flex items-center gap-2"><UpdatePreferenceSwitch aria-label="自动检查更新" value={prefs?.autoCheck} disabled={!prefs || saving} onChange={autoCheck => void save({ autoCheck })} />自动检查（启动及每 6 小时）</label>
                <label className="flex items-center gap-2"><UpdatePreferenceSwitch aria-label="自动下载更新" value={prefs?.autoDownload} disabled={!prefs || saving} onChange={autoDownload => void save({ autoDownload })} />自动下载（仅可信签名包）</label>
                <label className="flex items-center gap-2"><UpdatePreferenceSwitch aria-label="自动安装更新" value={prefs?.autoInstall} disabled={!prefs || !managed || saving} onChange={autoInstall => void save({ autoInstall })} />空闲时自动安装</label>
                <label className="flex items-center gap-2" title="开启后接收 Beta 和 Stable；关闭后仅接收 Stable"><UpdatePreferenceSwitch aria-label="开发者模式" value={prefs?.developerMode} disabled={!prefs || saving || checking || Boolean(channelBusy)} onChange={developerMode => void save({ developerMode })} />开发者模式</label>
            </div>
            <div className="flex items-center gap-3"><span>更新网络</span><Select aria-label="更新网络" className="min-w-44" value={prefs?.network} placeholder="正在读取…" disabled={!prefs || saving} options={[{ value: "auto", label: "自动（有代理则使用代理）" }, { value: "direct", label: "直连" }, { value: "proxy", label: "本地代理" }]} onChange={network => void save({ network })} /></div>
            <OnlineInstallActions active={active} status={status} refresh={refresh} leadingActions={<>
                <Button loading={checking} onClick={() => void checkLatestRelease(true)}>检查更新</Button>
                <Button disabled={!status?.hasNewVersion || status?.download.state === "trust-not-configured" || status?.download.state === "verified" || downloading} onClick={() => void download()}>{status?.download.state === "verified" ? "已下载并验证" : "下载更新"}</Button>
            </>} />
            <div role="status">{status ? updateMessages[status.state] || status.state : unavailable ? "本机更新服务不可用，请刷新页面后重试" : "本机更新服务读取中"}{status?.error ? `：${updateMessages[status.error] || "检查未完成，原版本保留"}` : ""}</div>

            {status?.latest ? <div className="whitespace-pre-wrap break-words"><div>发布时间：{new Date(status.latest.publishedAt).toLocaleString()}</div>{status.latest.notes || "暂无更新说明"}</div> : null}
            <div><div className="mb-2 font-medium">更新检查记录（最近 5 次，非安装记录）</div>{status?.history.slice(-5).reverse().map((entry, index) => <div key={`${entry.at}-${index}`} className="text-xs leading-6">{new Date(entry.at).toLocaleString()} · {entry.version || "—"} · {updateMessages[entry.error || entry.state] || "检查未完成"}</div>)}</div>
        </section>
    );
}
