import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Empty, Spin } from "antd";
import { PromptSourceContentModal } from "@/components/layout/prompt-source-content-modal";
import { fetchPromptSourceStatuses } from "@/services/api/prompts";
import { usePromptSourceStore } from "@/stores/use-prompt-source-store";

export function LocalPromptSources() {
    const sources = usePromptSourceStore((state) => state.sources);
    const [viewingId, setViewingId] = useState("");
    const status = useQuery({ queryKey: ["prompt-source-statuses"], queryFn: fetchPromptSourceStatuses });
    return <div className="space-y-3">
        <Alert type="info" showIcon title="提示词来源已切换为离线查看" description="不抓取网站、不自动刷新、不加载远程示例图。原来源配置和缓存保留；Excel 本地解析接入属于后续阶段，本页目前不提供 Excel 导入。" />
        {status.isPending ? <Spin /> : status.isError ? <Alert type="error" title="本地提示词缓存读取失败" action={<Button onClick={() => void status.refetch()}>重试本地读取</Button>} /> : sources.length ? sources.map((source) => <div key={source.id} className="flex items-center justify-between gap-3 rounded-lg border border-stone-200 p-3 dark:border-stone-800">
            <div className="min-w-0"><div className="truncate font-medium">{source.name}</div><div className="text-xs text-stone-500">本地缓存 {status.data?.[source.id]?.count ?? 0} 条 · {source.enabled ? "侧栏显示" : "原设置未启用"}</div></div>
            <Button onClick={() => setViewingId(source.id)}>查看本地内容</Button>
        </div>) : <Empty description="暂无本地提示词来源" />}
        <PromptSourceContentModal source={sources.find((item) => item.id === viewingId) ?? null} onClose={() => setViewingId("")} />
    </div>;
}
