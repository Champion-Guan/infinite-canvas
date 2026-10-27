import { useNavigate } from "react-router-dom";
import { App, Button } from "antd";
import { updateRequest, type UpdateBlocker } from "./软件更新客户端";

export function UpgradeTaskReview({ blockers, refresh }: { blockers: UpdateBlocker[]; refresh: () => Promise<unknown> }) {
    const navigate = useNavigate();
    const { modal, message } = App.useApp();
    if (!blockers.length) return null;
    const confirm = (task: UpdateBlocker) => modal.confirm({
        title: "核实没有结果的请求",
        content: `任务 ${task.id} 在本机没有收到结果。请先到渠道端确认请求已经结束且没有结果；确认后保留原记录及核实凭据，不会重新生成。`,
        okText: "已在渠道端确认结束且无结果", cancelText: "返回核实",
        onOk: async () => {
            try { await updateRequest("confirm-no-result", { taskId: task.id, acknowledgement: "upstream-ended-without-result" }); await refresh(); message.success("核实凭据已保存，原任务已收口"); }
            catch (error) { message.error(error instanceof Error ? error.message : "核实未保存"); throw error; }
        },
    });
    return <div className="space-y-2 rounded border border-amber-300 p-3 dark:border-amber-800">
        <div>升级前需处理的生成任务：{blockers.length}</div>
        {blockers.map(task => <div key={task.id} className="flex flex-wrap items-center gap-2 text-xs">
            <span>{task.createdAt ? new Date(task.createdAt).toLocaleString() : "旧画布视频"} · {task.id} · {task.reason === "video_legacy_untracked" ? "请返回原画布查询视频" : task.reason === "video_remote_pending" ? "视频待完成或待确认保存" : task.state === "uncertain" ? "待核实" : task.state === "succeeded" ? "待确认画布保存" : "尚未结束"}</span>
            {task.productId ? <Button size="small" onClick={() => navigate(`/canvas/${encodeURIComponent(task.productId!)}`)}>返回原画布</Button> : null}
            {task.canConfirmNoResult ? <Button size="small" onClick={() => confirm(task)}>核实无结果</Button> : null}
        </div>)}
    </div>;
}
