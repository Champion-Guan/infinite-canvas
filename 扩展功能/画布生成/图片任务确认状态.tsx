import { LocalStatusNotice } from "../存储界面/状态通知区";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CanvasNodeData } from "@/types/canvas";
import { saveProductCanvas } from "../产品/产品操作";
import { storageStatus } from "../本机存储/上游浏览器存储桥";
import { serializeProductResult } from "./图片任务衔接.mjs";
import { createImageConfirmationRecovery, imageConfirmationTargets, imageConfirmationErrorKey } from "./图片任务确认恢复.mjs";
import { waitForBatchCanvasSave } from "./批量保存协调";

export type ConfirmedImageTarget = { id: string; productId: string; nodeId: string; responseHash: string };

function confirmationFailureText(failures: { phase: string; code: string }[]) {
  const failure = failures[0];
  if (!failure) return "任务仍保留，尚未收到完成确认。请稍后重试。";
  if (failure.phase === "save" && failure.code === "invalid_media")
    return "当前画布保存被素材校验拒绝（invalid_media）。请先处理“重试未确认保存”提示中的错误，再重试任务确认。";
  if (failure.phase === "save") return "当前画布尚未保存确认。请先处理“重试未确认保存”提示，再重试任务确认。";
  if (failure.phase === "task-list") return "暂时无法读取本机原任务状态，任务与图片仍保留。检查本机连接后可重试。";
  if (failure.phase === "confirm") return "画布已保存，但任务确认尚未收到有效回执。重试会沿用原任务，不会重新生图。";
  if (failure.phase === "cleanup") return "任务已确认，卡片状态还未保存。重试会继续保存，不会重新生图。";
  return "任务与画布中的原收据暂不匹配，未确认完成。请保留当前产品并联系维护人员。";
}

function confirmationProgressText(phase: string, current: number, total: number) {
  if (phase === "task-list") return "正在读取原任务状态…";
  if (phase === "save") return `正在保存当前画布（${current}/${total}）…`;
  if (phase === "confirm") return `正在确认已保存任务（${current}/${total}）…`;
  if (phase === "cleanup") return `正在同步卡片状态（${current}/${total}）…`;
  return `正在核对原任务与图片收据（${current}/${total}）…`;
}

// 与图片重试按钮分开：这里始终只确认已有收据，不能走生成或媒体交付入口。
export function ImageTaskConfirmation({ productId, nodes, ready, afterConfirmed }: { productId: string; nodes: CanvasNodeData[]; ready: boolean; afterConfirmed: (target: ConfirmedImageTarget) => Promise<void> }) {
  const targetsKey = useMemo(() => {
    try { return JSON.stringify(imageConfirmationTargets(productId, nodes)); }
    catch { return null; }
  }, [productId, nodes]);
  const errorsKey = useMemo(() => imageConfirmationErrorKey(nodes), [nodes]);
  const [status, setStatus] = useState({ key: "", pending: 0, busy: false, progress: "", error: "" });
  const retryRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!ready || !targetsKey || targetsKey === "[]") return;
    let active = true;
    const host = (window as unknown as { __guanGenerationHost?: unknown }).__guanGenerationHost;
    const recovery = createImageConfirmationRecovery({ host, targets: JSON.parse(targetsKey), save: saveProductCanvas, waitForBatchSave: waitForBatchCanvasSave,
      serialize: serializeProductResult, afterConfirmed, isCurrent: () => active,
      onProgress: ({ phase, current, total }: { phase: string; current: number; total: number }) => {
        if (active) setStatus(previous => ({ key: targetsKey, pending: previous.key === targetsKey ? previous.pending : 0,
          busy: true, progress: confirmationProgressText(phase, current, total), error: "" }));
      } });
    const retry = () => {
      if (!active) return;
      setStatus(previous => ({ key: targetsKey, pending: previous.key === targetsKey ? previous.pending : 0,
        busy: true, progress: "正在重新检查任务…", error: "" }));
      void recovery.run().then((result: { pending: string[]; failures?: { phase: string; code: string }[] }) => {
        if (active) setStatus({ key: targetsKey, pending: result.pending.length, busy: false, progress: "",
          error: result.pending.length ? confirmationFailureText(result.failures || []) : "" });
      }).catch(() => {
        if (active) setStatus(previous => ({ key: targetsKey, pending: Math.max(1, previous.key === targetsKey ? previous.pending : 0),
          busy: false, progress: "", error: "任务确认没有完成，任务与图片仍保留。请重试，不会重新生图。" }));
      });
    };
    const saved = () => { const state = storageStatus(); if (state.state === "saved" && !state.pending && !state.retrying) retry(); };
    const batchCompleted = (event: Event) => {
      const detail = (event as CustomEvent<{ projectId?: string; outcome?: string }>).detail;
      if (detail?.projectId === productId && detail.outcome === "saved") retry();
    };
    retryRef.current = retry;
    window.addEventListener("guan:storage-status", saved);
    window.addEventListener("guan:batch-save-complete", batchCompleted);
    retry();
    return () => { active = false; retryRef.current = null; window.removeEventListener("guan:storage-status", saved); window.removeEventListener("guan:batch-save-complete", batchCompleted); };
  }, [productId, ready, targetsKey, errorsKey, afterConfirmed]);
  const invalid = ready && targetsKey === null;
  const pending = status.key === targetsKey ? status.pending : 0;
  if (!invalid && !pending) return null;
  return <LocalStatusNotice order={1}><aside aria-label="生成任务确认" className="w-full rounded-xl border bg-background px-4 py-3 text-sm text-foreground shadow-lg">
    <p role="status" aria-live="polite">{invalid ? "原卡片任务收据异常，请保留画布。" : `${pending} 个生成任务的完成确认尚未结束，图片和原任务已保留。`}</p>
    {status.busy && status.progress ? <p className="mt-1 text-xs text-muted-foreground" role="status" aria-live="polite">{status.progress}</p> : null}
    {!status.busy && status.error ? <p className="mt-1 text-xs text-destructive" role="alert">{status.error}</p> : null}
    {!invalid ? <button type="button" className="mt-2 rounded-lg border px-3 py-1.5" disabled={status.busy} onClick={() => retryRef.current?.()}>{status.busy ? "正在确认…" : "重试任务确认"}</button> : null}
  </aside></LocalStatusNotice>;
}
