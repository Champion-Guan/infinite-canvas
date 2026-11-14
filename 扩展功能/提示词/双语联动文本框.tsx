import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type TextareaHTMLAttributes } from "react";
import { bilingualAlignment, correspondingRanges, linkedScrollTop, type BilingualAlignment, type TextRange } from "./双语片段对齐";
import styles from "./双语联动文本框.module.css";
import { useThemeStore } from "@/stores/use-theme-store";

type Language = "chinese" | "english";
type Highlight = { text: string; ranges: TextRange[] };
export function useBilingualPromptSync({ chinese, english, alignment, ready = true }: {
    chinese: string; english: string; alignment?: BilingualAlignment; ready?: boolean;
}) {
    const fields = useRef<Partial<Record<Language, HTMLTextAreaElement>>>({});
    const expectedScroll = useRef(new WeakMap<HTMLTextAreaElement, number>());
    const [highlight, setHighlight] = useState<Partial<Record<Language, Highlight>>>({});
    const matches = useMemo(() => ready ? bilingualAlignment(chinese, english, alignment) : [], [chinese, english, alignment, ready]);
    const select = (language: Language, element: HTMLTextAreaElement) => {
        const start = element.selectionStart, end = element.selectionEnd;
        if (start === end) { setHighlight({}); return; }
        const other = language === "chinese" ? "english" : "chinese";
        setHighlight({ [other]: { text: other === "chinese" ? chinese : english, ranges: correspondingRanges(matches, language, [start, end]) } });
    };
    const scroll = (language: Language, element: HTMLTextAreaElement) => {
        const expected = expectedScroll.current.get(element);
        expectedScroll.current.delete(element);
        if (expected !== undefined && Math.abs(element.scrollTop - expected) < 1) return;
        const target = fields.current[language === "chinese" ? "english" : "chinese"];
        if (!target) return;
        const top = linkedScrollTop(element, target);
        if (Math.abs(target.scrollTop - top) < 1) return;
        expectedScroll.current.set(target, top);
        target.scrollTop = top;
    };
    const reveal = (element: HTMLTextAreaElement, top: number) => {
        expectedScroll.current.set(element, top);
        element.scrollTop = top;
    };
    return { fields, highlight, select, scroll, reveal, ready };
}
type Link = ReturnType<typeof useBilingualPromptSync>;

