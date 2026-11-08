import { useCallback, useEffect, useRef, useState } from "react";
import { App, Button, Input, Tooltip } from "antd";
import { AnimatePresence } from "motion/react";
import { AppleModal as Modal } from "../主题/苹果弹窗";
import { ChevronDown, Sparkles } from "lucide-react";
import type { CanvasNodeData } from "@/types/canvas";
import type { CanvasNodeToolbarItem, CanvasPluginHost } from "@/types/canvas-plugin";
import { decodeChannelModel, useConfigStore } from "@/stores/use-config-store";
import { buildGenerationConfig } from "@/lib/canvas/canvas-generation-helpers";
import { saveProductCanvas } from "../产品/产品操作";
import { requestPromptOptimization } from "./提示词优化请求";
import { canOptimizePrompt, parseOptimizedPrompt, promptOptimizationOps, readPromptOptimizationSource,
    type OptimizationMetadata, type OptimizedPrompt, type PromptOptimizationSource } from "./提示词优化规则";
import styles from "./提示词优化窗口.module.css";
import { normalizeOptimizationDirections, OPTIMIZATION_DIRECTIONS } from "./快捷优化方向";
import { ensureModelConfigured } from "../产品配置/模型配置门禁";
import { BilingualPromptField, useBilingualPromptSync } from "./双语联动文本框";
import type { BilingualAlignment } from "./双语片段对齐";
import { TextTaskStatus, type TextTaskPhase } from "../主题/任务阶段反馈";
import { AppleAntButton } from "../主题/苹果交互按钮";

type Session = { source: PromptOptimizationSource; instruction: string; directions: string[]; result?: OptimizedPrompt; resultModel?: string };
const errorText = (error: unknown) => {
    const text = error instanceof Error ? error.message : "";
    return text && text.length < 280 && !/https?:|<html/i.test(text) ? text : "优化失败，原文已保留，请稍后重试。";
};

