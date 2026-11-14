import { Alert, Button, Progress, Spin } from "antd";
import { Database, HardDrive, Layers3, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { readLocalStorageUsage, type LocalStorageUsage } from "@/services/local-storage-usage";
import { clearRecycleStorage, pendingRecycleCleanup, type RecycleStorageKind } from "./回收站存储操作";
import { StorageMaintenancePanel } from "./存储整理面板";
import { storageCategoryCopy } from "./存储分类文案";

type Category = { name: string; label: string; records: number; files: number; blocks: number; documentBytes: number; mediaBytes: number; bytes: number };
type DetailedUsage = Omit<LocalStorageUsage, "databases"> & {
    databases: Array<{ name: string; version: number; bytes: number; stores: Category[] }>;
    breakdown: {
        format: string; sampledAt: string; currentContentBytes: number; retainedContentBytes: number;
        databaseBytes: number; databaseFileBytes: number; walBytes: number; shmBytes: number;
        indexedMediaBytes: number; mediaDiskBytes: number; unindexedMediaBytes: number; unindexedMediaFiles: number;
    };
};

// 现有设置面板的分区、圆角、间距、按钮及深色样式保留；只更换统计数据与说明。
export function ConfigLocalStorage({ active, settingsOpen }: { active: boolean; settingsOpen: boolean }) {
    const [usage, setUsage] = useState<DetailedUsage | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [recycleAction, setRecycleAction] = useState<RecycleStorageKind | null>(null);
    const [pendingCleanup, setPendingCleanup] = useState<RecycleStorageKind | null>(null);
    const [recycleNotice, setRecycleNotice] = useState("");
    const [recycleError, setRecycleError] = useState("");
    const request = useRef(0);
    const invalidate = useCallback(() => { request.current++; }, []);
    const refresh = useCallback(async () => {
        const id = ++request.current;
        setLoading(true);
        setError("");
        try {
            const [result, pending] = await Promise.all([readLocalStorageUsage() as Promise<DetailedUsage>, pendingRecycleCleanup()]);
            if (result.breakdown?.format !== "guan-sqlite-usage.v1") throw new Error("当前服务尚未支持分类统计，请重启工作台后重试。");
            if (id === request.current) { setUsage(result); setPendingCleanup(pending); }
        } catch (reason) {
            if (id === request.current) setError(reason instanceof Error ? reason.message : "容量读取失败，请稍后刷新。");
        } finally {
            if (id === request.current) setLoading(false);
        }
    }, []);

    useEffect(() => {
        // 每次打开设置刷新一次；切换页签不重新扫描，关闭时忽略过期结果。
        const timer = settingsOpen ? window.setTimeout(() => void refresh(), 0) : undefined;
        return () => { window.clearTimeout(timer); invalidate(); };
    }, [settingsOpen, refresh, invalidate]);

    const clearRecycle = useCallback(async (kind: RecycleStorageKind, label: string) => {
        if (recycleAction) return;
        const question = pendingCleanup === kind ? `继续完成上次确认的${label}删除吗？后来新增或恢复的内容会保留。` : `确定永久删除${label}中的全部内容吗？关联图片、视频、音频等专属本地文件也会删除，共享素材会保留。此操作无法撤销。`;
        if (!window.confirm(question)) return;
        setRecycleAction(kind); setRecycleError(""); setRecycleNotice("");
        try {
            const result = await clearRecycleStorage(kind);
            setRecycleNotice(result.pending ? "回收站记录已删除；刚上传的媒体正在等待保存完成，请稍后点击“重试删除”释放剩余空间。" : "回收站已清空，专属媒体文件已清理，共享素材已保留。");
            await refresh();
        }
        catch (reason) { setRecycleError(reason instanceof Error ? reason.message : "回收站删除失败，请稍后重试。"); }
        finally { setRecycleAction(null); }
    }, [recycleAction, pendingCleanup, refresh]);

    return (
        <div className="space-y-3" aria-busy={loading}>
            <StorageMaintenancePanel active={active} onCleaned={() => void refresh()} />
            <section className="rounded-lg border border-stone-200 p-4 dark:border-stone-800">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <div className="flex items-center gap-2 text-sm font-semibold"><Database className="size-4" />本机存储空间</div>
                        <div className="mt-1 text-xs text-stone-500">产品、图片与设置保存在这台电脑上，实际可用空间以本机磁盘为准。</div>
                    </div>
                    <Button icon={<RefreshCw className="size-4" />} loading={loading} onClick={() => void refresh()}>刷新统计</Button>
                </div>
                {error ? <Alert className="mt-4" type="error" showIcon message="容量读取失败" description={`${error}${usage ? " 下方保留上次结果，不代表当前容量。" : ""}`} /> : null}
                {!usage && loading ? <div className="flex min-h-48 items-center justify-center"><Spin /></div> : null}
                {usage ? (
                    <>
                        <div className="mt-4 grid gap-3 sm:grid-cols-3">
                            <StorageMetric icon={<Database className="size-4" />} label="正在保留的内容" value={formatBytes(usage.breakdown.currentContentBytes)} hint="当前画布、素材与任务记录的内容大小" />
                            <StorageMetric icon={<HardDrive className="size-4" />} label="磁盘实际占用" value={formatBytes(usage.usage)} hint="包含保存文件与工作台内部占用，不含备份" />
                            <StorageMetric icon={<Layers3 className="size-4" />} label="旧记录与闲置文件" value={formatBytes(usage.breakdown.retainedContentBytes)} hint="可扫描核对，实际能清理的空间以预览为准" />
                        </div>
                        <div className="mt-3 text-[11px] leading-5 text-stone-500" role="status">
                            统计时间：{new Date(usage.breakdown.sampledAt).toLocaleString()}。内容大小与磁盘占用是两种统计方式，请勿相加。
                        </div>
                    </>
                ) : null}
            </section>
            {usage?.databases.map(database => (
                <section key={database.name} className="overflow-hidden rounded-lg border border-stone-200 dark:border-stone-800">
                    <div className="flex items-center justify-between gap-3 border-b border-stone-200 px-4 py-3 dark:border-stone-800">
                        <div className="min-w-0"><div className="text-sm font-semibold">空间用在哪里</div><div className="mt-0.5 text-[11px] text-stone-500">容量已去除重复占用；每类标明保留用途与清理影响。</div></div>
                        <div className="shrink-0 text-sm font-medium tabular-nums">{formatBytes(database.bytes)}</div>
                    </div>
                    <div className="divide-y divide-stone-200 dark:divide-stone-800">
                        {database.stores.map(store => { const copy = storageCategoryCopy(store.name, store.label); return (
                            <div key={store.name} className="px-4 py-3">
                                <div className="flex items-start justify-between gap-4 text-sm">
                                    <div className="min-w-0"><div className="flex flex-wrap items-center gap-2 font-medium"><span>{copy.label}</span><span className="text-[11px] font-normal text-stone-500">{copy.status}</span>{isRecycleCategory(store.name) ? <Button size="small" danger loading={recycleAction === store.name} disabled={!!recycleAction || store.bytes === 0 && store.records === 0 && pendingCleanup !== store.name} onClick={() => void clearRecycle(store.name as RecycleStorageKind, copy.label)}>{pendingCleanup === store.name ? "重试删除" : "清空"}</Button> : null}</div><div className="mt-1 text-xs leading-5 text-stone-500">{copy.detail}</div>{countLabel(store) ? <div className="mt-0.5 text-[11px] text-stone-500">{countLabel(store)}</div> : null}</div>
                                    <div className="shrink-0 text-right font-medium tabular-nums">{formatBytes(store.bytes)}</div>
                                </div>
                                <Progress className="!mb-0 !mt-1" percent={database.bytes ? Math.min(100, store.bytes / database.bytes * 100) : 0} showInfo={false} size="small" aria-label={`${copy.label}容量占比`} />
                            </div>
                        ); })}
                    </div>
                    {recycleNotice ? <Alert className="m-4" type="info" showIcon message={recycleNotice} /> : null}
                    {recycleError ? <Alert className="m-4" type="error" showIcon message="回收站删除失败" description={recycleError} /> : null}
                </section>
            ))}
            {usage ? (
                <details className="rounded-lg border border-stone-200 p-4 text-xs dark:border-stone-800">
                    <summary className="cursor-pointer font-semibold">技术明细</summary>
                    <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 text-stone-500">
                        <dt>数据库文件</dt><dd className="text-right tabular-nums">{formatBytes(usage.breakdown.databaseFileBytes)}</dd>
                        <dt>写入日志（WAL）</dt><dd className="text-right tabular-nums">{formatBytes(usage.breakdown.walBytes)}</dd>
                        <dt>共享内存文件（SHM）</dt><dd className="text-right tabular-nums">{formatBytes(usage.breakdown.shmBytes)}</dd>
                        <dt>媒体文件（已索引）</dt><dd className="text-right tabular-nums">{formatBytes(usage.breakdown.indexedMediaBytes)}</dd>
                        <dt>媒体文件（未索引/暂存）</dt><dd className="text-right tabular-nums">{formatBytes(usage.breakdown.unindexedMediaBytes)}</dd>
                    </dl>
                    <p className="mb-0 mt-3 text-[11px] leading-5 text-stone-500">数据库内部空闲空间供后续保存复用。文件数按内容去重；旧存储块数量不是用户文件数，统计不含备份。</p>
                </details>
            ) : null}
        </div>
    );
}

function isRecycleCategory(value: string): value is RecycleStorageKind {
    return value === "product_recycle" || value === "workbook_recycle";
}

function countLabel(store: Category) {
    if (["history", "retained_media", "other", "media_index"].includes(store.name)) return "";
    if (store.name === "product_recycle" || store.name === "workbook_recycle") return `${store.records} 项可恢复内容`;
    if (store.files) return `${store.files} 个文件`;
    return "";
}
function StorageMetric({ icon, label, value, hint }: { icon: ReactNode; label: string; value: string; hint: string }) {
    return <div className="rounded-lg bg-stone-100/70 p-3 dark:bg-stone-900/70"><div className="flex items-center gap-2 text-xs text-stone-500">{icon}{label}</div><div className="mt-2 text-xl font-semibold tabular-nums">{value}</div><div className="mt-1 text-[11px] text-stone-500">{hint}</div></div>;
}
function formatBytes(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
