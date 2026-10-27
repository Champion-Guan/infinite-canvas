import { Alert, Button, Progress, Spin } from "antd";
import { Database, HardDrive, Layers3, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { readLocalStorageUsage, type LocalStorageUsage } from "@/services/local-storage-usage";
import { clearRecycleStorage, pendingRecycleCleanup, type RecycleStorageKind } from "./回收站存储操作";

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
export function ConfigLocalStorage({ active }: { active: boolean }) {
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
            const result = await readLocalStorageUsage() as DetailedUsage;
            if (result.breakdown?.format !== "guan-sqlite-usage.v1") throw new Error("当前服务尚未接入 SQLite 分类统计，请完成服务接入后重试。");
            const pending = await pendingRecycleCleanup();
            if (id === request.current) { setUsage(result); setPendingCleanup(pending); }
        } catch (reason) {
            if (id === request.current) setError(reason instanceof Error ? reason.message : "容量读取失败，请稍后刷新。");
        } finally {
            if (id === request.current) setLoading(false);
        }
    }, []);

    useEffect(() => {
        // 页签先完成显示，再开始本机读取；关闭时取消尚未开始的读取及过期结果。
        const timer = active ? window.setTimeout(() => void refresh(), 0) : undefined;
        return () => { window.clearTimeout(timer); invalidate(); };
    }, [active, refresh, invalidate]);

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
            <section className="rounded-lg border border-stone-200 p-4 dark:border-stone-800">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <div className="flex items-center gap-2 text-sm font-semibold"><Database className="size-4" />本机 SQLite 存储</div>
                        <div className="mt-1 text-xs text-stone-500">数据保存在本机数据库和媒体目录，不使用浏览器站点配额，仍受本机磁盘可用空间限制。</div>
                    </div>
                    <Button icon={<RefreshCw className="size-4" />} loading={loading} onClick={() => void refresh()}>刷新统计</Button>
                </div>
                {error ? <Alert className="mt-4" type="error" showIcon message="容量读取失败" description={`${error}${usage ? " 下方保留上次结果，不代表当前容量。" : ""}`} /> : null}
                {!usage && loading ? <div className="flex min-h-48 items-center justify-center"><Spin /></div> : null}
                {usage ? (
                    <>
                        <div className="mt-4 grid gap-3 sm:grid-cols-3">
                            <StorageMetric icon={<Database className="size-4" />} label="当前业务内容" value={formatBytes(usage.breakdown.currentContentBytes)} hint="当前记录及去重后的引用媒体，不含历史分片" />
                            <StorageMetric icon={<HardDrive className="size-4" />} label="本机实际占用（采样）" value={formatBytes(usage.usage)} hint="SQLite、WAL、SHM 和媒体文件长度；不含备份" />
                            <StorageMetric icon={<Layers3 className="size-4" />} label="历史与保留内容" value={formatBytes(usage.breakdown.retainedContentBytes)} hint="旧代/未发布分片和当前未引用媒体；不会自动清理" />
                        </div>
                        <div className="mt-3 text-[11px] leading-5 text-stone-500" role="status">
                            统计时间：{new Date(usage.breakdown.sampledAt).toLocaleString()}。分类容量为数据正文与媒体大小，不等于 SQLite 文件大小，不能与实际占用再次相加。
                        </div>
                    </>
                ) : null}
            </section>
            {usage?.databases.map(database => (
                <section key={database.name} className="overflow-hidden rounded-lg border border-stone-200 dark:border-stone-800">
                    <div className="flex items-center justify-between gap-3 border-b border-stone-200 px-4 py-3 dark:border-stone-800">
                        <div className="min-w-0"><div className="text-sm font-semibold">内容分类</div><div className="mt-0.5 text-[11px] text-stone-500">容量按存储块去重，共享部分单列；记录正文按逻辑内容分摊，文件数按媒体描述去重</div></div>
                        <div className="shrink-0 text-sm font-medium tabular-nums">{formatBytes(database.bytes)}</div>
                    </div>
                    <div className="divide-y divide-stone-200 dark:divide-stone-800">
                        {database.stores.map(store => (
                            <div key={store.name} className="px-4 py-3">
                                <div className="flex items-start justify-between gap-4 text-sm">
                                    <div className="min-w-0"><div className="flex items-center gap-2 font-medium"><span>{store.label}</span>{isRecycleCategory(store.name) ? <Button size="small" danger loading={recycleAction === store.name} disabled={!!recycleAction || store.bytes === 0 && store.records === 0 && pendingCleanup !== store.name} onClick={() => void clearRecycle(store.name as RecycleStorageKind, store.label)}>{pendingCleanup === store.name ? "重试删除" : "删除"}</Button> : null}</div><div className="mt-0.5 text-[11px] text-stone-500">{countLabel(store)}</div></div>
                                    <div className="shrink-0 text-right font-medium tabular-nums">{formatBytes(store.bytes)}</div>
                                </div>
                                <Progress className="!mb-0 !mt-1" percent={database.bytes ? Math.min(100, store.bytes / database.bytes * 100) : 0} showInfo={false} size="small" aria-label={`${store.label}容量占比`} />
                            </div>
                        ))}
                    </div>
                    {recycleNotice ? <Alert className="m-4" type="info" showIcon message={recycleNotice} /> : null}
                    {recycleError ? <Alert className="m-4" type="error" showIcon message="回收站删除失败" description={recycleError} /> : null}
                </section>
            ))}
            {usage ? (
                <section className="rounded-lg border border-stone-200 p-4 text-xs dark:border-stone-800">
                    <div className="mb-3 font-semibold">实际占用明细</div>
                    <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 text-stone-500">
                        <dt>数据库文件</dt><dd className="text-right tabular-nums">{formatBytes(usage.breakdown.databaseFileBytes)}</dd>
                        <dt>写入日志（WAL）</dt><dd className="text-right tabular-nums">{formatBytes(usage.breakdown.walBytes)}</dd>
                        <dt>共享内存文件（SHM）</dt><dd className="text-right tabular-nums">{formatBytes(usage.breakdown.shmBytes)}</dd>
                        <dt>媒体文件（已索引）</dt><dd className="text-right tabular-nums">{formatBytes(usage.breakdown.indexedMediaBytes)}</dd>
                        <dt>媒体文件（未索引/暂存）</dt><dd className="text-right tabular-nums">{formatBytes(usage.breakdown.unindexedMediaBytes)}</dd>
                    </dl>
                    <p className="mb-0 mt-3 text-[11px] leading-5 text-stone-500">业务记录数不是画布卡片数，媒体块数不是文件数。实际占用包含索引、保存确认记录及数据库内部空间；并行保存时文件采样可能略有变化。回收站容量包含其中产品、画布及图片、视频、音频等资产；跨分类共用的媒体单列。点击分类旁“删除”可永久清空对应回收站并清理专属媒体。数据库已释放的内部空间供后续保存复用；统计不含备份。</p>
                </section>
            ) : null}
        </div>
    );
}

function isRecycleCategory(value: string): value is RecycleStorageKind {
    return value === "product_recycle" || value === "workbook_recycle";
}

function countLabel(store: Category) {
    if (store.name === "history") return `${store.blocks} 个存储分片（非业务记录）`;
    const parts = store.records || (!store.files && !store.mediaBytes) ? [`${store.records} 项记录`] : [];
    if (store.files) parts.push(`${store.files} 个去重媒体文件`);
    if (store.blocks && store.mediaBytes) parts.push(`${store.blocks} 个媒体块`);
    return parts.join(" · ");
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
