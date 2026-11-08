import { useEffect, useRef, useState } from "react";
import { App } from "antd";
import { Play, X } from "lucide-react";
import { planningNoticeSeconds, subscribeProductPlanningNotice } from "./商品策划完成通知";

type PlanningNoticePort = {
    projectId: string;
    active: boolean;
    hasNode(id: string): boolean;
    assertActive(): void;
    generateAllConfigNodes(): Promise<void>;
};

function PlanningNoticeContent({ deadline, close, generate }: { deadline: number; close(): void; generate(): void }) {
    const [seconds, setSeconds] = useState(() => planningNoticeSeconds(deadline));
    useEffect(() => {
        const update = () => setSeconds(planningNoticeSeconds(deadline));
        const timer = setInterval(update, 1000);
        document.addEventListener("visibilitychange", update);
        return () => { clearInterval(timer); document.removeEventListener("visibilitychange", update); };
    }, [deadline]);
    return <div className="flex max-w-[calc(100vw-96px)] flex-wrap items-center gap-x-4 gap-y-2 text-left">
        <span className="min-w-0 flex-1">AI策划已完成，提示词和生成配置已保存。</span>
        <span className="shrink-0 text-xs tabular-nums opacity-60" aria-live="off">{seconds} 秒后关闭</span>
        <button type="button" onClick={generate}
            className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded border border-current/20 px-2 py-1 text-xs hover:bg-black/5 focus-visible:outline focus-visible:outline-2 dark:hover:bg-white/10">
            <Play aria-hidden className="size-3.5" />一键生图
        </button>
        <button type="button" onClick={close} aria-label="关闭策划完成提示"
            className="inline-flex size-6 shrink-0 items-center justify-center rounded opacity-60 hover:opacity-100 focus-visible:outline focus-visible:outline-2">
            <X aria-hidden className="size-3.5" />
        </button>
    </div>;
}

export function useProductPlanningSuccessNotice(port: PlanningNoticePort) {
    const { message } = App.useApp();
    const latest = useRef(port); latest.current = port;
    useEffect(() => {
        if (!port.active) return;
        let dismiss: (() => void) | undefined;
        const unsubscribe = subscribeProductPlanningNotice(notice => {
            if (notice.productId !== port.projectId) return;
            dismiss?.();
            if (!latest.current.active || latest.current.projectId !== notice.productId) return;
            const deadline = notice.deadline;
            if (!deadline || !planningNoticeSeconds(deadline)) return;
            const key = `product-planning-complete:${notice.productId}:${notice.sequence}`;
            let closed = false;
            const close = () => {
                if (closed) return;
                closed = true;
                clearTimeout(timer);
                message.destroy(key);
            };
            const generate = () => {
                if (closed) return;
                const current = latest.current;
                if (!planningNoticeSeconds(deadline) || !current.active || current.projectId !== notice.productId) { close(); return; }
                close();
                try {
                    current.assertActive();
                    if (!current.hasNode(notice.parameterId)) throw Error("产品参数卡已移除，请重新策划。");
                    void current.generateAllConfigNodes().catch(error => {
                        message.error(error instanceof Error ? error.message : "批量生成未完成，请重试。");
                    });
                } catch (error) { message.error(error instanceof Error ? error.message : "请回到原画布重试。"); }
            };
            // 按真实截止时间关闭，鼠标悬浮与后台标签页不会延长有效期。
            const timer = setTimeout(close, Math.max(0, deadline - Date.now()));
            dismiss = close;
            void message.open({ key, type: "success", duration: 0,
                content: <PlanningNoticeContent deadline={deadline} close={close} generate={generate} /> });
        });
        return () => { unsubscribe(); dismiss?.(); };
    }, [message, port.active, port.projectId]);
}
