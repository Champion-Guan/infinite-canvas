import { create } from "zustand";
import { checkpointLocalStorageWrite } from "@/lib/checkpoint-local-storage";

export const CANVAS_SIDE_PANEL_MOTION_MS = 500;
export const CANVAS_SIDE_PANEL_MIN_WIDTH = 220;
export const CANVAS_SIDE_PANEL_MAX_WIDTH = 480;
export const CANVAS_SIDE_PANEL_DEFAULT_WIDTH = 280;

const WIDTH_KEY = "canvas-side-panel-width";
const OPEN_KEY = "canvas-side-panel-open";
const HISTORY_SORTED_KEY = "canvas-generation-history-sorted";
const NODE_VIEW_KEY = "canvas-side-panel-node-view";

export type CanvasNodeViewMode = "list" | "grid";

function initialWidth() {
    if (typeof window === "undefined") return CANVAS_SIDE_PANEL_DEFAULT_WIDTH;
    const stored = Number(localStorage.getItem(WIDTH_KEY));
    if (!stored) return CANVAS_SIDE_PANEL_DEFAULT_WIDTH;
    return Math.min(CANVAS_SIDE_PANEL_MAX_WIDTH, Math.max(CANVAS_SIDE_PANEL_MIN_WIDTH, stored));
}

function initialOpen() {
    if (typeof window === "undefined") return true;
    return localStorage.getItem(OPEN_KEY) !== "0";
}

function initialHistorySorted() {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(HISTORY_SORTED_KEY) === "1";
}

function initialNodeView(): CanvasNodeViewMode {
    if (typeof window === "undefined") return "list";
    return localStorage.getItem(NODE_VIEW_KEY) === "grid" ? "grid" : "list";
}

type CanvasSidePanelStore = {
    width: number;
    panelOpen: boolean;
    panelMounted: boolean;
    panelClosing: boolean;
    historySorted: boolean;
    setWidth: (width: number) => void;
    toggleHistorySorted: () => void;
    nodeViewMode: CanvasNodeViewMode;
    setNodeViewMode: (mode: CanvasNodeViewMode) => void;
    openPanel: () => void;
    closePanel: () => void;
    togglePanel: () => void;
};

export const useCanvasSidePanelStore = create<CanvasSidePanelStore>((set, get) => ({
    width: initialWidth(),
    panelOpen: initialOpen(),
    panelMounted: initialOpen(),
    panelClosing: false,
    historySorted: initialHistorySorted(),
    setWidth: (width) => set({ width }),
    toggleHistorySorted: () => {
        const historySorted = !get().historySorted;
        if (typeof window !== "undefined") checkpointLocalStorageWrite(HISTORY_SORTED_KEY, historySorted ? "1" : "0");
        set({ historySorted });
    },
    nodeViewMode: initialNodeView(),
    setNodeViewMode: (mode) => {
        if (typeof window !== "undefined") checkpointLocalStorageWrite(NODE_VIEW_KEY, mode);
        set({ nodeViewMode: mode });
    },
    openPanel: () => {
        if (typeof window !== "undefined") checkpointLocalStorageWrite(OPEN_KEY, "1");
        set({ panelOpen: true, panelMounted: true, panelClosing: false });
    },
    closePanel: () => {
        if (!get().panelMounted || get().panelClosing) return;
        if (typeof window !== "undefined") checkpointLocalStorageWrite(OPEN_KEY, "0");
        set({ panelOpen: false, panelClosing: true });
        setTimeout(() => {
            if (get().panelClosing) set({ panelMounted: false, panelClosing: false });
        }, CANVAS_SIDE_PANEL_MOTION_MS);
    },
    togglePanel: () => (get().panelOpen ? get().closePanel() : get().openPanel()),
}));
