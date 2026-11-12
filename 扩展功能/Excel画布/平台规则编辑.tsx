import { useEffect, useId, useRef, useState } from "react";
import { Input, Tooltip } from "antd";
import { AnimatePresence } from "motion/react";
import { Pencil, RotateCcw } from "lucide-react";
import type { CanvasNodeContext } from "@/types/canvas-plugin";
import { AppleModal } from "../主题/苹果弹窗";
import { AppleActionButton, AppleAntButton } from "../主题/苹果交互按钮";
import { useProductActive } from "../产品/产品界面边界";
import { defaultProductPlatformRules, productPlatformRules, usesDefaultProductPlatformRules,
    WILDBERRIES_PLATFORM, type ProductParameterMetadata } from "./旧版参数规则";
import { globalPlatformRules } from "./平台规则全局状态";
import { useGlobalPlatformRules } from "./平台规则订阅";

type Session = { platform: string; original: string; draft: string };
export function ProductPlatformRuleEditor({ ctx }: { ctx: CanvasNodeContext }) {
    useGlobalPlatformRules();
    const triggerId = useId(), active = useProductActive(), latest = useRef(ctx);
    latest.current = ctx;
    const metadata = (ctx.node.metadata || {}) as ProductParameterMetadata;
    const rules = productPlatformRules(metadata);
    const [session, setSession] = useState<Session | null>(null), [error, setError] = useState("");
    const [saving, setSaving] = useState(false), flight = useRef(false);
    useEffect(() => {
        if (!active) { setSession(null); setError(""); }
    }, [active]);
    const close = () => { if (!flight.current) { setSession(null); setError(""); } };
    const open = () => {
        const current = latest.current.getNode(ctx.node.id);
        if (!current) return;
        const value = (current.metadata || {}) as ProductParameterMetadata;
        const original = productPlatformRules(value);
        setError(""); setSession({ platform: value.productPlatform || WILDBERRIES_PLATFORM, original, draft: original });
    };
    const save = async () => {
        if (!session || flight.current) return;
        const current = latest.current.getNode(ctx.node.id);
        const value = (current?.metadata || {}) as ProductParameterMetadata;
        if (!current || (value.productPlatform || WILDBERRIES_PLATFORM) !== session.platform) {
            setError("原参数卡或上架平台已更改，请重新打开编辑。"); return;
        }
        if (productPlatformRules(value) !== session.original) {
            setError("平台规则已被其他操作修改，请重新打开编辑。"); return;
        }
        flight.current = true; setSaving(true); setError("");
        try {
            await globalPlatformRules.save(session.platform, session.draft, session.original);
            setSession(null);
        } catch (failure) {
            setSession({ ...session, original: globalPlatformRules.read(session.platform) });
            setError(failure instanceof Error ? failure.message : "全局平台规则保存未确认，请重试保存。");
        } finally { flight.current = false; setSaving(false); }
    };
    return <div data-card-panel-anchor data-canvas-no-zoom className="min-w-0 rounded-lg bg-black/[.06] px-2.5 py-2 dark:bg-white/[.08]"
        onMouseDown={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-[10px] font-medium opacity-70">平台规则 · 全局{!usesDefaultProductPlatformRules(metadata) ? " · 自定义" : ""}</span>
            <Tooltip title="编辑平台规则">
                <AppleActionButton id={triggerId} aria-label="编辑平台规则"
                    className="inline-grid size-6 shrink-0 place-items-center rounded hover:bg-black/5 dark:hover:bg-white/10"
                    onClick={() => session ? close() : open()}><Pencil aria-hidden size={13} /></AppleActionButton>
            </Tooltip>
        </div>
        <p className="whitespace-pre-wrap break-words text-[10px] leading-5 opacity-75">{rules || "未填写"}</p>
        <AnimatePresence>{session && active ? <AppleModal key={`${ctx.node.id}:${session.platform}`} title={`${session.platform} · 全局平台规则`}
            triggerId={triggerId} open onCancel={close} width={640} destroyOnHidden maskClosable={!saving} closable={!saving} keyboard={!saving}
            footer={<div className="flex flex-wrap items-center justify-between gap-2">
                <AppleAntButton disabled={saving} icon={<RotateCcw size={14} aria-hidden />} onClick={() => {
                    setError(""); setSession({ ...session, draft: defaultProductPlatformRules(session.platform) });
                }}>恢复默认</AppleAntButton>
                <div className="flex gap-2"><AppleAntButton disabled={saving} onClick={close}>取消</AppleAntButton>
                    <AppleAntButton type="primary" loading={saving} onClick={save}>保存</AppleAntButton></div>
            </div>}>
            <p className="mb-3 text-sm opacity-65">适用于所有选择 {session.platform} 的产品。</p>
            <Input.TextArea aria-label="平台规则内容" value={session.draft} rows={12} autoFocus disabled={saving}
                className="!resize-y" onChange={event => setSession({ ...session, draft: event.target.value })} />
            {error ? <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p> : null}
        </AppleModal> : null}</AnimatePresence>
    </div>;
}
