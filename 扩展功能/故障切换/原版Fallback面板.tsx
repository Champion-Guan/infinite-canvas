import { useEffect, useId, useRef, useState } from "react";
import { Settings } from "lucide-react";
import type { ModelCapability, ModelChannel, ChannelModel } from "@/stores/use-config-store";
import { useConfigStore } from "@/stores/use-config-store";
import { capabilities, editFallback, reconcileFallback } from "./原版策略.mjs";
import { fallbackHost, type FallbackSnapshot, type FallbackConfig } from "./浏览器状态";
import { ModelOrderPanel } from "./模型排序面板";
import "./原版Fallback.css";

// 迁自旧版 makeFallbackPanel：保留原DOM层级、类名、文案与控件顺序。
// 原DOM猴子补丁改为React组件；操作以SQLite ACK为准，不乐观宣称保存成功。
export function OriginalFallbackPanel() {
    const config = useConfigStore(state => state.config);
    const [stored, setStored] = useState<FallbackSnapshot>(() => fallbackHost().snapshot());
    const [active, setActive] = useState<ModelCapability>("image");
    const [busy, setBusy] = useState(true);
    const [error, setError] = useState("");
    const [sorting, setSorting] = useState<ModelCapability | null>(null);
    const live = useRef(false), operation = useRef(false), prefix = useId();
    useEffect(() => {
        live.current = true;
        const host = fallbackHost(), unsubscribe = host.subscribe(() => { if (live.current) setStored(host.snapshot()); });
        void host.read().catch(() => { if (live.current) setError("Fallback读取失败，原配置保留，请重新打开面板。"); })
            .finally(() => { if (live.current) setBusy(false); });
        return () => { live.current = false; unsubscribe(); };
    }, []);
    type DisplayEntry = FallbackConfig["capabilities"]["image"]["entries"][number] & { profile: ModelChannel; model: ChannelModel & { price?: string | number } };
    const data = reconcileFallback(stored.value, config.channels) as { enabled: boolean; capabilities: Record<ModelCapability, { enabled: boolean; modelOrder?: string[]; entries: DisplayEntry[] }> };
    const change = async (action: Parameters<typeof editFallback>[2], revision = stored.revision): Promise<boolean> => {
        if (operation.current || busy) return false;
        operation.current = true; setBusy(true); setError("");
        try {
            const next = editFallback(stored.value, config.channels, action) as FallbackConfig;
            await fallbackHost().save(next, revision);
            return true;
        }
        catch { if (live.current) setError("Fallback保存未确认。已尝试重读实际配置；请检查后再操作。"); return false; }
        finally { operation.current = false; if (live.current) setBusy(false); }
    };
    return <div className="guan-fallback guan-apple-enter"><div className="local-canvas-settings-tabpanel" data-local-canvas-panel="fallback" aria-busy={busy}>
        <section className="local-canvas-settings-card guan-motion-panel">
            <h4>失败自动切换</h4>
            <p>按渠道模型能力分别配置生图、视频、文本和音频的 Fallback。名称、协议、地址和模型跟随渠道更新。</p>
            <div className="local-canvas-fallback-group-head local-canvas-fallback-global">
                <input id={prefix + "-global"} className="local-canvas-fallback-master" type="checkbox" checked={data.enabled} disabled={busy} onChange={event => void change({ type: "global", enabled: event.target.checked })} />
                <label htmlFor={prefix + "-global"}>启用 Fallback 自动切换</label><small>总开关</small>
            </div>
            <div className="local-canvas-fallback-switch" data-canvas-fallback-switch>
                {capabilities.map(({ key, label }) => <button key={key} type="button" className={`guan-apple-action guan-apple-press ${key === active ? "is-active" : ""}`} aria-pressed={key === active} onClick={() => setActive(key as ModelCapability)}>{label}</button>)}
            </div>
            <div data-canvas-fallback-groups>
                {capabilities.map(({ key, label }) => {
                    const group = data.capabilities[key as ModelCapability];
                    return <div key={key} className="local-canvas-fallback-group" data-fallback-key={key} hidden={key !== active}>
                        <div className="local-canvas-fallback-group-head">
                            <input id={prefix + "-" + key} className="local-canvas-fallback-master" type="checkbox" checked={group.enabled && group.entries.some(entry => entry.enabled)} disabled={busy} onChange={event => void change({ type: "group", capability: key, enabled: event.target.checked })} />
                            <label htmlFor={prefix + "-" + key}>启用{label} Fallback 自动切换</label>
                            <button type="button" data-fallback-reset disabled={busy} onClick={() => void change({ type: "reset", capability: key })}>恢复默认排序</button>
                            <button type="button" aria-label={`自定义${label}模型默认排序`} title="自定义模型默认排序（由新到旧）" disabled={busy} onClick={() => setSorting(key as ModelCapability)}><Settings size={14} /></button>
                            <small>{group.entries.length} 个可用模型</small>
                        </div>
                        <div className="local-canvas-fallback-list">
                            {group.entries.length ? group.entries.map((entry, index) => {
                                const id = prefix + "-" + key + "-" + index;
                                return <div className="local-canvas-fallback-row" key={JSON.stringify([entry.profileId, entry.modelName])}>
                                    <input id={id} type="checkbox" checked={entry.enabled} disabled={busy} onChange={event => void change({ type: "entry", capability: key, profileId: entry.profileId, modelName: entry.modelName, enabled: event.target.checked })} />
                                    <label htmlFor={id}>{entry.profile.name || entry.profile.id} · {entry.modelName || entry.model.name || "未命名模型"}
                                        <small>{entry.profile.apiFormat === "gemini" ? "Gemini" : "OpenAI"} · {entry.profile.baseUrl || "未设置地址"}{entry.model.price == null ? "" : " · 价格 " + entry.model.price}</small>
                                    </label>
                                    <button type="button" data-up aria-label="上移模型" disabled={busy || index === 0} onClick={() => void change({ type: "move", capability: key, index, direction: -1 })}>↑</button>
                                    <button type="button" data-down aria-label="下移模型" disabled={busy || index === group.entries.length - 1} onClick={() => void change({ type: "move", capability: key, index, direction: 1 })}>↓</button>
                                </div>;
                            }) : "暂无匹配此能力的渠道模型。"}
                        </div>
                    </div>;
                })}
            </div>
            <div className="local-canvas-settings-note">总开关关闭时不会执行任何 Fallback；每种能力还可独立保存渠道勾选和切换顺序。</div>
            {error ? <div className="local-canvas-settings-note" role="alert">{error}</div> : null}
        </section>
    </div>{sorting ? <ModelOrderPanel key={sorting} label={capabilities.find(item => item.key === sorting)!.label}
        entries={data.capabilities[sorting].entries} preferred={data.capabilities[sorting].modelOrder}
        revision={stored.revision} busy={busy} onClose={() => setSorting(null)}
        onSave={(order, revision) => change({ type: "model-order", capability: sorting, order }, revision)} /> : null}</div>;
}
