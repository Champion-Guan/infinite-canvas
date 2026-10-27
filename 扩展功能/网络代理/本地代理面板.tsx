import { App, Button, Form, Switch } from "antd";
import { Network, Wifi } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useConfigStore } from "@/stores/use-config-store";
import { 本地转发地址, 本地转发请求 } from "./本地转发请求";

type Status = { relayEnabled: boolean };
type Port = { status(): Promise<Status>; toggleRelay(enabled: boolean): Promise<Status> };
const host = () => (window as unknown as { __guanNetworkProxyHost?: Port }).__guanNetworkProxyHost;
export function LocalProxyPanel() {
    const { message } = App.useApp();
    const enabled = useConfigStore(s => s.config.proxyEnabled), update = useConfigStore(s => s.updateConfig);
    const [busy, setBusy] = useState(false), [ready, setReady] = useState(false), [error, setError] = useState("");
    const mounted = useRef(false), flight = useRef(false);
    const apply = useCallback((status: Status) => {
        if (!mounted.current) return;
        if (useConfigStore.getState().config.proxyEnabled !== status.relayEnabled) update("proxyEnabled", status.relayEnabled);
        setReady(true); setError("");
    }, [update]);
    useEffect(() => {
        let active = true; mounted.current = true;
        const port = host();
        if (!port) setError("本地代理：本机服务尚未就绪");
        else void port.status().then(status => { if (active) apply(status); }).catch(() => { if (active) setError("本地代理：状态读取失败"); });
        return () => { active = false; mounted.current = false; };
    }, [apply]);
    const act = async (operation: (port: Port) => Promise<Status>, test = false) => {
        const port = host(); if (!port || flight.current) return;
        flight.current = true; setBusy(true);
        try { const status = await operation(port); apply(status); if (test && mounted.current) void message.success(status.relayEnabled ? "本地代理连接正常" : "本地代理已关闭"); }
        catch { if (mounted.current) setError("本地代理操作未确认，请重新检查状态。"); }
        finally { flight.current = false; if (mounted.current) setBusy(false); }
    };
    return <Form layout="vertical" requiredMark={false}><section className="guan-motion-panel rounded-lg border border-stone-200 p-3 dark:border-stone-800">
        <div className="flex items-start justify-between gap-3"><div className="flex items-center gap-2 text-sm font-semibold"><Network className="size-4" />本地代理</div>
            <Switch aria-label="启用本地代理" checked={enabled} disabled={busy || !ready} onChange={value => void act(port => port.toggleRelay(value))} /></div>
        {enabled && <Button className="guan-apple-action guan-apple-press mt-3" icon={<Wifi className="size-4" />} loading={busy} disabled={!ready} onClick={() => void act(async port => {
                const status = await port.status();
                if (status.relayEnabled) {
                    const response = await 本地转发请求(本地转发地址("https://www.gstatic.com/generate_204"), { signal: AbortSignal.timeout(12000) });
                    if (!response.ok) throw Error("本地转发测试失败");
                }
                return status;
            }, true)}>测试连接</Button>}
        <span className="ml-2 text-xs" style={{ color: error ? "#dc2626" : enabled ? "#22925a" : "#78716c" }} role="status">{error || (ready ? "本地代理状态：" + (enabled ? "已启用" : "未启用") : "本地代理：查询中…")}</span>
    </section></Form>;
}