export function usePromptOptimization({ productId, active, host, assertActive }: {
    productId: string; active: boolean; host: CanvasPluginHost; assertActive(): void;
}) {
    const { message } = App.useApp();
    const [session, setSession] = useState<Session | null>(null);
    const [busy, setBusy] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState("");
    const [phase, setPhase] = useState<TextTaskPhase | null>(null);
    const controller = useRef<AbortController | null>(null);
    const sessionRevision = useRef(0);
    const applied = useRef(false), applying = useRef(false);
    const latest = useRef({ host, assertActive }); latest.current = { host, assertActive };
    const invalidateSession = useCallback(() => {
        sessionRevision.current++;
        controller.current?.abort(); controller.current = null;
    }, []);
    const config = useConfigStore(state => state.config);
    const defaultModel = buildGenerationConfig(config, undefined, "text").model;
    const modelLabel = (value: string) => decodeChannelModel(value)?.model || value || "未配置文本模型";

    useEffect(() => {
        if (!active) { invalidateSession(); setBusy(false); setSession(null); setPhase(null); }
        return invalidateSession;
    }, [productId, active, invalidateSession]);

    const close = () => {
        if (applying.current) return;
        invalidateSession(); setBusy(false); setSession(null); setPhase(null);
    };
    const open = (node: CanvasNodeData) => {
        if (applying.current) { void message.info("正在保存原卡片，请等待保存结果。"); return; }
        try {
            latest.current.assertActive();
            if (!ensureModelConfigured(buildGenerationConfig(useConfigStore.getState().config, undefined, "text"), "text")) return;
            const current = latest.current.host.getNode(node.id);
            if (!current) throw Error("原卡片已移除。");
            const source = readPromptOptimizationSource(current, latest.current.host.getNodes());
            const draft = (current.metadata as OptimizationMetadata)?.promptOptimizationDraft;
            let result: OptimizedPrompt | undefined;
            if (draft?.signature === source.signature) try { result = parseOptimizedPrompt(draft.raw, source); } catch { /* 无效候选由用户重新优化。 */ }
            invalidateSession();
            applied.current = false; setError(""); setBusy(false); setPhase(result ? "ready" : null);
            setSession({ source, instruction: draft?.signature === source.signature ? draft.instruction : "",
                directions: draft?.signature === source.signature ? normalizeOptimizationDirections(draft.directions) : [], result,
                resultModel: result ? draft?.model : undefined });
        } catch (error) { void message.warning(errorText(error)); }
    };

    let stale = false;
    if (session && !applied.current) {
        try {
            const node = host.getNode(session.source.id);
            stale = !node || readPromptOptimizationSource(node, host.getNodes()).signature !== session.source.signature;
        } catch { stale = true; }
    }
    const start = async () => {
        if (!session || controller.current || applying.current) return;
        const job = new AbortController(); controller.current = job;
        const revision = sessionRevision.current;
        const isCurrent = () => controller.current === job && sessionRevision.current === revision && !job.signal.aborted;
        setBusy(true); setError(""); setPhase("preparing");
        try {
            latest.current.assertActive();
            const node = latest.current.host.getNode(session.source.id);
            if (!node) throw Error("原卡片已移除。");
            const source = readPromptOptimizationSource(node, latest.current.host.getNodes());
            setSession({ source, instruction: session.instruction, directions: session.directions });
            const result = await requestPromptOptimization({ host: latest.current.host, productId, source,
                instruction: session.instruction.trim(), directions: session.directions, signal: job.signal, assertActive: () => latest.current.assertActive(),
                onPhase: value => { if (isCurrent()) setPhase(value); } });
            job.signal.throwIfAborted();
            if (isCurrent()) setSession({ source, instruction: session.instruction, directions: session.directions, result, resultModel: defaultModel });
        } catch (error) { if (isCurrent()) { setError(errorText(error)); setPhase(null); } }
        finally { if (controller.current === job) { controller.current = null; setBusy(false); } }
    };
    const apply = async () => {
        if (!session?.result || applying.current || controller.current) return;
        const revision = sessionRevision.current;
        applying.current = true; setSaving(true); setError(""); setPhase("applying");
        try {
            latest.current.assertActive();
            if (!applied.current) {
                latest.current.host.applyOps(promptOptimizationOps(session.source, session.result, latest.current.host.getNodes()));
                applied.current = true;
            }
            const saved = await saveProductCanvas(productId);
            if (!saved.persisted) throw Error("原卡片已更新，但保存尚未确认。请点击“重试保存”，保留当前页面。");
            if (sessionRevision.current === revision) { setSession(null); setPhase(null); void message.success("提示词已更新，可通过撤销恢复原文"); }
        } catch (error) { if (sessionRevision.current === revision) { setError(errorText(error)); setPhase(null); } }
        finally { applying.current = false; setSaving(false); }
    };

    const optimizationTool = (node: CanvasNodeData): CanvasNodeToolbarItem[] => canOptimizePrompt(node) ? [{
        id: "optimize-prompt", title: "AI优化提示词", label: "AI优化", icon: <Sparkles className="size-4" />, onClick: () => open(node),
    }] : [];
    const dialog = session ? <Modal open={active} centered title="AI优化提示词" width={960} onCancel={close} maskClosable={!saving}
        styles={{ body: { maxHeight: "calc(100dvh - 200px)", overflowY: "auto", padding: "4px 0" } }}
        footer={<div className="flex flex-wrap items-center justify-end gap-2">
            <AppleAntButton disabled={saving} onClick={close}>取消</AppleAntButton>
            {busy ? <AppleAntButton onClick={() => { controller.current?.abort(); controller.current = null; setBusy(false); setPhase("stopped"); }}>取消优化</AppleAntButton>
                : <AppleAntButton icon={<Sparkles className="size-4" />} disabled={saving || applied.current} onClick={() => void start()}>
                    {session.result ? "重新优化" : "开始优化"}</AppleAntButton>}
            <AppleAntButton type="primary" loading={saving} disabled={busy || !session.result || stale} onClick={() => void apply()}>
                {applied.current ? "重试保存" : "应用到原卡片"}</AppleAntButton>
        </div>}>
        <div className="mb-4 flex min-w-0 flex-wrap items-center justify-between gap-2 text-sm">
            <span className="min-w-0 truncate font-medium" title={session.source.title}>{session.source.title}</span>
            <span className="text-xs opacity-65">文本模型：{modelLabel(session.resultModel || defaultModel)}</span>
        </div>
        {session.source.problems.length ? <div role="status" className="mb-4 border-l-2 border-red-500 pl-3 text-xs leading-6 text-red-600 dark:text-red-400">
            {session.source.problems.join(" ")} 商品资料变更导致的失效不会被清除；适配新资料请在参数卡使用“AI写提示词”。
        </div> : null}
        <details className={styles.directionBox}>
            <summary className={styles.directionSummary}>
                <ChevronDown aria-hidden className="size-4 shrink-0" />
                <span className="shrink-0 font-medium">快捷优化方向</span>
                <span className="min-w-0 truncate text-xs opacity-65">
                    {session.directions.length ? OPTIMIZATION_DIRECTIONS.filter(option => session.directions.includes(option.id))
                        .map(option => option.label).join("、") : "未选择"}
                </span>
                {session.directions.length ? <span className="shrink-0 text-xs opacity-65">{session.directions.length} 项</span> : null}
            </summary>
            <div role="group" aria-label="快捷优化方向" className={styles.directions}>
                {OPTIMIZATION_DIRECTIONS.map(option => <Tooltip key={option.id} title={option.instruction}
                    trigger={["hover", "focus"]} placement="top" mouseEnterDelay={0.25}>
                    <label className={styles.choice}>
                    <input type="checkbox" checked={session.directions.includes(option.id)} disabled={busy || saving || applied.current}
                        onChange={event => {
                            const directions = normalizeOptimizationDirections(event.target.checked ? [...session.directions, option.id]
                                : session.directions.filter(id => id !== option.id));
                            setSession({ ...session, directions, result: undefined, resultModel: undefined }); setError(""); setPhase(null);
                        }} />
                    <span>{option.label}</span>
                    </label>
                </Tooltip>)}
            </div>
            {session.directions.length ? <div className="pb-2 text-right">
                <Button size="small" type="text" disabled={busy || saving || applied.current} onClick={() => {
                    setSession({ ...session, directions: [], result: undefined, resultModel: undefined }); setError(""); setPhase(null);
                }}>清空已选</Button>
            </div> : null}
        </details>
        <label className="mb-4 block text-sm">
            <span className="mb-2 block font-medium">优化要求（选填）</span>
            <Input.TextArea aria-label="优化要求" value={session.instruction} maxLength={3000} autoSize={{ minRows: 2, maxRows: 4 }}
                className={"guan-scroll-field " + (styles.field || "")} disabled={busy || saving || applied.current} placeholder="例如：精简重复描述，强化构图，保持商品和尺寸不变"
                onChange={event => { setSession({ ...session, instruction: event.target.value, result: undefined, resultModel: undefined }); setError(""); setPhase(null); }} />
        </label>
        {phase ? <TextTaskStatus phase={phase} kind="optimization" /> : null}
        {stale ? <p role="alert" className="mb-3 text-sm text-red-600 dark:text-red-400">原文或关联商品资料已更改，请重新优化后再应用。</p> : null}
        {error ? <p role="alert" className="mb-3 whitespace-pre-wrap text-sm text-red-600 dark:text-red-400">{error}</p> : null}
        <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2">
            <PromptComparison title="原提示词" kind={session.source.kind} text={session.source.text}
                chinese={session.source.chinese} english={session.source.english} alignment={session.source.alignment} ready={session.source.englishCurrent} />
            <PromptComparison title="优化结果" kind={session.source.kind} text={session.result?.text}
                chinese={session.result?.chinese} english={session.result?.english} alignment={session.result?.alignment} />
        </div>
        {session.result?.changes.length ? <ul className="mt-4 list-disc space-y-1 pl-5 text-xs leading-6 opacity-75">
            {session.result.changes.map((change, index) => <li key={index}>{change}</li>)}
        </ul> : null}
    </Modal> : null;
    return { optimizationTool, optimizationDialog: <AnimatePresence>{dialog}</AnimatePresence> };
}

function PromptComparison({ title, kind, text, chinese, english, alignment, ready = true }: {
    title: string; kind: PromptOptimizationSource["kind"]; text?: string; chinese?: string; english?: string;
    alignment?: BilingualAlignment; ready?: boolean;
}) {
    const bilingual = useBilingualPromptSync({ chinese: chinese || "", english: english || "", alignment, ready });
    return <div className="min-w-0">
        <div className="mb-2 text-sm font-medium">{title}</div>
        {kind === "bilingual" ? <div className={styles.stack}>
            <label><span className={styles.language}>中文</span>
                <BilingualPromptField link={bilingual} language="chinese" className={"guan-scroll-field " + (styles.field || "")} aria-label={`${title} · 中文`} readOnly value={chinese || ""} rows={7} /></label>
            <label><span className={styles.language}>英文</span>
                <BilingualPromptField link={bilingual} language="english" className={"guan-scroll-field " + (styles.field || "")} aria-label={`${title} · 英文`} readOnly value={english || ""} rows={7} /></label>
        </div> : <Input.TextArea className={"guan-scroll-field " + (styles.field || "")} aria-label={title} readOnly value={text || ""} rows={12} />}
    </div>;
}
