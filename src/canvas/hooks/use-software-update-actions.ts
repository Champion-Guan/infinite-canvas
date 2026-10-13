import { useEffect, useState } from "react";
import { App } from "antd";
import { updateRequest, type SoftwareUpdateStatus } from "@/services/software-updates";

export function useSoftwareUpdateActions(status: SoftwareUpdateStatus | null, refresh: () => Promise<void>, active = true) {
    const { message, modal } = App.useApp();
    const [busy, setBusy] = useState(false);
    const downloading = ["verifying-manifest", "downloading"].includes(status?.download.state || "");
    const staging = Boolean(status?.install.staging);
    const canInstall = Boolean(status?.hasNewVersion && status.download.state === "verified" && !staging &&
        !["unavailable", "bootstrap-required", "recovery-required", "activation-required"].includes(status.install.state));
    useEffect(() => {
        if (!active || (!downloading && !staging && status?.install.state !== "awaiting-browser-exit")) return;
        const timer = setInterval(() => void refresh(), 2000);
        return () => clearInterval(timer);
    }, [active, downloading, staging, status?.install.state, refresh]);

    const request = async (operation: "download" | "defer") => {
        if (busy) return;
        setBusy(true);
        try { await updateRequest(operation); await refresh(); }
        catch (e) { message.error(e instanceof Error ? e.message : "更新操作未完成，原版本保留"); }
        finally { setBusy(false); }
    };
    const approve = () => {
        if (!canInstall || busy) return;
        modal.confirm({
            title: `准备安装 ${status?.latest?.version || "此稳定版本"}？`,
            content: "安装会重启工作台。请先保存画布和正在编辑的信息、结束生成任务，然后关闭所有工作台页面。其他网站、浏览器和应用无需退出。确认后启用本次安全安装；页面保持打开时不会安装，此次准备在 30 分钟后失效。",
            okText: "已保存，关闭页面后安装", cancelText: "稍后",
            onOk: async () => {
                setBusy(true);
                try {
                    if (!status?.preferences.autoInstall) await updateRequest("preferences", { autoInstall: true });
                    await updateRequest("approve", { acknowledgement: "saved-and-all-tasks-ended" });
                    await refresh();
                    message.success("已记录本次确认，请关闭所有工作台页面；安装完成后自动打开工作台");
                } catch (e) {
                    await refresh();
                    message.error(e instanceof Error ? e.message : "安装准备未完成，原版本保留");
                    throw e;
                } finally { setBusy(false); }
            },
        });
    };
    return { busy, downloading, staging, canInstall, download: () => request("download"), defer: () => request("defer"), approve };
}
