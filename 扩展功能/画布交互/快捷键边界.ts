// 鼠标点击画布命令后，空格回到画布；Tab聚焦的按钮及输入、弹层保留原生键盘操作。
const protectedTarget = 'input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="dialog"],[role="menu"],[role="listbox"],[data-canvas-shortcuts-ignore],.ant-modal,.ant-drawer,.ant-popover,.ant-select-dropdown,.ant-dropdown,[data-canvas-settings-popover]';
const nativeSpaceControl = 'button,a[href],[role="button"],[role="checkbox"],[role="switch"],[role="tab"],[role="separator"]';

export function focusCanvasFromPointer(target: EventTarget | null, surface: HTMLElement) {
    if (!(target instanceof Element) || target.closest(protectedTarget)
        || target.closest(`${nativeSpaceControl},[role="radio"]`)) return;
    // 空白画布和非交互卡片不会自然获得焦点，显式接回快捷键且不滚动视区。
    surface.focus({ preventScroll: true });
}

export function canvasPointerAction(target: EventTarget | null) {
    if (!(target instanceof Element) || target.closest(protectedTarget)) return null;
    const action = target.closest('button,[role="button"]');
    if (target.closest('[data-canvas-no-zoom]') && !target.closest('[data-node-id]')) return null;
    return action?.matches('[role="checkbox"],[role="switch"],[role="radio"],[role="tab"],[role="separator"]') ? null : action;
}

export function ignoreCanvasShortcut(event: KeyboardEvent, space = false, pointerAction?: Element | null) {
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return true;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest(protectedTarget)) return true;
    const control = space ? target?.closest(nativeSpaceControl) : null;
    // 卡片内容的no-zoom只保护滚动/编辑；鼠标命令留下的按钮焦点仍可交还空格给画布。
    if (target?.closest('[data-canvas-no-zoom]') && !(control && control === pointerAction)) return true;
    if (space) {
        if (control && control !== pointerAction) return true;
    }
    // 焦点陷阱建立前及焦点暂时落在body时，也不能穿透当前可见的模态窗口。
    return [...document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"],dialog[open]')]
        .some(dialog => !dialog.closest('[inert],[aria-hidden="true"]') && dialog.getClientRects().length > 0 && getComputedStyle(dialog).visibility !== "hidden");
}
