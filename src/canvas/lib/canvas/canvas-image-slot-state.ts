import type { CanvasNodeImage } from "@/types/canvas";

export type CanvasImageSlotState = "empty" | "loading" | "generating" | "error";

export function canvasImageSlotState(image?: Pick<CanvasNodeImage, "status">): CanvasImageSlotState {
    if (!image || image.status === "idle") return "empty";
    if (image.status === "loading") return "generating";
    if (image.status === "error") return "error";
    return "loading";
}
