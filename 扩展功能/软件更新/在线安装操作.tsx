import { useEffect, useState } from "react";
import { App, Button } from "antd";
import { updateRequest, type SoftwareUpdateStatus } from "./软件更新客户端";
import { useProductActive } from "../产品/产品界面边界";
import { connectUpdateProgressWindow } from "./独立进度窗口";
import { UpdateProgressPanel } from "./更新进度面板";

type Props = { status: SoftwareUpdateStatus | null; refresh: () => Promise<void> };

// 设置与版本弹窗共用入口；版本切换始终由独立管理器在页面退出后执行。
export function OnlineInstallActions({ status, refresh }: Props) {
    const productActive = useProductActive();
    const { message, modal } = App.useApp();
    const [operating, setOperating] = useState(false);
    const install = status?.install;
    const managed = Boolean(install?.allowed);
    const waiting = install?.state === "awaiting-browser-exit";
    const switching = ["prepared", "stopping", "switching", "starting", "rolling-back"].includes(install?.state || "");
    const canApprove = managed && Boolean(install?.canApprove ?? install?.state === "staged");
    const staging = Boolean(install?.staging);
    const downloading = ["verifying-manifest", "downloading"].includes(status?.download.state || "");
    useEffect(() => {
        if (!productActive || (!downloading && !staging && !waiting && !switching)) return;
        const visibleRefresh = () => { if (document.visibilityState === "visible") void refresh(); };
        const timer = setInterval(visibleRefresh, 2000);
        document.addEventListener("visibilitychange", visibleRefresh);
        return () => { clearInterval(timer); document.removeEventListener("visibilitychange", visibleRefresh); };
    }, [productActive, downloading, staging, waiting, switching, refresh]);
    const operate = async (operation: "stage" | "approve-manual" | "defer") => {
        setOperating(true);
        try { await updateRequest(operation); await refresh(); }
        catch (error) { message.error(error instanceof Error ? error.message : "安装操作未完成"); throw error; }
        finally { setOperating(false); }
    };
    const openProgress = () => {
        const popup = window.open("about:blank", "guan-web-update-progress", "popup,width=740,height=700");
        return connectUpdateProgressWindow(popup).then(() => popup);
    };
    const approve = () => modal.confirm({ title: "在线安装更新", content: "请确认画布已经保存，所有生成任务已经结束。确认后会打开独立进度窗口，请保留进度窗口并关闭所有工作台页面。安装器会再次核实保存与任务状态，再切换到新版本；其他网站可以继续使用。自动安装开关不会因本次手动安装而改变。",
        okText: "已保存，任务已结束，安装本次更新", cancelText: "暂不安装", onOk: async () => {
            try { await openProgress(); }
            catch (error) { message.error(error instanceof Error ? error.message : "进度窗口未能启动，本次安装尚未确认"); throw error; }
            // 确认请求失败也保留观察页，避免响应中断时丢失已开始安装的进度。
            await operate("approve-manual");
        } });
    const reason = !status ? "正在读取安装状态" : install?.state === "source-development" ? "当前为源码开发版，只检查和下载；在线安装请通过“启动工作台.command”打开客户安装版。"
        : !managed ? "独立安装管理器尚未就绪，请通过“启动工作台.command”重新打开客户安装版。"
        : waiting ? "已确认，等待关闭所有工作台页面；请保留独立进度窗口，完成后可从进度窗口返回工作台。"
        : canApprove ? "安装包已暂存并再次验签，请确认后安装。"
        : staging ? "正在解包并再次验证签名和全部文件，请稍候。"
        : status.download.state === "verified" ? "已下载并验证，点击安装更新进行暂存复核。"
        : "下载并验签完成后即可安装。";
    return <div data-guan-online-install className="space-y-2">
        <UpdateProgressPanel status={status} />
        <div className="flex flex-wrap items-center gap-3">
            <Button type="primary" loading={operating || staging} disabled={!managed || staging || operating || waiting || switching || (!canApprove && status?.download.state !== "verified")}
                onClick={() => canApprove ? approve() : void operate("stage").catch(() => {})}>{canApprove ? "确认并安装" : "安装更新"}</Button>
            {waiting ? <Button disabled={operating} onClick={() => void operate("defer").catch(() => {})}>稍后安装</Button> : null}
            {managed && (canApprove || waiting || switching) ? <Button disabled={operating} onClick={() => void openProgress().catch(error => message.error(error instanceof Error ? error.message : "进度窗口未能打开"))}>查看安装进度</Button> : null}
        </div>
        <div role="status" className="text-xs leading-5 text-stone-500 dark:text-stone-400">{reason}</div>
    </div>;
}
