import { useCallback, useState, useSyncExternalStore } from "react";
import { App, Button } from "antd";
import { Square } from "lucide-react";
import type { CanvasNodeData } from "@/types/canvas";

type Progress = { attempt: number; maxRetries: number; phase: string; nextRetryAt: number | null };
type Job = { id: string; nodeId: string; state: string; imageRetry?: Progress | null };
type Host = {
    taskSnapshot(id: string): Job | null;
    subscribeTask(id: string, listener: () => void): () => void;
    cancel(id: string): Promise<unknown>;
};
const empty = () => null;
export function ImageAutoRetryStatus({ node, slotId, label }: { node: CanvasNodeData; slotId?: string; label: string }) {
    const { message } = App.useApp();
    const host = (window as unknown as { __guanGenerationHost?: Host }).__guanGenerationHost;
    const tasks = node.metadata?.gatewayGenerationTasks || [];
    const task = slotId ? tasks.find(item => item.slotId === slotId) : tasks.length === 1 ? tasks[0] : undefined;
    const id = task?.taskId;
    const subscribe = useCallback((listener: () => void) => id && host?.subscribeTask ? host.subscribeTask(id, listener) : () => {}, [id, host]);
    const snapshot = useCallback(() => id && host?.taskSnapshot ? host.taskSnapshot(id) : null, [id, host]);
    const job = useSyncExternalStore(subscribe, snapshot, empty);
    const [stopping, setStopping] = useState(false);
    const progress = job?.nodeId === node.id && ["accepted", "running"].includes(job.state) ? job.imageRetry : null;
    const retrying = progress && (progress.phase === "waiting" || progress.attempt > 0 && progress.phase === "requesting");
    const stop = async () => {
        if (!id || !host || stopping) return;
        setStopping(true);
        try { await host.cancel(id); }
        catch { void message.error("停止尚未确认，请查询原任务。"); }
        finally { setStopping(false); }
    };
    return <div className="flex max-w-full flex-col items-center gap-2 text-center">
        <span className="text-[10px]" role="status">{retrying
            ? `${progress.phase === "waiting" ? "等待自动重试" : "正在自动重试"}（${progress.phase === "waiting" ? progress.attempt + 1 : progress.attempt}/${progress.maxRetries}）`
            : label}</span>
        {retrying ? <Button size="small" loading={stopping} icon={<Square size={12} />} onPointerDown={event => event.stopPropagation()}
            onClick={event => { event.stopPropagation(); void stop(); }}>停止</Button> : null}
    </div>;
}
