import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { App, message as messageApi } from "antd";
import { RotateCcw } from "lucide-react";
import type { CanvasConnection, CanvasNodeData } from "@/types/canvas";
import type { CanvasAgentOp } from "@/lib/canvas/canvas-agent-ops";
import { imageToDataUrl } from "@/services/image-storage";
import { saveProductCanvas } from "../产品/产品操作";
import { productPromptRestoreOps, restoredProductImages } from "./商品提示词恢复";
import { promptDocument } from "./商品提示词规则";
import { productPromptWarningGroups } from "./商品提示词状态";
import { PERSISTENT_MESSAGE_TOP, reservePersistentMessage } from "../存储界面/消息浮层布局";
import { createPromptWarningMotion, registerProductPromptWarning } from "./商品提示词阻止反馈";

type WarningProps = { projectId: string; active: boolean; nodes: CanvasNodeData[]; connections: CanvasConnection[];
    getNodes(): CanvasNodeData[]; applyOps(ops: CanvasAgentOp[]): unknown };

function WarningContent({ text, restore, messageKey, promptIds }: { text: string; restore(): Promise<void>; messageKey: string; promptIds: string[] }) {
    const [busy, setBusy] = useState(false);
    const content = useRef<HTMLDivElement | null>(null);
    useLayoutEffect(() => {
        const element = content.current?.closest<HTMLElement>(".ant-message-notice") || content.current;
        if (!element) return;
        const reserved = reservePersistentMessage(messageKey);
        const measure = () => reserved.resize(element.getBoundingClientRect().height);
        const observer = new ResizeObserver(measure);
        const motion = createPromptWarningMotion(element);
        const unregister = registerProductPromptWarning(promptIds, motion.play);
        measure(); observer.observe(element);
        // 提示退出动画结束、内容实际卸载后再释放，避免普通提示撞上正在淡出的框。
        return () => { unregister(); motion.dispose(); observer.disconnect(); reserved.release(); };
    }, [messageKey, promptIds]);
    return <div ref={content} data-product-prompt-warning className="flex max-w-[calc(100vw-96px)] items-center gap-4 text-left">
        <span className="min-w-0 flex-1 whitespace-pre-wrap [overflow-wrap:anywhere]">{text}</span>
        <button type="button" disabled={busy} onClick={async () => { if (busy) return; setBusy(true); try { await restore(); } finally { setBusy(false); } }}
            className="inline-flex shrink-0 items-center gap-1 rounded border border-current/20 px-2 py-1 text-xs hover:bg-black/5 disabled:opacity-50 dark:hover:bg-white/10">
            <RotateCcw aria-hidden className={`size-3.5 ${busy ? "animate-spin motion-reduce:animate-none" : ""}`} />一键恢复
        </button>
    </div>;
}

export function ProductPromptWarnings(props: WarningProps) {
    const { message } = App.useApp();
    const [persistent, holder] = messageApi.useMessage({ top: PERSISTENT_MESSAGE_TOP });
    const latest = useRef(props); latest.current = props;
    const serialized = JSON.stringify(productPromptWarningGroups(props.nodes));
    const groups = useMemo(() => JSON.parse(serialized) as ReturnType<typeof productPromptWarningGroups>, [serialized]);
    const key = `product-prompt-invalid:${props.projectId}`;
    useEffect(() => {
        if (!props.active || !groups.length) return;
        const ids = groups.flatMap(group => group.nodeIds), first = latest.current.nodes.find(node => node.id === ids[0]);
        const title = ids.length > 1 ? `“${first?.title || "商品图片提示词"}”等 ${ids.length} 张提示词已失效` : `“${first?.title || "商品图片提示词"}”提示词已失效`;
        const reasons = [...new Set(groups.flatMap(group => group.reasons))];
        const restore = async () => {
            try {
                const port = latest.current, nodes = port.getNodes();
                const ops = productPromptRestoreOps(nodes, port.connections, ids);
                for (const image of restoredProductImages(nodes, ops)) {
                    const url = await imageToDataUrl({ storageKey: image.storageKey, url: image.url });
                    if (!url) throw Error(`原参考图“${image.name}”无法读取，请重新上传原图后再恢复。`);
                }
                const current = latest.current.getNodes();
                if (current !== nodes || latest.current.connections !== port.connections || !latest.current.active || latest.current.projectId !== port.projectId)
                    throw Error("恢复期间画布内容已更改，请重试一键恢复。");
                if (!ids.every(id => current.some(node => node.id === id && promptDocument(node)))) throw Error("提示词卡片已更改，请重试一键恢复。");
                port.applyOps(ops);
                const result = await saveProductCanvas(port.projectId);
                if (!result.persisted) throw Error("参数已恢复，但保存尚未确认，请检查画布保存状态。");
            } catch (error) { message.error(error instanceof Error ? error.message : "恢复未完成，请重试。"); }
        };
        persistent.open({ key, type: "error", duration: 0, content: <WarningContent messageKey={key} promptIds={ids} text={`${title}：${reasons.join("\n")}`} restore={restore} /> });
        return () => { persistent.destroy(key); };
    }, [groups, key, message, persistent, props.active]);
    return holder;
}
