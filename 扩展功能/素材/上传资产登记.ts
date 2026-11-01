import { useAssetStore, type Asset } from "@/stores/use-asset-store";
import type { UploadedImage } from "@/services/image-storage";
import type { UploadedFile } from "@/services/file-storage";
import { sameStoredAsset, type UserUpload } from "./上传资产规则";

type PendingAsset = {
    owner: UserUpload;
    kind: "image" | "video" | "audio";
    upload: UploadedImage | UploadedFile;
};

// 媒体已经落盘后，资产索引属于次要派生数据，不能再阻塞“上传文件”主流程。
// 资产恢复较慢或部分旧媒体损坏时先排队；恢复完成后在内存中补登记。
const pendingAssets: PendingAsset[] = [];
let hydrationSubscription: (() => void) | null = null;

function buildAsset({ owner, kind, upload }: PendingAsset) {
    const { url, ...stored } = upload;
    return {
        kind,
        title: owner.name,
        coverUrl: kind === "image" ? url : "",
        tags: [],
        metadata: { source: "upload", ...(owner.projectId ? { projectId: owner.projectId } : {}) },
        data: kind === "image"
            ? { ...stored, dataUrl: url }
            : { ...stored, url, width: upload.width || 0, height: upload.height || 0 },
    } as Omit<Asset, "id" | "createdAt" | "updatedAt">;
}

function addAssetIfNeeded(item: PendingAsset) {
    const state = useAssetStore.getState();
    const asset = buildAsset(item);
    const existing = state.assets.find(candidate => sameStoredAsset(candidate, asset));
    return existing?.id || state.addAsset(asset);
}

function flushPendingAssets() {
    const state = useAssetStore.getState();
    if (!state.hydrated || !pendingAssets.length) return;
    const queued = pendingAssets.splice(0);
    for (const item of queued) addAssetIfNeeded(item);
    hydrationSubscription?.();
    hydrationSubscription = null;
}

function waitForHydration() {
    if (hydrationSubscription) return;
    hydrationSubscription = useAssetStore.subscribe(state => {
        if (state.hydrated) flushPendingAssets();
    });
    // The state can become hydrated between the initial check and subscribing.
    flushPendingAssets();
}

export async function registerUploadedAsset(owner: UserUpload, kind: "image" | "video" | "audio", upload: UploadedImage | UploadedFile) {
    const state = useAssetStore.getState();
    if (!state.hydrated) {
        pendingAssets.push({ owner, kind, upload });
        waitForHydration();
        return undefined;
    }
    return addAssetIfNeeded({ owner, kind, upload });
}
