// 图片面板和图片请求共用；视频继续使用作者原有尺寸规则。
export const mediaScaleOptions = ["1k", "2k", "4k", "auto"] as const;
export const mediaRatioOptions = [
    { value: "1:1", width: 1, height: 1 },
    { value: "2:3", width: 2, height: 3 },
    { value: "3:2", width: 3, height: 2 },
    { value: "4:3", width: 4, height: 3 },
    { value: "3:4", width: 3, height: 4 },
    { value: "8:5", width: 8, height: 5 },
    { value: "5:8", width: 5, height: 8 },
    { value: "16:9", width: 16, height: 9 },
    { value: "9:16", width: 9, height: 16 },
    { value: "21:9", width: 21, height: 9 },
    { value: "9:21", width: 9, height: 21 },
    { value: "auto", width: 0, height: 0 },
] as const;

export const imageSizePresets: Record<string, Record<string, string>> = {
    "1k": { "1:1": "1024x1024", "2:3": "1024x1536", "3:2": "1536x1024", "4:3": "1024x768", "3:4": "1152x1536", "16:9": "1536x864", "9:16": "864x1536", "21:9": "2016x864", "9:21": "864x2016", "8:5": "1584x992", "5:8": "640x1024" },
    "2k": { "1:1": "2048x2048", "2:3": "1360x2048", "3:2": "2048x1360", "4:3": "2048x1536", "3:4": "1536x2048", "16:9": "2048x1152", "9:16": "1152x2048", "21:9": "2688x1152", "9:21": "1152x2688", "8:5": "2048x1280", "5:8": "1280x2048" },
    "4k": { "1:1": "2880x2880", "2:3": "2336x3520", "3:2": "3520x2336", "4:3": "3312x2480", "3:4": "2480x3312", "16:9": "3840x2160", "9:16": "2160x3840", "21:9": "3840x1648", "9:21": "1648x3840", "8:5": "3584x2240", "5:8": "2240x3584" },
};

function parseDimensions(size: string) {
    const match = String(size || "").match(/^(\d+(?:\.\d+)?)[x:](\d+(?:\.\d+)?)$/i);
    if (!match || Number(match[1]) <= 0 || Number(match[2]) <= 0) return null;
    return { width: Number(match[1]), height: Number(match[2]) };
}

export function inferMediaScale(size: string) {
    if (!size || size === "auto" || size.includes(":")) return "auto";
    const pixels = parseDimensions(size);
    if (!pixels) return "auto";
    const preset = Object.keys(imageSizePresets).find(scale => Object.values(imageSizePresets[scale]).includes(size.toLowerCase()));
    if (preset) return preset;
    const longSide = Math.max(pixels.width, pixels.height);
    return longSide >= 3072 ? "4k" : longSide >= 1536 ? "2k" : "1k";
}

export function inferMediaRatio(size: string, fallback = "1:1"): string {
    if (!size || size === "auto") return "auto";
    if (mediaRatioOptions.some(item => item.value === size)) return size;
    const pixels = parseDimensions(size);
    if (!pixels) return fallback;
    const target = pixels.width / pixels.height;
    let best = fallback, distance = Infinity;
    for (const item of mediaRatioOptions) {
        if (!item.width || !item.height) continue;
        const nextDistance = Math.abs(item.width / item.height - target);
        if (nextDistance < distance) { best = item.value; distance = nextDistance; }
    }
    return best;
}

export function computeMediaSize(scale: string, ratio: string): string {
    if (!ratio || ratio === "auto") return "auto";
    if (scale === "auto") return ratio;
    return imageSizePresets[scale]?.[ratio] || imageSizePresets["1k"][ratio] || "auto";
}

export function readMediaDimensions(size: string, scale: string, ratio: string) {
    // 已保存或手填的像素值原样显示；只在选择比例/分辨率时应用新默认。
    if (!size.includes(":")) {
        const pixels = parseDimensions(size);
        if (pixels) return pixels;
    }
    return parseDimensions(computeMediaSize(scale === "auto" ? "1k" : scale, ratio === "auto" ? "1:1" : ratio)) || { width: 0, height: 0 };
}
