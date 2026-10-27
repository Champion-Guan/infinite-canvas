import { useAssetStore, type Asset } from "@/stores/use-asset-store";
import type { UploadedImage } from "@/services/image-storage";
import type { UploadedFile } from "@/services/file-storage";
import { sameStoredAsset, type UserUpload } from "./上传资产规则";

async function readyAssets() {
    if (useAssetStore.getState().hydrated) return;
    await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { unsubscribe(); reject(new Error("资产尚未恢复完成，请稍后再上传，避免覆盖原有资产。")); }, 15_000);
        const unsubscribe = useAssetStore.subscribe(state => {
            if (state.hydrated) { clearTimeout(timer); unsubscribe(); resolve(); }
        });
        if (useAssetStore.getState().hydrated) { clearTimeout(timer); unsubscribe(); resolve(); }
    });
}

export async function registerUploadedAsset(owner: UserUpload, kind: "image" | "video" | "audio", upload: UploadedImage | UploadedFile) {
    await readyAssets();
    const { url, ...stored } = upload;
    const asset = {
        kind, title: owner.name, coverUrl: kind === "image" ? url : "", tags: [],
        metadata: { source: "upload", ...(owner.projectId ? { projectId: owner.projectId } : {}) },
        data: kind === "image" ? { ...stored, dataUrl: url } : { ...stored, url, width: upload.width || 0, height: upload.height || 0 },
    } as Omit<Asset, "id" | "createdAt" | "updatedAt">;
    const state = useAssetStore.getState();
    const existing = state.assets.find(item => sameStoredAsset(item, asset));
    return existing?.id || state.addAsset(asset);
}
