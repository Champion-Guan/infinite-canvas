import { cloneElement, useCallback, useState, type ReactElement, type Ref } from "react";
import { useFloatingBoundary } from "./浮层边界接线";

export function CanvasFloatingBoundary({ children }: { children: ReactElement }) {
    const [element, setElement] = useState<HTMLElement | null>(null);
    const child = children as ReactElement<{ ref?: Ref<HTMLElement> }>;
    const forwarded = child.props.ref;
    const ref = useCallback((node: HTMLElement | null) => {
        setElement(node);
        if (typeof forwarded === "function") forwarded(node);
        else if (forwarded) forwarded.current = node;
    }, [forwarded]);
    useFloatingBoundary(Boolean(element), () => element, () => element);
    return cloneElement(child, { ref });
}
