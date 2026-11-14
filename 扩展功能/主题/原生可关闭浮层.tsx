import { createContext, forwardRef, useCallback, useContext, useEffect, useRef, useState, type ComponentRef, type ComponentProps, type Ref, type ReactNode } from "react";
import { Drawer, Dropdown, Popover, Select, Tooltip, type DrawerProps, type DropdownProps, type PopoverProps } from "antd";
import { useProductActive } from "../产品/产品界面边界";
import { createOutsidePanelRegistry, type OutsidePanelLayer } from "./面板外部关闭";
import { NATIVE_POPUP_LIMIT, toolbarPopupTargetOffset, useNativePopupBoundary } from "../画布交互/原生浮层边界容器";
import menuStyles from "./苹果下拉菜单.module.css";

const ParentPanel = createContext<OutsidePanelLayer | null>(null);
const outsidePanels = createOutsidePanelRegistry(typeof window === "undefined" ? null : window);

export function useOutsidePanel(open: boolean, trigger: () => HTMLElement | null, panel: () => HTMLElement | null, dismiss: (event: Event) => void, modal = false) {
    const active = useProductActive();
    const parent = useContext(ParentPanel);
    const latest = useRef({ trigger, panel, dismiss }); latest.current = { trigger, panel, dismiss };
    const layer = useRef<OutsidePanelLayer>({ parent, modal, trigger: () => latest.current.trigger(), panel: () => latest.current.panel(), dismiss: event => latest.current.dismiss(event) });
    layer.current.parent = parent;
    useEffect(() => {
        if (!open) return;
        if (!active) return;
        return outsidePanels.register(layer.current);
    }, [open, active]);
    return { layer: layer.current, active };
}

export function OutsidePanelScope({ layer, children }: { layer: OutsidePanelLayer; children: ReactNode }) {
    return <ParentPanel.Provider value={layer}>{children}</ParentPanel.Provider>;
}

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
    if (typeof ref === "function") ref(value);
    else if (ref) ref.current = value;
}

export function OutsidePanelBoundary({ children, onClose, anchor }: { children: ReactNode; onClose(): void; anchor?: () => HTMLElement | null }) {
    const panel = useRef<HTMLDivElement>(null);
    const close = useRef(onClose); close.current = onClose;
    const { layer, active } = useOutsidePanel(true, () => anchor?.() ?? null, () => panel.current, () => {
        const focused = document.activeElement;
        if (focused instanceof HTMLElement && panel.current?.contains(focused)) focused.blur();
        onClose();
    });
    useEffect(() => { if (!active) close.current(); }, [active]);
    return <ParentPanel.Provider value={layer}><div ref={panel} style={{ display: "contents" }}>{children}</div></ParentPanel.Provider>;
}

export function OutsideDrawer({ panelRef, onClose, ...props }: DrawerProps) {
    const panel = useRef<HTMLDivElement | null>(null);
    const enabled = props.maskClosable !== false && !(typeof props.mask === "object" && props.mask.closable === false);
    const { layer } = useOutsidePanel(Boolean(props.open && enabled && onClose), () => null, () => panel.current,
        event => onClose?.(event as Parameters<NonNullable<DrawerProps["onClose"]>>[0]), true);
    const ref = useCallback((element: HTMLDivElement | null) => { panel.current = element; assignRef(panelRef, element); }, [panelRef]);
    return <ParentPanel.Provider value={layer}><Drawer {...props} panelRef={ref} onClose={onClose} /></ParentPanel.Provider>;
}

