import type { ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";
import { OutsideDropdown } from "../主题/原生可关闭浮层";
import { modelTextReasoningEfforts, modelTextReasoningEffortOptions, normalizeTextReasoningEffort, type TextReasoningEffort } from "./文本推理强度";
import type { AiConfig } from "@/stores/use-config-store";
import { reasoningEffortLabel } from "@/components/text-settings-panel";
import menuStyles from "../主题/苹果下拉菜单.module.css";

export function TextModelReasoningMenu({ config, options, value, open, onOpenChange, onSelect, renderModel, className, placeholder }: {
    config: AiConfig; options: string[]; value: string; open: boolean; onOpenChange(open: boolean): void;
    onSelect(model: string, effort: TextReasoningEffort): void; renderModel(model: string, compact?: boolean): ReactNode;
    className?: string; placeholder: string;
}) {
    const choices = new Map<string, { model: string; effort: TextReasoningEffort }>();
    const items = options.map((model, index) => {
        const supported = modelTextReasoningEfforts(config, model);
        return {
            key: `model-${index}`,
            popupOffset: [12, -7],
            popupStyle: { zIndex: 1201 },
            popupClassName: menuStyles.submenu,
            label: <span className="flex w-full min-w-0 items-center gap-2">
                <span className="min-w-0 flex-1">{renderModel(model)}</span>
                {model === value ? <Check aria-hidden className="size-4 shrink-0" /> : null}
            </span>,
            children: modelTextReasoningEffortOptions(model).map(effort => {
                const key = `${index}-${effort}`;
                choices.set(key, { model, effort });
                return { key, disabled: !supported.includes(effort),
                    label: <span className="flex min-w-24 items-center gap-4">
                        <span className="min-w-0 flex-1 text-left">{reasoningEffortLabel(effort)}</span>
                        {model === value && normalizeTextReasoningEffort(config.reasoningEffort) === effort
                            ? <Check aria-hidden className="size-3.5 shrink-0" />
                            : <span aria-hidden className="inline-block size-3.5 shrink-0" />}
                    </span>,
                    title: !supported.includes(effort) ? "当前渠道模型未声明支持此推理强度" : undefined };
            }),
        };
    });
    return <OutsideDropdown open={open} trigger={["click"]} placement="bottomLeft" destroyOnHidden
        rootClassName={menuStyles.dropdown}
        overlayStyle={{ width: 320, maxWidth: "calc(100vw - 24px)", zIndex: 1200 }}
        onOpenChange={onOpenChange}
        popupRender={menu => <div data-canvas-no-zoom data-text-model-reasoning-menu
            onPointerDown={event => event.stopPropagation()} onMouseDown={event => event.stopPropagation()}
            onKeyDown={event => {
                event.stopPropagation();
                if (event.key === "Escape") onOpenChange(false);
            }}>{menu}</div>}
        menu={{ items, style: { maxHeight: "calc(100vh - 24px)", overflowY: "auto" },
            triggerSubMenuAction: "hover", subMenuOpenDelay: 0.12, subMenuCloseDelay: 0.15,
            onClick: ({ key }) => {
                const choice = choices.get(key);
                if (!choice || !modelTextReasoningEfforts(config, choice.model).includes(choice.effort)) return;
                onSelect(choice.model, choice.effort);
                onOpenChange(false);
            } }}>
        <button type="button" className={className} aria-label="选择文本模型与推理强度" aria-haspopup="menu" aria-expanded={open}
            title={value ? undefined : placeholder}
            onMouseDown={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()}>
            <span className="min-w-0 flex-1 text-left">{value ? renderModel(value, true) : placeholder}</span>
            <ChevronDown aria-hidden className="size-4 shrink-0 opacity-60" />
        </button>
    </OutsideDropdown>;
}
