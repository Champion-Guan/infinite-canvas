import { sqliteForage } from "../本机存储/上游浏览器存储桥";

export type HistoryMediaRecord = { id: string; storageKey?: string; remote: boolean; type: string };

// 先核对持久记录索引，不为显示列表解码/传输整批原图。
// 原文件完整性仍由预览和下载时的真实读取检查。
export async function missingHistoryMedia(records: HistoryMediaRecord[],
    readKeys = (storeName: string) => sqliteForage.createInstance({ name: "infinite-canvas", storeName }).keys()) {
    const namespace = (record: HistoryMediaRecord) => record.type === "image" ? "image_files" : "media_files";
    const local = records.filter(record => record.storageKey && !record.remote);
    const names = [...new Set(local.map(namespace))];
    const keys = new Map(await Promise.all(names.map(async name => [name, new Set(await readKeys(name))] as const)));
    return new Set(local.filter(record => !keys.get(namespace(record))!.has(record.storageKey!)).map(record => record.id));
}