export const OutsideDropdown = forwardRef<HTMLElement, DropdownProps>(function OutsideDropdown({ open, onOpenChange, popupRender, dropdownRender, ...props }, forwarded) {
    const [internal, setInternal] = useState(false);
    const trigger = useRef<HTMLElement | null>(null), popup = useRef<HTMLDivElement>(null);
    const change = useCallback((next: boolean, info: Parameters<NonNullable<DropdownProps["onOpenChange"]>>[1]) => {
        setInternal(next); onOpenChange?.(next, info);
    }, [onOpenChange]);
    const expanded = open ?? internal;
    const { layer, active } = useOutsidePanel(expanded, () => trigger.current,
        () => popup.current?.closest<HTMLElement>(`.${props.prefixCls || "ant-dropdown"}`) ?? popup.current,
        () => change(false, { source: "trigger" }));
    useEffect(() => { if (!active && expanded) change(false, { source: "trigger" }); }, [active, expanded, change]);
    const ref = useCallback((element: HTMLElement | null) => { trigger.current = element; assignRef(forwarded, element); }, [forwarded]);
    const render = popupRender ?? dropdownRender;
    const popupContainer = useNativePopupBoundary(active && expanded);
    const boundItems = (items: NonNullable<DropdownProps["menu"]>["items"]): typeof items => items?.map(item => {
        if (!item || !("children" in item)) return item;
        if (item.type === "group") return { ...item, children: boundItems(item.children) ?? [] };
        const renderSubmenu = "popupRender" in item ? item.popupRender : undefined;
        return { ...item, children: boundItems(item.children) ?? [], popupStyle: { ...item.popupStyle, ...NATIVE_POPUP_LIMIT },
            popupRender: (menu: React.ReactElement, info: Parameters<NonNullable<typeof renderSubmenu>>[1]) => (renderSubmenu ? renderSubmenu(menu, info) : menu) as React.ReactElement };
    });
    return <ParentPanel.Provider value={layer}><Dropdown {...props} rootClassName={[menuStyles.dropdown, props.rootClassName].filter(Boolean).join(" ")} getPopupContainer={popupContainer}
        align={{ ...props.align, targetOffset: toolbarPopupTargetOffset(trigger.current, props.placement) ?? props.align?.targetOffset }}
        styles={info => { const styles = typeof props.styles === "function" ? props.styles(info) : props.styles; return { ...styles, root: { ...styles?.root, ...NATIVE_POPUP_LIMIT } }; }}
        menu={props.menu ? { ...props.menu, getPopupContainer: popupContainer, items: boundItems(props.menu.items) } : undefined} ref={ref} open={active && expanded} onOpenChange={change}
        popupRender={menu => <div ref={popup} style={{ display: "contents" }}>{render ? render(menu) : menu}</div>} /></ParentPanel.Provider>;
});

export const OutsidePopover = forwardRef<ComponentRef<typeof Popover>, PopoverProps>(function OutsidePopover({ open, onOpenChange, ...props }, forwarded) {
    const [internal, setInternal] = useState(props.defaultOpen ?? false);
    const native = useRef<ComponentRef<typeof Popover> | null>(null), popup = useRef<HTMLDivElement>(null);
    const change = useCallback((next: boolean) => { setInternal(next); onOpenChange?.(next); }, [onOpenChange]);
    const expanded = open ?? internal;
    const { layer, active } = useOutsidePanel(expanded, () => native.current?.nativeElement ?? null,
        () => popup.current?.closest<HTMLElement>(`.${props.prefixCls || "ant-popover"}`) ?? native.current?.popupElement ?? null, () => change(false));
    useEffect(() => { if (!active && expanded) change(false); }, [active, expanded, change]);
    const ref = useCallback((element: ComponentRef<typeof Popover> | null) => { native.current = element; assignRef(forwarded, element); }, [forwarded]);
    const rawContent = props.content;
    const content = typeof rawContent === "function" ? rawContent : () => rawContent;
    const popupContainer = useNativePopupBoundary(active && expanded);
    return <ParentPanel.Provider value={layer}><Popover {...props} rootClassName={[menuStyles.popover, props.rootClassName].filter(Boolean).join(" ")} ref={ref} open={active && expanded} onOpenChange={change}
        align={{ ...props.align, targetOffset: toolbarPopupTargetOffset(native.current?.nativeElement ?? null, props.placement) ?? props.align?.targetOffset }}
        getPopupContainer={popupContainer}
        styles={info => { const styles = typeof props.styles === "function" ? props.styles(info) : props.styles; return { ...styles, root: { ...styles?.root, ...NATIVE_POPUP_LIMIT } }; }}
        content={() => <div ref={popup} style={{ display: "contents" }}>{content()}</div>} /></ParentPanel.Provider>;
});

