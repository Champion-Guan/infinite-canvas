import { LocalStatusNotice } from "../存储界面/状态通知区";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CanvasNodeData } from "@/types/canvas";
import { saveProductCanvas } from "../产品/产品操作";
import { storageStatus } from "../本机存储/上游浏览器存储桥";
import { serializeProductResult } from "./图片任务衔接.mjs";
import { createImageConfirmationRecovery, imageConfirmationTargets, imageConfirmationErrorKey } from "./图片任务确认恢复.mjs";

export type ConfirmedImageTarget = { id: string; productId: string; nodeId: string; responseHash: string };

// 与图片重试按钮分开：这里始终只确认已有收据，不能走生成或媒体交付入口。
export function ImageTaskConfirmation({ productId, nodes, ready, afterConfirmed }: { productId: string; nodes: CanvasNodeData[]; ready: boolean; afterConfirmed: (target: ConfirmedImageTarget) => Promise<void> }) {
  const targetsKey = useMemo(() => {
    try { return JSON.stringify(imageConfirmationTargets(productId, nodes)); }
    catch { return null; }
  }, [productId, nodes]);
  const errorsKey = useMemo(() => imageConfirmationErrorKey(nodes), [nodes]);
  const [status, setStatus] = useState({ key: "", pending: 0, busy: false });
  const retryRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!ready || !targetsKey || targetsKey === "[]") return;
    let active = true;
    const host = (window as unknown as { __guanGenerationHost?: unknown }).__guanGenerationHost;
    const recovery = createImageConfirmationRecovery({ host, targets: JSON.parse(targetsKey), save: saveProductCanvas,
      serialize: serializeProductResult, afterConfirmed, isCurrent: () => active });
    const retry = () => {
      if (!active) return;
      setStatus(previous => ({ key: targetsKey, pending: previous.key === targetsKey ? previous.pending : 0, busy: true }));
      void recovery.run().then((result: { pending: string[] }) => {
        if (active) setStatus({ key: targetsKey, pending: result.pending.length, busy: false });
      });
    };
    const saved = () => { const state = storageStatus(); if (state.state === "saved" && !state.pending && !state.retrying) retry(); };
    retryRef.current = retry;
    window.addEventListener("guan:storage-status", saved);
    retry();
    return () => { active = false; retryRef.current = null; window.removeEventListener("guan:storage-status", saved); };
  }, [productId, ready, targetsKey, errorsKey, afterConfirmed]);
  const invalid = ready && targetsKey === null;
  const pending = status.key === targetsKey ? status.pending : 0;
  if (!invalid && !pending) return null;
  return <LocalStatusNotice order={1}><aside aria-label="生成任务确认" className="w-full rounded-xl border bg-background px-4 py-3 text-sm text-foreground shadow-lg">
    <p role="status" aria-live="polite">{invalid ? "原卡片任务收据异常，请保留画布。" : `${pending} 个生成任务的完成确认尚未结束，图片和原任务已保留。`}</p>
    {!invalid ? <button type="button" className="mt-2 rounded-lg border px-3 py-1.5" disabled={status.busy} onClick={() => retryRef.current?.()}>{status.busy ? "正在确认…" : "重试任务确认"}</button> : null}
  </aside></LocalStatusNotice>;
}
