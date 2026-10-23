import { LocalStatusNotice } from "./状态通知区";
import { useEffect, useState } from "react";
import { reconnectAndRetrySQLiteStorage, retrySQLiteStorage, storageStatus } from "../本机存储/上游浏览器存储桥";

// 独立的声明式组件；不搜寻/改写原作者DOM，不更换画布布局或全局样式。
export function SQLiteSaveStatus() {
    const [status, setStatus] = useState(storageStatus);
    useEffect(() => {
        const update = () => setStatus(storageStatus());
        window.addEventListener("guan:storage-status", update);
        update();
        return () => window.removeEventListener("guan:storage-status", update);
    }, []);
    // 正常保存只显示画布名旁的状态；错误在收到真实落盘确认后立即退出。
    if (status.state !== "error") return null;
    const title = status.reconnecting ? "正在重新连接并保存…" : status.retrying ? "正在核实并重试保存…" : "保存尚未确认";
    const reconnect = status.reconnectRequired && !status.conflict;
    const expired = ["authorization_expired", "authorization_denied", "lease_expired", "session_host_closed"].includes(status.reconnectError ?? "");
    return <LocalStatusNotice order={2}><aside aria-label="本机保存状态" data-save-state={status.state} style={{ padding: "12px 16px", borderRadius: 12, border: "1px solid var(--border)", background: "var(--background)", color: "var(--foreground)", boxShadow: "0 6px 24px #0002", fontSize: 13 }}>
        <p role="alert" aria-live="assertive" style={{ margin: 0, fontWeight: 600 }}>{title}</p>
            <p style={{ margin: "6px 0 10px" }}>{status.conflict ? "其他窗口已修改数据。请保留本页，不要刷新、关闭或强制覆盖；需要先处理版本冲突。" : expired ? "页面授权已结束或服务已重开，不能恢复原连接。编辑仍在本页，请保留页面，勿刷新或关闭，需先由可信入口恢复授权。" : reconnect ? "自动恢复本机连接未完成。编辑仍保留在本页，请勿刷新或关闭；点击下方重试连接并保存。" : "编辑仍保留在本页内存中。请勿刷新或关闭，连接恢复后点击重试。"}</p>
            {status.reconnectError && !expired && <p role="alert" style={{ margin: "6px 0 10px" }}>重新连接或保存尚未完成，编辑仍保留，请稍后重试。</p>}
            <button type="button" disabled={status.retrying || status.conflict} onClick={() => { void (reconnect ? reconnectAndRetrySQLiteStorage() : retrySQLiteStorage()).catch(() => { /* 状态事件保留错误，不能假报成功。 */ }); }} style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--background)", color: "inherit", cursor: status.retrying ? "wait" : "pointer" }}>
                {status.reconnecting ? "正在重新连接…" : status.retrying ? "正在重试…" : reconnect ? "重新连接并保存" : "重试未确认保存"}
            </button>
    </aside></LocalStatusNotice>;
}
