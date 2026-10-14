import { useEffect, useState } from "react";
import { App } from "antd";
import { openUpdateProgressWindow, updateRequest, type SoftwareUpdateStatus } from "@/services/software-updates";

export function useSoftwareUpdateActions(status: SoftwareUpdateStatus | null, refresh: () => Promise<void>, active = true) {
    const { message, modal } = App.useApp();
    const [busy, setBusy] = useState(false);
    const downloading = ["verifying-manifest", "downloading"].includes(status?.download.state || "");
    const staging = Boolean(status?.install.staging);
    const migrating = Boolean(status?.install.migrationRequired);
    const canInstall = Boolean(migrating ? status?.install.state === "migration-required" && !status.install.reason
        : status?.hasNewVersion && status.download.state === "verified" && !staging &&
            !["disabled", "unavailable", "bootstrap-required", "recovery-required", "activation-required"].includes(status.install.state));
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
            title: migrating ? "自动迁移工作台到 localhost:3000？" : `准备安装 ${status?.latest?.version || "此稳定版本"}？`,
            content: migrating ? "请先保存画布、结束生成任务，确认后关闭全部工作台页面。更新器会自动备份私人文件及同一 Chrome 配置中的旧地址数据，复制并逐项核验后切换到 3000，完成后自动打开工作台。原数据和备份保留；失败时恢复旧地址。其他网站和应用无需退出。此次确认 30 分钟内有效。"
                : "安装会重启工作台。请先保存画布和正在编辑的信息、结束生成任务，然后关闭所有工作台页面。其他网站、浏览器和应用无需退出。确认后启用本次安全安装；页面保持打开时不会安装，此次准备在 30 分钟后失效。",
            okText: migrating ? "已保存，关闭页面后自动迁移" : "已保存，关闭页面后安装", cancelText: "稍后",
            onOk: async () => {
                // Open synchronously in the user's click gesture, before any await.
                const popup = window.open("about:blank", "_blank", "popup,width=740,height=700");
                if (!popup) {
                    message.error("请允许此网站弹出更新进度窗口，再确认安装");
                    throw Error("请允许此网站弹出更新进度窗口，再确认安装");
                }
                popup.document.title = "AI-Workbench 更新进度";
                popup.document.body.textContent = "正在启动独立更新进度窗口，请稍候…";
                setBusy(true);
                let connected = false;
                try {
                    await openUpdateProgressWindow(popup);
                    connected = true;
                    if (!status?.preferences.autoInstall) await updateRequest("preferences", { autoInstall: true });
                    await updateRequest("approve", { acknowledgement: "saved-and-all-tasks-ended" });
                    await refresh();
                    message.success("请关闭所有工作台页面，在独立进度窗口查看安装结果；此进度窗口可以保持打开");
                } catch (e) {
                    if (!connected) popup.close();
                    await refresh();
                    message.error(e instanceof Error ? e.message : "安装准备未完成，原版本保留");
                    throw e;
                } finally { setBusy(false); }
            },
        });
    };
    return { busy, downloading, staging, canInstall, download: () => request("download"), defer: () => request("defer"), approve };
}
