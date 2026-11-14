import { productFeatures } from "../产品配置/功能开关";
import { orderedWorkbookProjects, visibleWorkbookId, withVisibleSelection, rememberWorkbookProduct, workbookEntry, type WorkbookSnapshot } from "../Excel/Excel产品归属";
import { orderedProducts, selectEntryProduct } from "./产品规则";

// 关闭Excel后只扩大导航范围；历史工作簿归属和模板继续原样保存在同一业务根中。
export function navigationProducts(snapshot: WorkbookSnapshot, activeId: string) {
    return productFeatures.excel
        ? orderedWorkbookProjects(snapshot.projects, visibleWorkbookId(snapshot, activeId), snapshot.guanWorkbooks?.contract.products)
        : orderedProducts(snapshot.projects);
}
export function navigationOwner(snapshot: WorkbookSnapshot, activeId: string) {
    return productFeatures.excel ? visibleWorkbookId(snapshot, activeId) : null;
}
export function navigationEntry(snapshot: WorkbookSnapshot, rememberedId: string | null) {
    return productFeatures.excel ? workbookEntry(snapshot, undefined, rememberedId) : selectEntryProduct(snapshot.projects, rememberedId);
}
export function navigationSelection(snapshot: WorkbookSnapshot, activeId: string) {
    return productFeatures.excel ? withVisibleSelection(snapshot, activeId) : snapshot;
}
export function navigationWorkbookMemory(snapshot: WorkbookSnapshot, activeId: string) {
    return productFeatures.excel ? rememberWorkbookProduct(snapshot, activeId) : null;
}
