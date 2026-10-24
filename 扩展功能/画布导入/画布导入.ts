import { readZip } from "@/lib/zip";
import { deleteStoredMedia, setMediaBlob } from "@/services/file-storage";
import { deleteStoredImages, setImageBlob } from "@/services/image-storage";
import { prepareCanvasExport } from "./画布导入数据";
import { settleActivityGroup } from "../安全与批量/settle-activity-group";

/** Read a canvas ZIP and restore its referenced media without mutating the canvas store. */
export async function readCanvasExport(file: File) {
    const zip = await readZip(file);
    const projectFile = zip.get("projects.json");
    if (!projectFile) throw new Error("导入包缺少 projects.json");
    const { projects, media } = prepareCanvasExport(JSON.parse(await projectFile.text()), zip);
    try {
        await settleActivityGroup(media.map(({ key, blob }) => key.startsWith("image:") ? setImageBlob(key, blob) : setMediaBlob(key, blob)));
    } catch (error) {
        await settleActivityGroup([
            deleteStoredImages(media.filter(({ key }) => key.startsWith("image:")).map(({ key }) => key)),
            deleteStoredMedia(media.filter(({ key }) => !key.startsWith("image:")).map(({ key }) => key)),
        ]);
        throw error;
    }
    return projects;
}
