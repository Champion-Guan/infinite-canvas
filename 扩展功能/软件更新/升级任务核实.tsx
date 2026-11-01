import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { App, Button } from "antd";
import { updateRequest, type UpdateBlocker } from "./软件更新客户端";

export function UpgradeTaskReview({ blockers, failedWithoutResult = 0, refresh }: {
    blockers: UpdateBlocker[];
    failedWithoutResult?: number;
    refresh: () => Promise<unknown>;
}) {
    const navigate = useNavigate();
    const { message } = App.useApp();
    const [busy, setBusy] = useState(false);
    const retryable = blockers.filter(task => task.canRetryResultSave);
    const recoverableByProduct = useMemo(() => {
        const groups = new Map<string, number>();
        for (const task of blockers) if (task.canRecoverCanvas && task.productId)
            groups.set(task.productId, (groups.get(task.productId) || 0) + 1);
        return [...groups].map(([productId, count]) => ({ productId, count }));
    }, [blockers]);
    const performBatchSaveRetry = async () => {
        setBusy(true);
        try {
            const result = await updateRequest("retry-result-save-batch");
            await refresh();
            const action = result.taskAction;
            if (!action || action.total === 0) message.info("没有可重试的本机结果");
            else if (action.failures.length) message.warning(`已恢复 ${action.completed}/${action.total} 条，${action.failures.length} 条仍需处理`);
            else message.success(`已恢复 ${action.completed} 条任务结果`);
        } catch (error) { message.error(error instanceof Error ? error.message : "批量恢复未完成"); }
        finally { setBusy(false); }
    };
    if (!blockers.length && !failedWithoutResult) return null;
    return <div className="space-y-2 rounded border border-amber-300 p-3 dark:border-amber-800">
        {failedWithoutResult ? <div role="status" className="text-sm">
            {failedWithoutResult} 个任务在本机没有收到结果，已自动按失败收口，不需要逐条核实，也不会阻止升级。需要补做时请回到画布明确重试；系统不会自动重新提交。
        </div> : null}
        {blockers.length ? <div>升级前仍需恢复的任务：{blockers.length}</div> : null}
        {retryable.length ? <div className="flex flex-wrap items-center gap-2">
            <span>结果暂存在本机内存、尚未落盘：{retryable.length} 条</span>
            <Button size="small" loading={busy} disabled={busy} onClick={() => void performBatchSaveRetry()}>批量重试本机保存</Button>
        </div> : null}
        {recoverableByProduct.map(({ productId, count }) => <div key={productId} className="flex flex-wrap items-center gap-2">
            <span>结果已保存，画布待确认：{count} 条</span>
            <Button size="small" onClick={() => navigate(`/canvas/${encodeURIComponent(productId)}`)}>打开画布并自动批量恢复</Button>
        </div>)}
        {blockers.length ? <details className="text-xs">
            <summary className="cursor-pointer">查看仍需恢复的任务明细</summary>
            <div className="mt-2 space-y-1">
                {blockers.map(task => <div key={task.id} className="break-all">
                    {task.createdAt ? new Date(task.createdAt).toLocaleString() : "旧画布视频"} · {task.id} ·
                    {" "}{task.reason === "video_legacy_untracked" ? "请返回原画布查询视频" :
                        task.reason === "video_remote_pending" ? "视频待完成或待确认保存" :
                            task.reason === "result_save_unconfirmed" ? "本机结果保存未确认" :
                                task.state === "succeeded" ? "待确认画布保存" : "尚未结束"}
                </div>)}
            </div>
        </details> : null}
    </div>;
}
