import { useCallback, useEffect, useRef, useState } from "react";
import "./原版网络代理.css";
import { 内置网络代理订阅 } from "./内置订阅设置.mjs";
import { useProductActive } from "../产品/产品界面边界";
import { useProxyStatusRefresh } from "./代理状态刷新";

type NodeInfo = { name: string; latencyMs: number | null; testedAt?: number; error?: string | null };
type ResourceUpdate = { autoUpdate: boolean; state: string; checkedAt: number | null; error: string | null; model: string };
type Status = { configured: boolean; enabled: boolean; running: boolean; configName: string; configInput: string; source: string | null; busy: boolean; activeRequests: number; lastError: string | null; currentNode?: NodeInfo | null; delayResults?: NodeInfo[]; live?: { observedAt: number; nodes: NodeInfo[]; activeConnections?: number; error?: string }; smart?: { enabled: boolean; groups: number; modelBundled: boolean; version?: string } | null; resourceUpdate?: ResourceUpdate | null };
type ProxyHost = { status(): Promise<Status>; configure(value: { configText: string; subscriptionUrl: string; fileName: string }): Promise<Status>; toggle(enabled: boolean): Promise<Status>; diagnose(): Promise<Status & { reachable: boolean }>; testAll(): Promise<Status>; checkResources(): Promise<Status>; configureResourceUpdates(enabled: boolean): Promise<Status> };
function host() { return (window as unknown as { __guanNetworkProxyHost?: ProxyHost }).__guanNetworkProxyHost; }

