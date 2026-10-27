import { Progress } from "antd";
import { installationMessages, updateMessages, type SoftwareUpdateStatus } from "./软件更新客户端";

export function UpdateProgressPanel({ status }: { status: SoftwareUpdateStatus | null }) {
    const download = status?.download;
    const install = status?.install;
    const percent = Math.max(0, Math.min(100, download && Number.isFinite(download.progress) ? download.progress : 0));
    const error = download?.error || install?.stageError || (install?.allowed ? install.reason : null);
    const target = install?.targetVersion || (status?.hasNewVersion ? status.latest?.version : null);
    const pending = Boolean(target || download && !["idle", "trust-not-configured", "not-implemented"].includes(download.state));
    const steps = ["下载与验签", "暂存复核", "关闭工作台页面", "切换与启动"];
    const state = install?.state || "";
    const step = !pending ? -1 : install?.staging ? 1 : ["staged", "awaiting-browser-exit", "deferred"].includes(state) ? 2
        : ["prepared", "stopping", "switching", "starting", "restarting-manager", "committed", "rolling-back", "rolled-back"].includes(state) ? 3
        : download?.state === "verified" ? 1 : 0;
    return <section aria-label="更新进度" data-guan-update-progress className="rounded-xl border border-stone-200 bg-stone-50 p-3 dark:border-stone-700 dark:bg-stone-900/50">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
            <strong>更新进度</strong><span>{target ? `目标 ${target}` : status?.state === "up-to-date" ? "当前已是最新版本" : "尚无待安装更新"}</span>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-500 dark:text-stone-400" aria-label="更新阶段">
            {steps.map((label, index) => <span key={label} aria-current={index === step ? "step" : undefined}
                className={index === step ? "font-medium text-blue-600 dark:text-blue-400" : ""}>{index < step ? "✓" : index + 1} {label}</span>)}
        </div>
        {pending ? <Progress aria-label="安装包下载进度" percent={percent} size="small" status={download?.error ? "exception" : download?.state === "verified" ? "success" : "normal"} /> : null}
        <div role="status" className="text-xs leading-5 text-stone-500 dark:text-stone-400">
            {pending ? `下载：${updateMessages[download?.state || "idle"] || "等待下载"}。` : "有可用更新后，这里会显示下载与安装进度。"}
            {pending && install?.allowed ? install.staging ? "正在解包并复核全部文件。" : `${installationMessages[state] || "正在读取安装状态"}。` : ""}
            {error ? ` ${updateMessages[error] || "操作未完成，请重试；原版本保留"}` : ""}
            {install?.diagnostic ? ` 原因：${updateMessages[install.diagnostic.code] || "启动未完成"}${install.diagnostic.field ? `（${({ ready: "服务未就绪", version: "版本不一致", workspace: "工作区身份不一致", origin: "监听地址不符合要求", activation: "页面服务未激活" } as Record<string, string>)[install.diagnostic.field] || "健康检查"}）` : ""}。` : ""}
        </div>
    </section>;
}
