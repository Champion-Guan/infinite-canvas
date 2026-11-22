import { readZip } from "@/lib/zip";

export async function readCanvasImportPackage(file: File) {
    const zip = await readZip(file).catch((cause: unknown) => {
        throw new Error("无法打开这个 ZIP 文件。文件可能已损坏或未下载完整，请重新下载或重新导出后再试。", { cause });
    });
    const manifest = zip.get("projects.json");
    if (!manifest) throw new Error("这个压缩包没有画布数据。请选择工作台导出的 ZIP 文件。");

    try {
        const data: unknown = JSON.parse(await manifest.text());
        return { data, zip };
    } catch (cause) {
        throw new Error("压缩包里的画布数据无法读取，请在原工作台重新导出后再试。", { cause });
    }
}
