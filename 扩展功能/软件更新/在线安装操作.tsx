import { useEffect, useState, type ReactNode } from "react";
import { App, Button } from "antd";
import { updateMessages, updateRequest, type SoftwareUpdateStatus } from "./软件更新客户端";
import { useProductActive } from "../产品/产品界面边界";
import { connectUpdateProgressWindow } from "./独立进度窗口";
import { UpdateProgressPanel } from "./更新进度面板";

type Props = { status: SoftwareUpdateStatus | null; refresh: () => Promise<void>; leadingActions?: ReactNode };

// 设置与版本弹窗共用入口；版本切换始终由独立管理器在页面退出后执行。
export function OnlineInstallActions({ status, refresh, leadingActions }: Props) {
    const productActive = useProductActive();
    const { message } = App.useApp();
    const [operating, setOperating] = useState(false);
    const install = status?.install;
    const managed = Boolean(install?.allowed);
    const waiting = install?.state === "awaiting-browser-exit";
    const switching = ["prepared", "stopping", "switching", "starting", "restarting-manager", "rolling-back"].includes(install?.state || "");
    const canApprove = managed && Boolean(install?.canApprove ?? install?.state === "staged");
    const staging = Boolean(install?.staging);
    const coordination = install?.coordination;
    const queued = Boolean(coordination?.mode && coordination.state !== "blocked");
    const downloading = ["verifying-manifest", "downloading"].includes(status?.download.state || "");
    useEffect(() => {
        if (!productActive || (!downloading && !staging && !waiting && !switching && !queued)) return;
        const visibleRefresh = () => { if (document.visibilityState === "visible") void refresh(); };
        const timer = setInterval(visibleRefresh, 2000);
        document.addEventListener("visibilitychange", visibleRefresh);
        return () => { clearInterval(timer); document.removeEventListener("visibilitychange", visibleRefresh); };
    }, [productActive, downloading, staging, waiting, switching, queued, refresh]);
    const operate = async (operation: "install" | "defer") => {
        setOperating(true);
        try {
            await updateRequest(operation); await refresh();
            window.dispatchEvent(new Event("guan:update-requested"));
        }
        catch (error) { message.error(error instanceof Error ? error.message : "安装操作未完成"); throw error; }
        finally { setOperating(false); }
    };
    const openProgress = () => {
        const popup = window.open("about:blank", "guan-web-update-progress", "popup,width=740,height=700");
        return connectUpdateProgressWindow(popup).then(url => ({ popup, url }));
    };
    const reason = !status ? "正在读取安装状态" : install?.state === "source-development" ? "当前为源码开发版，只检查和下载；在线安装请通过“启动工作台.command”打开客户安装版。"
        : !managed ? "独立安装管理器尚未就绪，请通过“启动工作台.command”重新打开客户安装版。"
        : install?.reason === "update_channel_excluded" ? updateMessages.update_channel_excluded
        : waiting ? "正在自动保存并准备安装。若有旧版工作台页面未退出，请保存后关闭该页面。"
        : coordination?.reason ? updateMessages[coordination.reason] || "更新暂未完成，当前工作台继续可用"
        : coordination?.state === "preparing" ? "正在自动保存全部画布，随后安装更新。"
        : canApprove ? "更新已准备就绪，可立即安装或在空闲时自动安装。"
        : staging ? "正在解包并再次验证签名和全部文件，请稍候。"
        : status.download.state === "verified" ? "已下载并验证，点击安装更新进行暂存复核。"
        : "下载并验签完成后即可安装。";
    return <div data-guan-online-install className="space-y-2">
        {leadingActions ? null : <UpdateProgressPanel status={status} />}
        <div role="group" aria-label="软件更新操作" className="flex flex-wrap items-center gap-3">
            {leadingActions}
            <Button type="primary" loading={operating || staging} disabled={!managed || staging || operating || waiting || switching || queued || (!canApprove && status?.download.state !== "verified")}
                onClick={() => void operate("install").catch(() => {})}>{queued ? "等待自动安装" : coordination?.state === "blocked" ? "重试安装" : "安装更新"}</Button>
            {waiting || queued ? <Button disabled={operating} onClick={() => void operate("defer").catch(() => {})}>稍后安装</Button> : null}
            {managed && (canApprove || waiting || switching) ? <Button disabled={operating} onClick={() => void openProgress().catch(error => message.error(error instanceof Error ? error.message : "进度窗口未能打开"))}>查看安装进度</Button> : null}
        </div>
        {leadingActions ? <UpdateProgressPanel status={status} /> : null}
        <div role="status" className="text-xs leading-5 text-stone-500 dark:text-stone-400">{reason}</div>
    </div>;
}