export function BilingualPromptField({ link, language, variableRanges = [], onVariableClick, inlineReferences = [], ...props }: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value"> & {
    link: Link; language: Language; value: string;
    variableRanges?: Array<{ id: string; start: number; end: number }>; onVariableClick?: (id: string) => void;
    inlineReferences?: Array<{ start: number; end: number; content: ReactNode }>;
}) {
    const theme = useThemeStore(state => state.theme);
    const textarea = useRef<HTMLTextAreaElement>(null), overlay = useRef<HTMLDivElement>(null), mirror = useRef<HTMLDivElement>(null);
    const marked = useMemo(() => link.ready && link.highlight[language]?.text === props.value
        ? link.highlight[language]?.ranges || [] : [], [link.ready, link.highlight, language, props.value]);
    const syncMirror = useCallback(() => {
        const input = textarea.current, pane = overlay.current, content = mirror.current;
        if (!input || !pane || !content) return;
        const css = getComputedStyle(input);
        Object.assign(pane.style, { left: `${input.clientLeft}px`, top: `${input.clientTop}px`,
            width: `${input.clientWidth}px`, height: `${input.clientHeight}px`, color: getComputedStyle(input.parentElement!).color });
        Object.assign(content.style, { width: `${input.clientWidth}px`, padding: css.padding, font: css.font,
            letterSpacing: css.letterSpacing, wordSpacing: css.wordSpacing, textIndent: css.textIndent,
            lineHeight: css.lineHeight, wordBreak: css.wordBreak, tabSize: css.tabSize,
            transform: `translate(${-input.scrollLeft}px, ${-input.scrollTop}px)` });
    }, []);
    useLayoutEffect(() => {
        const input = textarea.current;
        if (!input) return;
        link.fields.current[language] = input;
        syncMirror();
        const observer = new ResizeObserver(syncMirror); observer.observe(input);
        return () => { observer.disconnect(); if (link.fields.current[language] === input) delete link.fields.current[language]; };
    }, [link.fields, language, syncMirror]);
    const mirrorStyle = JSON.stringify(props.style);
    useLayoutEffect(syncMirror, [syncMirror, props.value, props.className, mirrorStyle, theme]);
    useLayoutEffect(() => {
        if (!marked.length || !textarea.current || !mirror.current) return;
        const mark = mirror.current.querySelector("mark");
        if (!(mark instanceof HTMLElement)) return;
        const input = textarea.current, start = mark.offsetTop, bottom = start + mark.offsetHeight;
        if (start < input.scrollTop || bottom > input.scrollTop + input.clientHeight)
            link.reveal(input, Math.max(0, start - input.clientHeight / 3));
        syncMirror();
    }, [marked, link, syncMirror]);
    const highlights = [...marked, ...variableRanges.map(item => [item.start, item.end] as TextRange)].sort((a, b) => a[0] - b[0])
        .reduce<TextRange[]>((result, range) => {
            const previous = result.at(-1);
            if (previous && range[0] <= previous[1]) previous[1] = Math.max(previous[1], range[1]);
            else result.push([...range]);
            return result;
        }, []);
    const boundaries = [...new Set([0, props.value.length, ...highlights.flat(), ...inlineReferences.flatMap(item => [item.start, item.end])])]
        .filter(offset => !inlineReferences.some(item => offset > item.start && offset < item.end)).sort((a, b) => a - b);
    const parts = boundaries.slice(0, -1).map((start, index) => {
        const end = boundaries[index + 1], reference = inlineReferences.find(item => item.start === start && item.end === end);
        const content = reference?.content || props.value.slice(start, end);
        return highlights.some(([a, b]) => start < b && end > a) ? <mark key={index} aria-hidden={!reference || undefined}>{content}</mark>
            : <span key={index} aria-hidden={!reference || undefined}>{content}</span>;
    });
    return <div className={styles.field}>
        <textarea {...props} ref={textarea} lang={language === "chinese" ? "zh" : "en"}
            style={inlineReferences.length ? { ...props.style, color: "transparent", caretColor: props.style?.color || "currentColor" } : props.style}
            onKeyDown={event => {
                const input = event.currentTarget, a = input.selectionStart, b = input.selectionEnd;
                if (!event.nativeEvent.isComposing && (event.key === "Backspace" || event.key === "Delete")) {
                    const reference = inlineReferences.find(item => a === b
                        ? event.key === "Backspace" ? a > item.start && a <= item.end : a >= item.start && a < item.end
                        : a < item.end && b > item.start);
                    if (reference) input.setSelectionRange(Math.min(a, reference.start), Math.max(b, reference.end));
                }
                props.onKeyDown?.(event);
            }}
            onClick={event => {
                props.onClick?.(event);
                const position = event.currentTarget.selectionStart;
                if (position !== event.currentTarget.selectionEnd) return;
                const variable = variableRanges.find(item => position >= item.start && position < item.end);
                if (variable) onVariableClick?.(variable.id);
            }}
            onSelect={event => { link.select(language, event.currentTarget); props.onSelect?.(event); }}
            onScroll={event => { syncMirror(); link.scroll(language, event.currentTarget); props.onScroll?.(event); }} />
        <div ref={overlay} className={styles.overlay} aria-hidden={inlineReferences.length ? undefined : true} style={{ color: props.style?.color }}>
            <div ref={mirror} className={`${styles.mirror} ${inlineReferences.length ? styles.referenceMirror : ""}`}>{parts}{"\n"}</div>
        </div>
    </div>;
}
