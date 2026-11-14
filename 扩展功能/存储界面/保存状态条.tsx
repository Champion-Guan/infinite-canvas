import { useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";
import { reconnectAndRetrySQLiteStorage, retrySQLiteStorage, storageStatus } from "../本机存储/上游浏览器存储桥";
import { StatusDetails } from "../主题/状态详情";
import { clearReportedSaveFailure, readReportedSaveFailure, reportSaveFailure, subscribeReportedSaveFailure } from "./保存错误通知";

export function SQLiteSaveDetails({ status, reported = "" }: { status: ReturnType<typeof storageStatus>; reported?: string }) {
    const conflict = status.conflict || status.failure?.code === "revision_conflict";
    const reconnect = status.reconnectRequired && !conflict;
    const expired = ["authorization_expired", "authorization_denied", "lease_expired", "session_host_closed"].includes(status.reconnectError ?? "");
    const retry = async () => {
        try {
            await (reconnect ? reconnectAndRetrySQLiteStorage() : retrySQLiteStorage());
            clearReportedSaveFailure();
        } catch (error) {
            reportSaveFailure(error instanceof Error ? error.message : "保存仍未确认，请稍后重试。");
        }
    };
    return <>
        <p>{conflict ? "其他窗口已修改数据。请保留本页，先从画布菜单导出当前画布；处理冲突前不要刷新、关闭或强制覆盖。"
            : expired ? "页面授权已结束，原连接尚未恢复。编辑仍在本页，请保留页面，先恢复本机连接。"
            : reconnect ? "自动恢复本机连接未完成。编辑仍在本页，请勿刷新或关闭，可以重新连接并保存。"
            : "部分编辑尚未确认保存。请保留本页，勿刷新或关闭；可以重试原保存。"}</p>
        {reported ? <p className="text-muted-foreground">{reported}</p> : null}
        {status.reconnectError && !expired ? <p>重新连接或保存尚未完成，请稍后重试。</p> : null}
        {status.failure ? <details className="text-muted-foreground">
            <summary className="cursor-pointer">技术详情</summary>
            <p className="mt-1">{status.failure.code} · {status.failure.stage === "root" ? "提交目录" : status.failure.stage === "fragment" ? "写入分片" : "准备保存"}
                {status.failure.status ? ` · HTTP ${status.failure.status}` : ""}</p>
        </details> : null}
        {!conflict && !expired ? <button type="button" disabled={status.retrying || status.reconnecting}
            onClick={() => void retry()} className="inline-flex items-center gap-1.5 rounded-md border border-current/20 px-2.5 py-1.5 disabled:opacity-50">
            <RotateCcw aria-hidden className={`size-3.5 ${status.retrying ? "animate-spin motion-reduce:animate-none" : ""}`} />
            {status.reconnecting ? "正在重新连接…" : status.retrying ? "正在重试…" : reconnect ? "重新连接并保存" : "重试保存"}
        </button> : null}
        {conflict ? <p className="text-muted-foreground">重复重试已暂停，避免覆盖其他窗口的更新。</p> : null}
    </>;
}

export function SQLiteSaveStatus({ pending = false, muted }: { pending?: boolean; muted?: string }) {
    const [status, setStatus] = useState(storageStatus);
    const [reported, setReported] = useState(readReportedSaveFailure);
    useEffect(() => {
        const update = () => {
            const next = storageStatus();
            if (next.state === "saved" && !next.pending && !next.retrying) clearReportedSaveFailure();
            setStatus(next);
        };
        const unsubscribe = subscribeReportedSaveFailure(() => setReported(readReportedSaveFailure()));
        window.addEventListener("guan:storage-status", update);
        setStatus(storageStatus());
        return () => { unsubscribe(); window.removeEventListener("guan:storage-status", update); };
    }, []);
    const failed = Boolean(reported || status.state === "error" || status.reconnectError);
    const saving = !failed && (pending || status.pending || status.retrying || status.state !== "saved");
    if (failed) return <span className="guan-canvas-save-status inline-flex h-8 items-center" data-canvas-save-status="error">
        <StatusDetails label="保存失败" failed><SQLiteSaveDetails status={status} reported={reported} /></StatusDetails>
        <span role="status" className="sr-only">保存失败，请查看详情并保留本页。</span>
    </span>;
    return <span className="guan-canvas-save-status flex h-8 items-center gap-1.5 text-xs"
        style={{ color: saving ? "#d97706" : muted }} role="status" data-canvas-save-status={saving ? "saving" : "saved"}>
        <span aria-hidden className="size-2 rounded-full" style={{ background: saving ? "#f59e0b" : "#22c55e" }} />
        {saving ? "保存中…" : "已保存"}
    </span>;
}
