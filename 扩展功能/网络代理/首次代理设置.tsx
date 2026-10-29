import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import "./首次代理设置.css";

type ProxyStatus = { configured: boolean };
type ProxyHost = {
  status(): Promise<ProxyStatus>;
  configure(value: { configText: string; subscriptionUrl: string; fileName: string }): Promise<unknown>;
};

const DISMISSED_KEY = "guan-network-proxy-first-run-dismissed";
const MAX_CONFIG_BYTES = 10 * 1024 * 1024;

function host() {
  return (window as unknown as { __guanNetworkProxyHost?: ProxyHost }).__guanNetworkProxyHost;
}

export function FirstRunProxySetup({ active }: { active: boolean }) {
  const [open, setOpen] = useState(false);
  const [subscriptionUrl, setSubscriptionUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!active) return;
    let current = true;
    let dismissed = false;
    try { dismissed = sessionStorage.getItem(DISMISSED_KEY) === "true"; } catch { /* session storage is optional */ }
    if (dismissed) return;
    void host()?.status().then(status => {
      if (current && !status.configured) setOpen(true);
    }).catch(() => {});
    return () => { current = false; };
  }, [active]);

  const dismiss = () => {
    try { sessionStorage.setItem(DISMISSED_KEY, "true"); } catch { /* the dialog still closes for this render */ }
    setOpen(false);
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const port = host();
    if (!port || busy) return;
    setBusy(true);
    setError("");
    try {
      if (file && file.size > MAX_CONFIG_BYTES) throw new Error("配置文件超过 10 MiB。");
      const configText = file ? await file.text() : "";
      if (!configText.trim() && !subscriptionUrl.trim()) throw new Error("请选择配置文件或填写订阅地址。");
      await port.configure({ configText, subscriptionUrl: configText ? "" : subscriptionUrl.trim(), fileName: file?.name || "" });
      dismiss();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "代理配置未保存，请检查文件或订阅地址后重试。");
    } finally {
      setBusy(false);
    }
  };

  if (!active || !open) return null;
  return createPortal(
    <div className="guan-proxy-first-run" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !busy) dismiss(); }} onKeyDown={event => { if (event.key === "Escape" && !busy) dismiss(); }}>
      <section className="guan-proxy-first-run__panel" role="dialog" aria-modal="true" aria-labelledby="guan-proxy-first-run-title" aria-describedby="guan-proxy-first-run-description">
        <h2 id="guan-proxy-first-run-title" className="text-base font-semibold">设置网络代理</h2>
        <p id="guan-proxy-first-run-description" className="guan-proxy-first-run__description">添加订阅地址或 Mihomo / Clash 配置文件。配置会加密保存在本机 SQLite 工作区，软件更新后继续使用。</p>
        <form onSubmit={event => void save(event)}>
          <div className="guan-proxy-first-run__field">
            <label htmlFor="guan-proxy-first-run-input">代理配置文件或远端订阅地址</label>
            <span className="guan-proxy-first-run__input-row">
              <input id="guan-proxy-first-run-input" className="guan-proxy-first-run__input" type="text" inputMode="url" autoComplete="off" spellCheck={false} autoFocus disabled={busy || !!file} placeholder="https://example.com/your-subscription" value={file?.name || subscriptionUrl} onChange={event => setSubscriptionUrl(event.currentTarget.value)} />
              <button type="button" className="guan-proxy-first-run__file" disabled={busy} onClick={() => file ? setFile(null) : fileRef.current?.click()}>{file ? "移除文件" : "选择文件"}</button>
              <input ref={fileRef} type="file" accept=".yaml,.yml,.txt,text/plain,application/yaml" hidden onChange={event => { setFile(event.currentTarget.files?.[0] || null); setSubscriptionUrl(""); setError(""); if (fileRef.current) fileRef.current.value = ""; }} />
            </span>
          </div>
          <p className="guan-proxy-first-run__hint">{file ? `已选择：${file.name}` : "也可以稍后在设置面板中添加代理配置。"}</p>
          <p className="guan-proxy-first-run__error" role="alert">{error}</p>
          <div className="guan-proxy-first-run__actions">
            <button type="button" disabled={busy} onClick={dismiss}>稍后设置</button>
            <button type="submit" className="guan-proxy-first-run__save" disabled={busy}>{busy ? "正在验证并保存…" : "保存并启动代理"}</button>
          </div>
        </form>
      </section>
    </div>,
    document.body,
  );
}
