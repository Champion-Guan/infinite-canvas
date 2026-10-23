import { useCallback, useEffect, useRef, useState } from "react";
import "./原版网络代理.css";

type Status = { configured: boolean; enabled: boolean; running: boolean; configName: string; source: string | null; busy: boolean; activeRequests: number; lastError: string | null };
type ProxyHost = { status(): Promise<Status>; configure(value: { configText: string; subscriptionUrl: string; fileName: string }): Promise<Status>; toggle(enabled: boolean): Promise<Status>; diagnose(): Promise<{ node: string; delay: number }> };
function host() { return (window as unknown as { __guanNetworkProxyHost?: ProxyHost }).__guanNetworkProxyHost; }

// 迁入旧版makeNetworkPanel的真实结构、文案、尺寸与样式；只替换事件/状态出口，不注入DOM。
export function OriginalNetworkProxyPanel() {
    const [status, setStatus] = useState<Status | null>(null);
    const [input, setInput] = useState("");
    const [fileText, setFileText] = useState("");
    const [fileName, setFileName] = useState("");
    const [busy, setBusy] = useState(false);
    const [frozen, setFrozen] = useState(false);
    const [notice, setNotice] = useState("");
    const [error, setError] = useState("");
    const fileRef = useRef<HTMLInputElement>(null);
    const mounted = useRef(false), flight = useRef(false), polling = useRef(false), revision = useRef(0), fileRevision = useRef(0), unlocked = useRef(false);
    const invalidateRequests = useCallback(() => { revision.current++; fileRevision.current++; }, []);
    const refresh = useCallback(async () => {
        const port = host(); if (!port || flight.current || polling.current) return;
        const snapshot = revision.current; polling.current = true;
        try { const next = await port.status(); if (mounted.current && revision.current === snapshot) { setStatus(next); if (!unlocked.current) setFrozen(next.running); } }
        catch { if (mounted.current && revision.current === snapshot) setError("网络代理：状态获取失败"); }
        finally { polling.current = false; }
    }, []);
    useEffect(() => {
        mounted.current = true; void refresh();
        const timer = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 10000);
        return () => { mounted.current = false; invalidateRequests(); window.clearInterval(timer); };
    }, [refresh, invalidateRequests]);
    useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(""), 10000); return () => window.clearTimeout(timer); }, [notice]);
    const act = async (operation: (port: ProxyHost) => Promise<Status>, success: string, clearInput = false) => {
        const port = host(); if (!port || flight.current) return;
        flight.current = true; revision.current++; fileRevision.current++; setBusy(true); setError(""); setNotice("切换中…");
        try {
            const next = await operation(port);
            if (mounted.current) { setStatus(next); unlocked.current = !next.running; setFrozen(next.running); setNotice(success); if (clearInput) { setFileText(""); setFileName(""); setInput(""); } }
        } catch { if (mounted.current) { setNotice(""); setError("代理操作未完成，配置保留。请检查状态、代理核心及端口。"); } }
        finally { flight.current = false; if (mounted.current) { setBusy(false); void refresh(); } }
    };
    const unavailable = !host();
    const state = busy ? "pending" : status?.running ? "active" : status?.lastError ? "error" : "inactive";
    return <div className="guan-network-proxy"><div className="local-canvas-settings-tabpanel local-canvas-proxy-section">
        <section className="local-canvas-settings-card">
            <div className="local-canvas-settings-header"><h4>设置网络代理</h4>
                <label className="local-canvas-settings-toggle"><input data-canvas-proxy-toggle type="checkbox" checked={status?.running === true} disabled={busy || unavailable || !status?.configured} onChange={event => { const enabled = event.currentTarget.checked; void act(port => port.toggle(enabled), enabled ? "代理启动成功" : "代理已停止"); }} />启用网络代理</label>
            </div>
            <div className="local-canvas-proxy-state" data-status={state} role="status" aria-live="polite">{busy ? "网络代理：切换中…" : status?.running ? "网络代理：已启动" : unavailable ? "网络代理：本机端口尚未接入" : "网络代理：未启动"}</div>
            <div className="local-canvas-settings-field"><label htmlFor="guan-network-proxy-input">代理配置文件或远端订阅地址</label>
                <div className="local-canvas-settings-input-row"><input id="guan-network-proxy-input" className="local-canvas-settings-input" data-canvas-proxy-input type="text" placeholder="https://example.com/your-subscription" autoComplete="off" spellCheck={false} disabled={busy || frozen || unavailable} value={fileName || input} onChange={event => { setInput(event.currentTarget.value); setFileText(""); setFileName(""); fileRevision.current++; }} />
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