const SelectWithOutside = forwardRef<ComponentRef<typeof Select>, ComponentProps<typeof Select>>(function SelectWithOutside({ open, onOpenChange, onDropdownVisibleChange, popupRender, dropdownRender, ...props }, forwarded) {
    const [internal, setInternal] = useState(props.defaultOpen ?? false);
    const native = useRef<ComponentRef<typeof Select> | null>(null), popup = useRef<HTMLDivElement>(null);
    const change = useCallback((next: boolean) => { setInternal(next); (onOpenChange ?? onDropdownVisibleChange)?.(next); }, [onOpenChange, onDropdownVisibleChange]);
    const expanded = open ?? internal;
    const { layer, active } = useOutsidePanel(expanded, () => native.current?.nativeElement ?? null,
        () => popup.current?.closest<HTMLElement>(`.${props.prefixCls || "ant-select"}-dropdown`) ?? popup.current, () => change(false));
    useEffect(() => { if (!active && expanded) change(false); }, [active, expanded, change]);
    const ref = useCallback((element: ComponentRef<typeof Select> | null) => { native.current = element; assignRef(forwarded, element); }, [forwarded]);
    const render = popupRender ?? dropdownRender;
    const popupContainer = useNativePopupBoundary(active && expanded);
    return <ParentPanel.Provider value={layer}><Select {...props} ref={ref} open={active && expanded} onOpenChange={change}
        popupClassName={[menuStyles.select, props.popupClassName].filter(Boolean).join(" ")}
        getPopupContainer={popupContainer}
        styles={info => { const styles = typeof props.styles === "function" ? props.styles(info) : props.styles; return { ...styles, popup: { ...styles?.popup, root: { ...styles?.popup?.root, ...NATIVE_POPUP_LIMIT } } }; }}
        popupRender={menu => <div ref={popup} style={{ display: "contents" }}>{render ? render(menu) : menu}</div>} /></ParentPanel.Provider>;
});

// 保留Ant Select的泛型调用签名与Option等静态入口。
export const OutsideSelect = Object.assign(SelectWithOutside, {
    Option: Select.Option, OptGroup: Select.OptGroup,
    SECRET_COMBOBOX_MODE_DO_NOT_USE: Select.SECRET_COMBOBOX_MODE_DO_NOT_USE,
    _InternalPanelDoNotUseOrYouWillBeFired: Select._InternalPanelDoNotUseOrYouWillBeFired,
}) as typeof Select;

export function OutsideTooltip({ open, onOpenChange, ...props }: ComponentProps<typeof Tooltip>) {
    const [internal, setInternal] = useState(Boolean(props.defaultOpen));
    const native = useRef<ComponentRef<typeof Tooltip>>(null);
    const expanded = open ?? internal;
    useEffect(() => {
        if (!expanded) return;
        const dismiss = () => { setInternal(false); onOpenChange?.(false); };
        window.addEventListener("pointerdown", dismiss, true);
        window.addEventListener("keydown", dismiss, true);
        return () => {
            window.removeEventListener("pointerdown", dismiss, true);
            window.removeEventListener("keydown", dismiss, true);
        };
    }, [expanded, onOpenChange]);
    const popupContainer = useNativePopupBoundary(expanded);
    const toolbarOffset = toolbarPopupTargetOffset(native.current?.nativeElement ?? null, props.placement ?? "top");
    return <Tooltip {...props} ref={native} open={expanded} getPopupContainer={popupContainer}
        align={{ ...props.align, targetOffset: toolbarOffset ?? props.align?.targetOffset, offset: toolbarOffset ? [0, -4] : props.align?.offset }}
        styles={info => { const styles = typeof props.styles === "function" ? props.styles(info) : props.styles; return { ...styles, root: { ...styles?.root, ...NATIVE_POPUP_LIMIT } }; }}
        onOpenChange={next => { setInternal(next); onOpenChange?.(next); }} />;
}
