import type { CanvasAssistantSession } from "@/types/canvas";
import type { CanvasHistorySnapshot } from "../扩展边界/画布历史接口";
import type { CanvasBackgroundMode } from "@/lib/canvas-theme";
import { sqliteForage } from "../本机存储/上游浏览器存储桥";
import { sameCanvasValue } from "./画布保存判定";

export type ProductHistoryEntry = CanvasHistorySnapshot & {
    chatSessions: CanvasAssistantSession[];
    activeChatId: string | null; backgroundMode: CanvasBackgroundMode; showImageInfo: boolean;
};
export type ProductDormantState = {
    version: 1;
    projectRevision: string;
    current: ProductHistoryEntry;
    history: { past: ProductHistoryEntry[]; future: ProductHistoryEntry[] };
    selectedNodeIds: string[]; selectedConnectionId: string | null; canvasTool: "pan" | "select";
};
// 沿用已授权SQLite命名空间，独立键按产品覆盖；不在模块Map里永久保留历史对象。
const store = () => sqliteForage.createInstance({ name: "infinite-canvas", storeName: "prompt_cache" });
const key = (id: string) => `product-dormant:v1:${id}`;
// 原撤销记录只属于本页；跨刷新仍沿用原来的空撤销栈，避免重用已经失效的Blob URL。
const pageSession = `${Date.now()}:${Math.random()}`;
// 只记本页写过的产品ID。跨页旧记录本来就不可用，不为首次打开读取大Blob。
const pageDormantIds = new Set<string>();
type Atom = string | number | boolean | null | { ref: number } | { missing: true };
type GraphRow = { array: Atom[] } | { object: Array<[string, Atom]> };
export function packDormantProduct(value: ProductDormantState) {
    const ids = new WeakMap<object, number>(), rows: GraphRow[] = [];
    const atom = (value: unknown): Atom => {
        if (value === undefined) return { missing: true };
        if (value === null || typeof value === "string" || typeof value === "boolean") return value;
        if (typeof value === "number" && Number.isFinite(value)) return value;
        if (typeof value !== "object" || (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype))
            throw Error("画布包含不可休眠的插件状态，保留当前实例。");
        const existing = ids.get(value);
        if (existing !== undefined) return { ref: existing };
        const id = rows.length; ids.set(value, id); rows.push({ array: [] });
        rows[id] = Array.isArray(value) ? { array: value.map(atom) }
            : { object: Object.entries(value).map(([key, value]) => [key, atom(value)]) };
        return { ref: id };
    };
    const root = atom(value);
    return new Blob([JSON.stringify({ pageSession, root, rows })], { type: "application/octet-stream" });
}
export async function unpackDormantProduct(blob: Blob): Promise<ProductDormantState | null> {
    const graph = JSON.parse(await blob.text()) as { pageSession: string; root: Atom; rows: GraphRow[] };
    if (graph.pageSession !== pageSession) return null;
    if (!Array.isArray(graph.rows)) throw Error("画布休眠目录无效，原数据仍保留。");
    const objects = graph.rows.map(row => "array" in row ? [] : {}) as Array<unknown[] | Record<string, unknown>>;
    const value = (atom: Atom): unknown => {
        if (atom === null || typeof atom !== "object") return atom;
        if ("missing" in atom && atom.missing) return undefined;
        if (!("ref" in atom) || !Number.isSafeInteger(atom.ref) || !objects[atom.ref]) throw Error("画布休眠引用缺失。");
        return objects[atom.ref];
    };
    graph.rows.forEach((row, index) => {
        const target = objects[index];
        if ("array" in row) {
            if (!Array.isArray(row.array)) throw Error("画布休眠数组无效。");
            for (const atom of row.array) (target as unknown[]).push(value(atom));
        } else {
            if (!Array.isArray(row.object)) throw Error("画布休眠对象无效。");
            for (const [key, atom] of row.object) Object.defineProperty(target, key, { value: value(atom), enumerable: true, writable: true, configurable: true });
        }
    });
    return value(graph.root) as ProductDormantState;
}
export function saveDormantProduct(id: string, value: ProductDormantState) {
    const packed = packDormantProduct(value);
    pageDormantIds.add(id);
    return store().setItem(key(id), packed).then(() => {});
}
export async function readDormantProduct(id: string): Promise<ProductDormantState | null> {
    if (!pageDormantIds.has(id)) return null;
    const record = await store().getItem<Blob>(key(id));
    if (!record) return null;
    if (!(record instanceof Blob)) throw Error("画布休眠记录类型异常，原数据仍保留。");
    const value = await unpackDormantProduct(record);
    if (!value) return null;
    if (value.version !== 1 || !Array.isArray(value.current?.nodes) || !Array.isArray(value.current?.connections)
        || !Array.isArray(value.history?.past) || !Array.isArray(value.history?.future) || !Array.isArray(value.selectedNodeIds))
        throw Error("画布休眠记录格式异常，未丢弃原撤销记录。");
    return value;
}
export function matchingDormantProduct(value: ProductDormantState | null, current: ProductHistoryEntry, revision?: string) {
    // 其他窗口、恢复或后台业务改变原画布后，不能套用旧撤销栈覆盖新内容。
    return value && (revision && value.projectRevision ? revision === value.projectRevision : sameCanvasValue(value.current, current)) ? value : null;
}
