export type OutsidePanelLayer = {
    parent: OutsidePanelLayer | null;
    trigger(): HTMLElement | null;
    panel(): HTMLElement | null;
    dismiss(event: Event): void;
    modal?: boolean;
};

const nestedOptions = ".ant-select-dropdown,.ant-picker-dropdown,.ant-cascader-menus,.ant-color-picker,.ant-popover,.ant-dropdown,.ant-dropdown-menu-submenu-popup,.ant-modal-wrap,.ant-modal-mask,.ant-drawer-mask,.ant-drawer-content-wrapper,.ant-image-preview-wrap,[data-radix-popper-content-wrapper],[data-canvas-resource-mention-menu]";
const imagePreview = ".ant-image-preview,.ant-image-preview-root,.ant-image-preview-wrap,.ant-image-preview-mask";

// 捕获阶段早于画布拖动；同一事件只判断一次，Portal子层与其父层一起保留。
export function createOutsidePanelRegistry(host: EventTarget | null) {
    const layers = new Set<OutsidePanelLayer>();
    const outside = (event: Event) => {
        const target = event.composedPath?.()[0] || event.target;
        if (!(target instanceof Node)) return;
        const keep = new Set<OutsidePanelLayer>();
        for (const layer of layers) {
            if (!layer.trigger()?.contains(target) && !layer.panel()?.contains(target)) continue;
            let current: OutsidePanelLayer | null = layer;
            while (current && !keep.has(current)) { keep.add(current); current = current.parent; }
        }
        const element = target instanceof Element ? target : target.parentElement;
        // 图片预览由原生组件关闭；其Portal即使挂在父弹窗内，也不能视为父弹窗遮罩。
        if (element?.closest(imagePreview)) return;
        // 未接入的原生/Radix选项仍由各自组件处理，不能在选择前关掉父面板。
        if (!keep.size && element?.closest(nestedOptions)) {
            const backdrop = element.closest(".ant-modal-wrap,.ant-modal-mask");
            const ownBackdrop = backdrop && [...layers].some(layer => layer.modal
                && layer.panel()?.closest(".ant-modal-root")?.contains(backdrop));
            // 当前注册弹窗自己的遮罩是外部点击；另一个原生弹窗和选项Portal仍保留。
            if (!ownBackdrop || element.closest(".ant-modal")) return;
        }
        for (const layer of [...layers].reverse()) if (!keep.has(layer)) {
            layer.dismiss(event);
            if (layer.modal) break;
        }
    };
    return {
        register(layer: OutsidePanelLayer) {
            if (!layers.size) host?.addEventListener("pointerdown", outside, true);
            layers.add(layer);
            return () => {
                layers.delete(layer);
                if (!layers.size) host?.removeEventListener("pointerdown", outside, true);
            };
        },
    };
}
