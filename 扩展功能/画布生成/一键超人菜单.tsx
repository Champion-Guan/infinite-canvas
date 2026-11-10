import { useState } from "react";
import { Button, Input, Tooltip } from "antd";
import { ChevronRight, Languages, Palette, Ruler, WandSparkles, Zap } from "lucide-react";
import { OutsideDropdown, OutsidePopover } from "../主题/原生可关闭浮层";
import { imageSuperActions, type ImageSuperAction } from "./一键超人规则";

export function ImageSuperMenu({ open, onOpenChange, onGenerate, showLabel }: {
    open: boolean;
    onOpenChange(open: boolean): void;
    onGenerate(action: ImageSuperAction, value: string): boolean;
    showLabel: boolean;
}) {
    const [values, setValues] = useState<Record<ImageSuperAction, string>>({ language: "", color: "", dimensions: "" });
    const [activeKey, setActiveKey] = useState<ImageSuperAction | null>(null);
    const changeOpen = (next: boolean) => {
        if (!next) setActiveKey(null);
        onOpenChange(next);
    };
    const icons = { language: <Languages size={16} />, color: <Palette size={16} />, dimensions: <Ruler size={16} /> };
    return (
        <OutsideDropdown
            open={open}
            trigger={["click"]}
            destroyOnHidden
            placement="bottomLeft"
            overlayStyle={{ width: 156, minWidth: 156 }}
            onOpenChange={(next, info) => { if (info.source !== "menu") changeOpen(next); }}
            popupRender={menu => (
                    <div style={{ width: 156 }} onKeyDown={event => {
                        if (event.key === "Escape") changeOpen(false);
                        if (event.key === "ArrowRight") {
                            const target = event.target as HTMLElement;
                            const key = target.closest('[role="menuitem"]')?.querySelector<HTMLElement>("[data-super-action]")?.dataset.superAction;
                            if (imageSuperActions.some(action => action.key === key)) {
                                event.preventDefault();
                                setActiveKey(key as ImageSuperAction);
                            }
                        }
                    }}>{menu}</div>
            )}
            menu={{
                selectable: false,
                style: { width: 156, minWidth: 156 },
                items: imageSuperActions.map(action => ({
                    key: action.key,
                    style: { paddingBlock: 4 },
                    onMouseEnter: () => setActiveKey(action.key),
                    onClick: () => setActiveKey(action.key),
                    label: (
                        <OutsidePopover open={open && activeKey === action.key} placement="rightTop" arrow={false}
                            align={{ offset: [24, 0] }}
                            trigger={[]} destroyOnHidden
                            onOpenChange={next => setActiveKey(current => next ? action.key : current === action.key ? null : current)}
                            content={
                                <div data-canvas-shortcuts-ignore
                                    style={{ display: "flex", alignItems: "center", gap: 8, width: 320, maxWidth: "calc(100vw - 48px)" }}
                                    onPointerDown={event => event.stopPropagation()}
                                    onMouseDown={event => event.stopPropagation()}
                                    onKeyDown={event => {
                                        event.stopPropagation();
                                        if (event.key === "Escape") changeOpen(false);
                                    }}>
                                    <Input.TextArea
                                        aria-label={`${action.label}要求`}
                                        placeholder={action.placeholder}
                                        autoSize={{ minRows: 2, maxRows: 5 }}
                                        style={{ flex: "1 1 0", minWidth: 0, resize: "none" }}
                                        value={values[action.key]}
                                        onChange={event => setValues(current => ({ ...current, [action.key]: event.target.value }))}
                                    />
                                    <Tooltip title="生图">
                                        <Button type="primary" aria-label={`${action.label}生图`} icon={<WandSparkles size={16} />}
                                            style={{ flex: "0 0 32px" }}
                                            disabled={!values[action.key].trim()}
                                            onClick={() => {
                                                if (onGenerate(action.key, values[action.key])) changeOpen(false);
                                            }} />
                                    </Tooltip>
                                </div>
                            }>
                            <span data-super-action={action.key} style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 32, marginBlock: -4, paddingBlock: 4 }}
                                onMouseEnter={() => setActiveKey(action.key)}>
                                {icons[action.key]}<span style={{ flex: 1, whiteSpace: "nowrap" }}>{action.label}</span>
                                <ChevronRight size={12} />
                            </span>
                        </OutsidePopover>
                    ),
                })),
            }}
        >
            <button type="button" aria-label="一键超人" aria-haspopup="menu" aria-expanded={open}
                className="group relative flex h-12 items-center whitespace-nowrap px-1.5">
                <Tooltip title={open ? null : "一键超人"} mouseEnterDelay={0.2}>
                    <span className={`flex h-9 items-center gap-2 rounded-lg px-2 transition group-hover:bg-[#f0f0f1] ${open ? "bg-[#eeeeef]" : ""}`}>
                        <Zap className="size-4" />
                        {showLabel ? <span>一键超人</span> : null}
                    </span>
                </Tooltip>
            </button>
        </OutsideDropdown>
    );
}
