import { Component, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Check, Copy, RotateCcw } from "lucide-react";
import { useLocation, useNavigate, useRouteError } from "react-router-dom";
import { diagnosticText, interfaceDiagnostic, type InterfaceDiagnostic } from "./界面异常说明";
import { finishStartupScreen } from "../本机存储/启动画面交接.mjs";

type RecoveryAction = { onRetry: () => void; retryHref?: never } | { retryHref: string; onRetry?: never };
type RecoveryViewProps = RecoveryAction & { diagnostic: InterfaceDiagnostic; previewNotice?: string; logoSrc?: string };

export function InterfaceRecoveryView({ diagnostic, onRetry, retryHref, previewNotice, logoSrc = "/guan/首页原样资源/工作台Logo.png" }: RecoveryViewProps) {
    useLayoutEffect(() => { finishStartupScreen(); }, []);
    const [copied, setCopied] = useState(false);
    const [copyFailed, setCopyFailed] = useState(false);
    const details = useRef<HTMLDetailsElement>(null);
    const diagnosticField = useRef<HTMLTextAreaElement>(null);
    const text = diagnosticText(diagnostic);
    const copy = async () => {
        try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setCopyFailed(false);
        } catch {
            setCopied(false);
            setCopyFailed(true);
            if (details.current) details.current.open = true;
            diagnosticField.current?.focus();
            diagnosticField.current?.select();
        }
    };
    const retryClass = "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-foreground px-4 text-sm font-medium text-background outline-none transition-opacity hover:opacity-85 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";
    const retryLabel = <><RotateCcw aria-hidden="true" className="size-4" />重试打开界面</>;
    return (
        <main className="flex min-h-dvh items-center justify-center bg-background px-6 py-12 text-foreground">
            <section aria-labelledby="interface-error-title" className="w-full max-w-lg">
                <div className="mb-8 flex items-center gap-3">
                    <img src={logoSrc} alt="" className="size-9" />
                    <span className="text-lg font-semibold">AI-Workbench</span>
                </div>
                {previewNotice && <p role="status" className="mb-4 text-sm leading-7 text-muted-foreground">{previewNotice}</p>}
                <AlertTriangle aria-hidden="true" className="mb-4 size-7 text-amber-600 dark:text-amber-400" />
                <h1 id="interface-error-title" className="text-xl font-semibold">工作台界面暂时无法显示</h1>
                <p className="mt-3 text-sm leading-7 text-muted-foreground">
                    界面遇到了异常，可以先重试打开。重试不会清空已保存的画布、图片或设置。
                </p>
                <p className="mt-2 text-sm leading-7 text-muted-foreground">
                    最近的编辑是否已保存尚未确认，请先保留本页，不要清理浏览器数据或重复点击生成。
                </p>
                <div className="mt-6 flex flex-wrap gap-3">
                    {retryHref
                        ? <a href={retryHref} style={{ color: "var(--background)" }} className={retryClass}>{retryLabel}</a>
                        : <button type="button" onClick={onRetry} style={{ color: "var(--background)" }} className={retryClass}>{retryLabel}</button>}
                    <button type="button" onClick={() => void copy()}
                        className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-border px-4 text-sm outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                        {copied ? <Check aria-hidden="true" className="size-4" /> : <Copy aria-hidden="true" className="size-4" />}
                        {copied ? "已复制诊断信息" : "复制诊断信息"}
                    </button>
                </div>
                {copyFailed && <p role="status" className="mt-3 text-sm leading-7 text-muted-foreground">
                    浏览器未允许自动复制。诊断信息已展开并选中，请按 Ctrl+C 或 Command+C 复制。
                </p>}
                <p className="mt-4 text-xs leading-6 text-muted-foreground">仍无法打开时，请把诊断信息发送给维护人员。</p>
                <details ref={details} open={copyFailed || undefined} className="mt-6 border-t border-border pt-4 text-xs text-muted-foreground">
                    <summary className="cursor-pointer py-1">诊断信息</summary>
                    <textarea ref={diagnosticField} aria-label="界面诊断信息" readOnly value={text} rows={4}
                        className="guan-scroll-field mt-3 w-full resize-none rounded-md border border-border bg-transparent p-3 font-mono leading-6 outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                </details>
            </section>
        </main>
    );
}

export function RouteInterfaceRecovery() {
    const error = useRouteError();
    const location = useLocation();
    const navigate = useNavigate();
    const [diagnostic] = useState(() => interfaceDiagnostic(error, __APP_VERSION__));
    return <InterfaceRecoveryView diagnostic={diagnostic}
        onRetry={() => {
            if (diagnostic.code === "UI-RESOURCE") { window.location.reload(); return; }
            navigate(location.pathname + location.search + location.hash, { replace: true });
        }} />;
}

export class InterfaceErrorBoundary extends Component<{ children: ReactNode }, { diagnostic: InterfaceDiagnostic | null }> {
    state = { diagnostic: null as InterfaceDiagnostic | null };
    static getDerivedStateFromError(error: unknown) {
        return { diagnostic: interfaceDiagnostic(error, __APP_VERSION__) };
    }
    render() {
        return this.state.diagnostic
            ? <InterfaceRecoveryView diagnostic={this.state.diagnostic} onRetry={() => {
                if (this.state.diagnostic?.code === "UI-RESOURCE") { window.location.reload(); return; }
                this.setState({ diagnostic: null });
            }} />
            : this.props.children;
    }
}
