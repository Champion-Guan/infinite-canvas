import { DropdownMenu } from "radix-ui";
import { Check, ChevronDown } from "lucide-react";
import type { ProductOption } from "./旧版参数规则";

type ProductOptionSelectProps = {
    value: string;
    options: readonly ProductOption[];
    onChange: (value: string) => void;
    borderColor: string;
    textColor: string;
    label: string;
};

export function ProductOptionSelect({ value, options, onChange, borderColor, textColor, label }: ProductOptionSelectProps) {
    const selectedOption = options.find(option => option.value === value);
    return (
        <DropdownMenu.Root modal={false}>
            <DropdownMenu.Trigger
                type="button"
                aria-label={label}
                className="group flex h-8 w-full min-w-0 items-center justify-between gap-1.5 rounded-lg border bg-white/65 px-3 text-xs shadow-sm outline-none transition-[background-color,box-shadow,transform] duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-white/90 active:scale-[.98] focus-visible:ring-2 focus-visible:ring-stone-400/50 motion-reduce:transform-none motion-reduce:transition-none dark:bg-white/[.06] dark:hover:bg-white/[.1]"
                style={{ borderColor, color: textColor }}
            >
                <span className="truncate">{selectedOption?.label || `选择${label}`}</span>
                <ChevronDown aria-hidden="true" className="pointer-events-none size-4 shrink-0 opacity-60 transition-transform duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] group-data-[state=open]:rotate-180 motion-reduce:transition-none" />
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
                <DropdownMenu.Content
                    data-card-panel-anchor
                    aria-label={label}
                    align="start"
                    sideOffset={6}
                    collisionPadding={8}
                    loop
                    className="guan-scroll-region thin-scrollbar z-[80] max-h-[min(var(--radix-dropdown-menu-content-available-height),18rem)] min-w-[var(--radix-dropdown-menu-trigger-width)] origin-[var(--radix-dropdown-menu-content-transform-origin)] overflow-y-auto overscroll-contain rounded-lg border bg-white p-1 shadow-lg outline-none duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:data-[side=bottom]:slide-in-from-top-1 data-[state=open]:data-[side=top]:slide-in-from-bottom-1 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=closed]:pointer-events-none motion-reduce:animate-none dark:bg-stone-900"
                    style={{ borderColor, color: textColor }}
                    onMouseDown={event => event.stopPropagation()}
                    onWheel={event => event.stopPropagation()}
                >
                    <DropdownMenu.RadioGroup value={selectedOption?.value || ""} onValueChange={onChange}>
                        {options.map(option => (
                            <DropdownMenu.RadioItem
                                key={option.value}
                                value={option.value}
                                className="relative flex min-h-9 cursor-default select-none items-center rounded-md py-2 pl-3 pr-9 text-sm outline-none transition-colors duration-150 data-[state=checked]:bg-black/[.06] data-[highlighted]:bg-black/[.06] motion-reduce:transition-none dark:data-[state=checked]:bg-white/[.1] dark:data-[highlighted]:bg-white/[.1]"
                            >
                                {option.label}
                                <DropdownMenu.ItemIndicator className="pointer-events-none absolute right-2 flex size-4 items-center justify-center">
                                    <Check aria-hidden="true" className="size-4" />
                                </DropdownMenu.ItemIndicator>
                            </DropdownMenu.RadioItem>
                        ))}
                    </DropdownMenu.RadioGroup>
                </DropdownMenu.Content>
            </DropdownMenu.Portal>
        </DropdownMenu.Root>
    );
}
