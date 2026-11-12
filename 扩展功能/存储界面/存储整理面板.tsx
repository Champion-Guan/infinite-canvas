import { Alert, Button, InputNumber, Switch } from "antd";
import { Clock3, HardDrive, ScanSearch, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { compactStorage, executeStorageCleanup, previewStorageCleanup, readMaintenanceStatus, saveRetentionPolicy, startAutomaticStorageCleanup,
    type CleanupPreview, type RetentionPolicy } from "./存储整理操作";

const size = (bytes: number) => bytes < 1024 ** 2 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`;
export function AutomaticStorageCleanup() {
    useEffect(() => startAutomaticStorageCleanup(), []);
    return null;
}
export function StorageMaintenancePanel({ active, onCleaned }: { active: boolean; onCleaned: () => void }) {
    const [status, setStatus] = useState<Awaited<ReturnType<typeof readMaintenanceStatus>> | null>(null);
    const [days, setDays] = useState(90);
    const [busy, setBusy] = useState("");
    const [preview, setPreview] = useState<CleanupPreview | null>(null);
    const [compacting, setCompacting] = useState(false);
    const [error, setError] = useState(""), [notice, setNotice] = useState("");
    const mounted = useRef(false), busyRef = useRef(false);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    useEffect(() => {
        if (!active) return;
        let cancelled = false;
        readMaintenanceStatus().then(value => { if (!cancelled) { setStatus(value); setDays(value.policy.days); } },
            reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : "整理设置读取失败。"); });
        return () => { cancelled = true; };
    }, [active]);
    const run = async (label: string, action: () => Promise<void>) => {
        if (busyRef.current) return;
        busyRef.current = true; setBusy(label); setError(""); setNotice("");
        try { await action(); }
        catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : "存储整理未完成。"); }
        finally { busyRef.current = false; if (mounted.current) setBusy(""); }
    };
    const configure = (policy: RetentionPolicy) => void run("保存策略", async () => {
        const value = await saveRetentionPolicy(policy);
        if (mounted.current) { setStatus(current => ({ ...current, ...value } as Awaited<ReturnType<typeof readMaintenanceStatus>>)); setDays(value.policy.days); setPreview(null); }
    });
    const scan = (mode: "expired" | "organize") => void run("扫描", async () => {
        setCompacting(false); setPreview(null);
        const value = await previewStorageCleanup(mode);
        if (mounted.current) setPreview(value);
    });
    const clean = () => preview && void run("清理", async () => {
        const result = await executeStorageCleanup(preview.id);
        const current = await readMaintenanceStatus();
        if (mounted.current) { setStatus(current); setPreview(null); setNotice(`已整理 ${size(result.bytes)} 内容，清理 ${result.recycled || 0} 项到期回收记录。`); onCleaned(); }
    });
    const count = preview ? preview.fragments + preview.media + preview.tasks + preview.recycled : 0;
    const compact = () => void run("释放空间", async () => {
        const result = await compactStorage(), current = await readMaintenanceStatus();
        if (mounted.current) { setStatus(current); setCompacting(false); setPreview(null); setNotice(`数据库文件减少 ${size(result.bytes)}，画布和文件均保留。`); onCleaned(); }
    });
    return <section className="rounded-lg border border-stone-200 p-4 dark:border-stone-800" aria-label="自动清理与空间整理" aria-busy={!!busy}>
        <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-semibold"><Clock3 className="size-4" />自动清理</div>
            {status ? <Switch aria-label="开启自动清理" checked={status.policy.enabled} loading={busy === "保存策略"} disabled={!!busy}
                onChange={enabled => configure({ ...status.policy, enabled })} /> : <span className="inline-block h-[22px] w-11 animate-pulse rounded-full bg-stone-200 motion-reduce:animate-none dark:bg-stone-700" aria-label="正在读取自动清理设置" />}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <span>闲置内容保留</span>
            <InputNumber aria-label="闲置内容保留天数" min={7} max={365} precision={0} value={days} disabled={!status || !!busy} onChange={value => setDays(value ?? 90)} />
            <span>天</span>
            {status && days !== status.policy.days ? <Button size="small" disabled={!!busy} onClick={() => configure({ ...status.policy, days })}>保存</Button> : null}
        </div>
        <p className="mb-0 mt-2 text-xs leading-5 text-stone-500">画布与保留素材持续保护。自动清理到期的产品及 Excel 回收记录、闲置文件、旧版保存记录和已保存结果的恢复文件；待恢复任务保留。</p>
        <div className="mt-3 flex flex-wrap gap-2">
            <Button icon={<ScanSearch className="size-4" />} loading={busy === "扫描"} disabled={!status || !!busy} onClick={() => scan("expired")}>扫描到期内容</Button>
            <Button icon={<HardDrive className="size-4" />} disabled={!status || !!busy} onClick={() => scan("organize")}>存量空间整理</Button>
        </div>
        {status && status.reusableBytes >= 1024 ** 2 ? <div className="mt-3 border-t border-stone-200 pt-3 text-xs dark:border-stone-800">
            <div className="flex flex-wrap items-center justify-between gap-2"><span>可复用的内部空间：{size(status.reusableBytes)}</span><Button size="small" disabled={!!busy} onClick={() => { setPreview(null); setCompacting(true); }}>释放到磁盘</Button></div>
            {compacting ? <div className="mt-2"><p className="leading-5 text-stone-500">整理数据库内部空闲空间，画布和文件保留。期间本机保存会排队，需要额外临时磁盘空间。</p><div className="flex gap-2"><Button loading={busy === "释放空间"} disabled={!!busy} onClick={compact}>确认释放空间</Button><Button disabled={!!busy} onClick={() => setCompacting(false)}>取消</Button></div></div> : null}
        </div> : null}
        {preview ? <div className="mt-3 border-t border-stone-200 pt-3 dark:border-stone-800">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm font-medium"><span>{preview.mode === "organize" ? "存量整理预览" : "到期清理预览"}</span><span>{size(preview.bytes)} 内容</span></div>
            <dl className="mb-3 mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 text-xs text-stone-500">
                <dt>不再使用的旧版保存记录</dt><dd>{size(preview.fragmentBytes)}</dd>
                <dt>暂时未使用的文件</dt><dd>{size(preview.mediaBytes)}</dd>
                <dt>已保存结果的恢复文件</dt><dd>{size(preview.taskBytes)}</dd>
                <dt>到期产品及 Excel 回收记录</dt><dd>{preview.recycled} 项</dd>
                <dt>受保护的待恢复任务</dt><dd>{preview.protectedTasks} 个</dd>
            </dl>
            {preview.mode === "organize" ? <p className="text-xs leading-5 text-stone-500">本次包含尚未满保留天数的闲置文件、旧版保存记录和已保存结果的恢复文件。画布结果保留；清理的恢复文件与回收记录无法找回。</p> : null}
            <div className="flex gap-2"><Button danger icon={<Trash2 className="size-4" />} disabled={!count || !!busy} loading={busy === "清理"} onClick={clean}>确认清理</Button><Button disabled={!!busy} onClick={() => setPreview(null)}>取消</Button></div>
        </div> : null}
        {status?.lastRun ? <div className="mt-3 text-xs leading-5 text-stone-500" role="status">最近整理：{new Date(status.lastRun.completedAt).toLocaleString()} · {size(status.lastRun.bytes)}</div> : null}
        {status?.automaticError ? <Alert className="mt-3" type="warning" showIcon message="最近自动整理未完成" description={status.automaticError} /> : null}
        {notice ? <Alert className="mt-3" type="success" showIcon message={notice} /> : null}
        {error ? <Alert className="mt-3" type="error" showIcon message={error} /> : null}
        <p className="mb-0 mt-3 text-[11px] leading-5 text-stone-500">工作台打开且空闲时每天检查一次。旧文件从首次确认闲置时起算。清理后的数据库空间供后续保存复用，内容大小不等于立即释放的磁盘空间。</p>
    </section>;
}
