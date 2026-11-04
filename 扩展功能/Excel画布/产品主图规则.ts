import type { CanvasNodeMetadata } from "@/types/canvas";

export type ProductImageSource = {
    storageKey?: string;
    originalStorageKey?: string;
    url?: string;
    width?: number;
    height?: number;
    bytes?: number;
    mimeType?: string;
};

export type ProductMainImage = ProductImageSource & {
    id: string;
    name: string;
    original?: ProductImageSource;
    cutout?: ProductImageSource;
    backgroundRemoved?: boolean;
};

export type ProductImageMetadata = CanvasNodeMetadata & {
    productMainImages?: ProductMainImage[];
    productMainImageStorageKey?: string;
    productMainImageUrl?: string;
    productMainImageWidth?: number;
    productMainImageHeight?: number;
    productMainImageBytes?: number;
    productMainImageMimeType?: string;
};

// 空列表也属于新格式，不能让已移除的旧单图重新出现。
export function productMainImages(metadata?: ProductImageMetadata): ProductMainImage[] {
    if (Array.isArray(metadata?.productMainImages)) return metadata.productMainImages;
    if (!metadata?.productMainImageStorageKey && !metadata?.productMainImageUrl) return [];
    return [{
        id: "legacy-main-image", name: "产品主图",
        storageKey: metadata.productMainImageStorageKey, url: metadata.productMainImageUrl,
        width: metadata.productMainImageWidth, height: metadata.productMainImageHeight,
        bytes: metadata.productMainImageBytes, mimeType: metadata.productMainImageMimeType,
    }];
}

export function productMainImagesPatch(images: ProductMainImage[]): ProductImageMetadata {
    const first = images[0];
    return {
        productMainImages: images,
        productMainImageStorageKey: first?.storageKey, productMainImageUrl: first?.url,
        productMainImageWidth: first?.width, productMainImageHeight: first?.height,
        productMainImageBytes: first?.bytes, productMainImageMimeType: first?.mimeType,
    };
}

export function productImageSource(image: ProductImageSource): ProductImageSource {
    const { storageKey, originalStorageKey, url, width, height, bytes, mimeType } = image;
    return { storageKey, originalStorageKey, url, width, height, bytes, mimeType };
}

export function restoreProductMainImage(image: ProductMainImage): ProductMainImage {
    return image.original ? { ...image, ...image.original, backgroundRemoved: false } : image;
}

export function applyProductImageCutout(image: ProductMainImage, cutout: ProductImageSource): ProductMainImage {
    return { ...image, ...productImageSource(cutout), original: image.original || productImageSource(image),
        cutout: productImageSource(cutout), backgroundRemoved: true };
}

export function sameProductImageSource(a: ProductImageSource, b: ProductImageSource) {
    return a.storageKey || b.storageKey ? Boolean(a.storageKey && a.storageKey === b.storageKey) : a.url === b.url;
}