// 迁入旧版makeNetworkPanel的真实结构、文案、尺寸与样式；只替换事件/状态出口，不注入DOM。
export function OriginalNetworkProxyPanel({ active = true }: { active?: boolean }) {
    const productActive = useProductActive();
    const observing = active && productActive;
    const [status, setStatus] = useState<Status | null>(null);
    const [input, setInput] = useState(内置网络代理订阅);
    const [fileText, setFileText] = useState("");
    const [fileName, setFileName] = useState("");
    const [busy, setBusy] = useState(false);
    const [frozen, setFrozen] = useState(false);
    const [notice, setNotice] = useState("");
    const [error, setError] = useState("");
    const [connection, setConnection] = useState("");
    const [refreshedAt, setRefreshedAt] = useState(0), [refreshError, setRefreshError] = useState("");
    const fileRef = useRef<HTMLInputElement>(null);
    const mounted = useRef(false), flight = useRef(false), polling = useRef(false), revision = useRef(0), fileRevision = useRef(0), unlocked = useRef(false);
    const invalidateRequests = useCallback(() => { revision.current++; fileRevision.current++; }, []);
    const refresh = useCallback(async () => {
        const port = host(); if (!port || flight.current || polling.current) return;
        const snapshot = revision.current; polling.current = true;
        try { const next = await port.status(); if (mounted.current && revision.current === snapshot) { setStatus(next); setRefreshedAt(Date.now()); setRefreshError(""); if (!unlocked.current) setFrozen(next.running); } }
        catch { if (mounted.current && revision.current === snapshot) setRefreshError("状态暂时读取失败，保留上次结果，正在自动重试"); }
        finally { polling.current = false; }
    }, []);
    useEffect(() => {
        if (!observing) return;
        mounted.current = true; setBusy(flight.current);
        return () => { mounted.current = false; invalidateRequests(); };
    }, [observing, invalidateRequests]);
    useProxyStatusRefresh(observing, refresh);
    useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(""), 10000); return () => window.clearTimeout(timer); }, [notice]);
    const act = async (operation: (port: ProxyHost) => Promise<Status>, success: string, clearInput = false) => {
        const port = host(); if (!port || flight.current) return;
        flight.current = true; revision.current++; fileRevision.current++; setBusy(true); setError(""); setNotice("切换中…");
        try {
            const next = await operation(port);
            if (mounted.current) { setStatus(next); unlocked.current = !next.running; setFrozen(next.running); setNotice(success); if (clearInput) { setFileText(""); setFileName(""); setInput(next.configInput === 内置网络代理订阅 ? next.configInput : 内置网络代理订阅); } }
        } catch { if (mounted.current) { setNotice(""); setError("代理操作未完成，配置保留。请检查状态、代理核心及端口。"); } }
        finally { flight.current = false; if (mounted.current) { setBusy(false); void refresh(); } }
    };
    const unavailable = !host();
    const displayedInput = frozen && status?.configured ? status.configInput || status.configName : fileName || input;
    const state = busy ? "pending" : status?.running ? "active" : status?.lastError ? "error" : "inactive";
    return <div className="guan-network-proxy"><div className="local-canvas-settings-tabpanel local-canvas-proxy-section">
        <section className="local-canvas-settings-card">
            <div className="local-canvas-settings-header"><h4>设置网络代理</h4>
                <label className="local-canvas-settings-toggle"><input data-canvas-proxy-toggle type="checkbox" checked={status?.enabled === true} disabled={busy || unavailable || !status} onChange={event => { const enabled = event.currentTarget.checked; void act(port => port.toggle(enabled), enabled ? status?.configured ? "代理启动成功" : "已开启，等待配置代理" : "代理已停止"); }} />启用网络代理</label>
            </div>
            <div className="local-canvas-proxy-state" data-status={state} role="status" aria-live="polite">{busy ? "网络代理：切换中…" : status?.running ? "网络代理：已启动" : unavailable ? "网络代理：本机端口尚未接入" : status?.enabled && !status.configured ? "网络代理：已开启，等待配置" : "网络代理：未启动"}</div>
            <div className="local-canvas-settings-note" aria-live="off">{refreshError || `每 5 秒自动刷新${refreshedAt ? ` · 状态更新：${new Date(refreshedAt).toLocaleTimeString()}` : " · 正在读取…"}`}</div>
            {status?.running && <div className="local-canvas-settings-note">
                {status.smart?.enabled && <div>Smart 智能选路：已启用 · {status.smart.groups} 个智能分组{status.smart.modelBundled ? " · 最大 LightGBM 模型" : ""}{status.smart.version ? ` · ${status.smart.version}` : ""}</div>}
                <div>当前活跃节点：{status.live?.error ? "暂时无法读取，正在重试" : status.live?.nodes.length ? status.live.nodes.map(node => `${node.name}${node.latencyMs !== null ? `（核心检测 ${node.latencyMs} ms）` : ""}`).join("、") : "暂无活跃连接，Smart 按请求选路"}</div>
                <div>最近手动测试节点：{status.currentNode?.name || "尚未测试"} · HTTP 实测延迟：{status.currentNode?.latencyMs !== null && status.currentNode?.latencyMs !== undefined ? `${status.currentNode.latencyMs} ms` : status.currentNode?.error || "尚未测试"} · 配置文件：{status.configName || "未配置"}{status.currentNode?.testedAt ? ` · 测试时间：${new Date(status.currentNode.testedAt).toLocaleTimeString()}` : ""}</div>
                <div className="local-canvas-settings-actions"><button type="button" disabled={busy} onClick={() => void act(async port => {
                    const next = await port.diagnose(); if (mounted.current) setConnection(next.reachable ? "外网访问正常（通过网络代理）" : "外网访问失败"); return next;
                }, "网络代理测试完成")}>测试连接</button><button type="button" disabled={busy} onClick={() => void act(port => port.testAll(), "节点延迟测试完成")}>测试所有服务器延迟</button></div>
                <div role="status">{connection}</div>
                {!!status.delayResults?.length && <div style={{ maxHeight: 220, overflowY: "auto" }}>{status.delayResults.map(item => <div key={item.name} style={{ padding: "5px 0" }}>{item.name}：{item.latencyMs ? `${item.latencyMs} ms` : item.error || "不可用"}</div>)}</div>}
            </div>}
            {status?.resourceUpdate && <div className="local-canvas-settings-note">
                <label><input type="checkbox" checked={status.resourceUpdate.autoUpdate} disabled={busy} onChange={event => { const enabled = event.currentTarget.checked; void act(port => port.configureResourceUpdates(enabled), enabled ? "核心与最大模型自动更新已开启" : "自动更新已关闭"); }} />自动更新 Smart 核心与最大 LightGBM 模型</label>
                <div className="local-canvas-settings-actions"><button type="button" disabled={busy} onClick={() => void act(port => port.checkResources(), "资源检查完成")}>检查核心与模型更新</button><span role="status">{status.resourceUpdate.error === "proxy_resource_state_invalid" ? "更新状态异常，已暂停资源更新；当前代理仍可使用" : status.resourceUpdate.state === "pending" ? status.resourceUpdate.autoUpdate ? "已下载，等待代理空闲后应用" : "已下载，开启自动更新后应用" : status.resourceUpdate.state === "checking" || status.resourceUpdate.state === "downloading" ? "正在检查或下载…" : status.resourceUpdate.error ? "资源更新未完成，当前代理保留，将自动重试" : status.resourceUpdate.checkedAt ? `上次检查：${new Date(status.resourceUpdate.checkedAt).toLocaleString()}` : "每天自动检查，首次启动无需下载"}</span></div>
            </div>}
            <div className="local-canvas-settings-field"><label htmlFor="guan-network-proxy-input">代理配置文件或远端订阅地址</label>
                <div className="local-canvas-settings-input-row"><input id="guan-network-proxy-input" className="local-canvas-settings-input" data-canvas-proxy-input type="text" placeholder={内置网络代理订阅} autoComplete="off" spellCheck={false} disabled={busy || frozen || unavailable} value={displayedInput} onChange={event => { setInput(event.currentTarget.value); setFileText(""); setFileName(""); fileRevision.current++; }} />
                    <button type="button" className="local-canvas-settings-file" data-canvas-proxy-file disabled={busy || frozen || unavailable} onClick={() => fileRef.current?.click()}>选择文件</button>
                    <input ref={fileRef} data-canvas-proxy-file-input type="file" accept=".yaml,.yml,.txt,text/plain,application/yaml" hidden onChange={async event => {
                        const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; const snapshot = ++fileRevision.current;
                        if (!file) return;
                        if (file.size > 10 * 1024 * 1024) { setError("代理配置超过10MiB。"); return; }
                        try { const text = await file.text(); if (mounted.current && snapshot === fileRevision.current && !flight.current) { setFileText(text); setFileName(file.name); setInput(""); setError(""); } }
                        catch { if (mounted.current && snapshot === fileRevision.current) setError("配置文件读取失败。"); }
                    }} />
                </div>
            </div>
            <div className="local-canvas-settings-actions"><span className="local-canvas-settings-status" role="status">{notice}</span>
                <button type="button" data-canvas-proxy-unfreeze hidden={!frozen} disabled={busy} onClick={() => { unlocked.current = true; setFrozen(false); }}>取消冻结</button>
                <button type="button" className="primary" data-canvas-proxy-save disabled={busy || frozen || unavailable} onClick={() => {
                    const configText = fileText, subscriptionUrl = fileText ? "" : input.trim(), name = fileName;
                    if (!configText && !subscriptionUrl) { setError("请先上传配置文件或填写订阅地址"); return; }
                    void act(port => port.configure({ configText, subscriptionUrl, fileName: name }), "代理启动成功", true);
                }}>保存并启动代理</button>
            </div>
            <div className="local-canvas-settings-note" data-canvas-proxy-error role="alert">{error || (status?.lastError ? status.running ? "上次操作未确认，当前配置已重新读取，请确认状态后再操作。" : "代理未恢复，请检查配置、核心及端口。" : "")}</div>
        </section>
    </div></div>;
}
