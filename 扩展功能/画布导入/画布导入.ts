import { readZip } from "@/lib/zip";
import { deleteStoredMedia, setMediaBlob } from "@/services/file-storage";
import { deleteStoredImages, setImageBlob } from "@/services/image-storage";
import { prepareCanvasExport } from "./画布导入数据";
import { settleActivityGroup } from "../安全与批量/settle-activity-group";
import { publishImportProgress } from "./产品导入进度";

/** Read a canvas ZIP and restore its referenced media without mutating the canvas store. */
export async function readCanvasExport(file: File) {
    const report = (phase: string, completed: number, total: number, percent: number) =>
        publishImportProgress({ name: file.name || "产品包", phase, completed, total, percent, status: "running" });
    report("正在读取并解压产品包…", 0, 0, 5);
    const zip = await readZip(file);
    const projectFile = zip.get("projects.json");
    if (!projectFile) throw new Error("导入包缺少 projects.json");
    const { projects, media } = prepareCanvasExport(JSON.parse(await projectFile.text()), zip);
    report("正在保存图片与媒体…", 0, media.length, 15);
    try {
        let cursor = 0, completed = 0;
        // 限制同时解码与落盘的文件数，避免大包同时解码数百张原图。
        await settleActivityGroup(Array.from({ length: Math.min(3, media.length) }, async () => {
            while (cursor < media.length) {
                const { key, blob } = media[cursor++];
                if (key.startsWith("image:")) await setImageBlob(key, blob);
                else await setMediaBlob(key, blob);
                report("正在保存图片与媒体…", ++completed, media.length, 15 + Math.floor(completed / media.length * 70));
            }
        }));
    } catch (error) {
        await settleActivityGroup([
            deleteStoredImages(media.filter(({ key }) => key.startsWith("image:")).map(({ key }) => key)),
            deleteStoredMedia(media.filter(({ key }) => !key.startsWith("image:")).map(({ key }) => key)),
        ]);
        throw error;
    }
    return projects;
}
