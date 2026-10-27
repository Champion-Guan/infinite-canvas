// 画布快捷键只作用于画布；弹层、输入和原生按钮优先处理自己的键盘操作。
const protectedTarget = 'input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="dialog"],[role="menu"],[role="listbox"],[data-canvas-no-zoom],[data-canvas-shortcuts-ignore],.ant-modal,.ant-drawer,.ant-popover,.ant-select-dropdown,.ant-dropdown,[data-canvas-settings-popover]';

export function ignoreCanvasShortcut(event: KeyboardEvent, space = false) {
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return true;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest(protectedTarget)) return true;
    if (space && target?.closest('button,a[href],[role="button"],[role="checkbox"],[role="switch"],[role="tab"],[role="separator"]')) return true;
    // 焦点陷阱建立前及焦点暂时落在body时，也不能穿透当前可见的模态窗口。
    return [...document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"],dialog[open]')]
        .some(dialog => !dialog.closest('[inert],[aria-hidden="true"]') && dialog.getClientRects().length > 0 && getComputedStyle(dialog).visibility !== "hidden");
}
