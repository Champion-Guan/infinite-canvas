// 当前画布ZIP追加及失败素材回收；与顶栏新建产品导入分开。
import { useCallback, useRef } from "react";
import { readZip } from "@/lib/zip";
import { setImageBlob, deleteStoredImages } from "@/services/image-storage";
import { setMediaBlob, deleteStoredMedia } from "@/services/file-storage";
import { hydrateCanvasImages } from "@/lib/canvas/canvas-generation-helpers";
import { prepareCanvasContentImport } from "./画布内容导入";
import { observeActivity } from "../安全与批量/update-activity";
import { settleActivityGroup } from "../安全与批量/settle-activity-group";
import { placeNewCanvasNodes } from "../画布布局/卡片自动避让";
import { saveProductCanvas } from "../产品/产品操作";
import type { CanvasHistoryPort, CanvasHistorySnapshot } from "../扩展边界/画布历史接口";

export function useCanvasContentImport<T extends CanvasHistorySnapshot>({ projectId, nodesRef, historyRef, createHistoryEntry, applyHistory, setSelectedNodeIds, assertImportTarget, message }: CanvasHistoryPort<T>) {
    const contentInputRef = useRef<HTMLInputElement>(null);
    const contentImportBusyRef = useRef(false);
    const importCurrentContents = useCallback(async (file?: File) => {
        if (!file || contentImportBusyRef.current) return;
        contentImportBusyRef.current = true;
        const hide = message.loading("正在导入画布内容…", 0);
        let media: Array<{ key: string; blob: Blob }> = [];
        let applied = false;
        try {
            await observeActivity("storage", async () => {
                assertImportTarget();
                if (file.size > 256 * 1024 * 1024) throw new Error("ZIP 文件不能超过 256 MB");
                const zip = await readZip(file);
                const manifest = zip.get("projects.json");
                if (!manifest) throw new Error("请选择导出当前画布生成的 ZIP 文件");
                const prepared = prepareCanvasContentImport(JSON.parse(await manifest.text()), zip, nodesRef.current);
                assertImportTarget();
                media = prepared.media;
                await settleActivityGroup(media.map(({ key, blob }) => key.startsWith("image:") ? setImageBlob(key, blob) : setMediaBlob(key, blob)));
                const imported = await hydrateCanvasImages(prepared.nodes);
                assertImportTarget();
                const before = createHistoryEntry();
                const next = { ...before, nodes: placeNewCanvasNodes(before.nodes, [...before.nodes, ...imported]), connections: [...before.connections, ...prepared.connections] };
                historyRef.current.past = [...historyRef.current.past.slice(-49), before];
                historyRef.current.future = [];
                applyHistory(next);
                applied = true;
                setSelectedNodeIds(new Set(imported.map(node => node.id)));
                await saveProductCanvas(projectId);
                message.success(`已向当前画布追加 ${imported.length} 个节点，可撤销`);
            });
        } catch (error) {
            if (!applied && media.length) {
                await settleActivityGroup([
                    deleteStoredImages(media.filter(item => item.key.startsWith("image:")).map(item => item.key)),
                    deleteStoredMedia(media.filter(item => !item.key.startsWith("image:")).map(item => item.key)),
                ]).catch(() => undefined);
            }
            message.error(`${applied ? "内容已追加，但保存未确认：" : "导入失败："}${error instanceof Error ? error.message : String(error)}`);
        } finally {
            contentImportBusyRef.current = false;
            if (contentInputRef.current) contentInputRef.current.value = "";
            hide();
        }
    }, [applyHistory, assertImportTarget, createHistoryEntry, message, projectId, historyRef, nodesRef, setSelectedNodeIds]);

    return { contentInputRef, importCurrentContents };
}
