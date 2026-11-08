import { useCallback, useLayoutEffect, useMemo, useRef, useState, type TextareaHTMLAttributes } from "react";
import { bilingualAlignment, correspondingRanges, linkedScrollTop, type BilingualAlignment, type TextRange } from "./双语片段对齐";
import styles from "./双语联动文本框.module.css";

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

export function BilingualPromptField({ link, language, ...props }: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value"> & {
    link: Link; language: Language; value: string;
}) {
    const textarea = useRef<HTMLTextAreaElement>(null), overlay = useRef<HTMLDivElement>(null), mirror = useRef<HTMLDivElement>(null);
    const marked = useMemo(() => link.ready && link.highlight[language]?.text === props.value
        ? link.highlight[language]?.ranges || [] : [], [link.ready, link.highlight, language, props.value]);
    const syncMirror = useCallback(() => {
        const input = textarea.current, pane = overlay.current, content = mirror.current;
        if (!input || !pane || !content) return;
        const css = getComputedStyle(input);
        Object.assign(pane.style, { left: `${input.clientLeft}px`, top: `${input.clientTop}px`,
            width: `${input.clientWidth}px`, height: `${input.clientHeight}px` });
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
    useLayoutEffect(syncMirror);
    useLayoutEffect(() => {
        if (!marked.length || !textarea.current || !mirror.current) return;
        const mark = mirror.current.querySelector("mark");
        if (!(mark instanceof HTMLElement)) return;
        const input = textarea.current, start = mark.offsetTop, bottom = start + mark.offsetHeight;
        if (start < input.scrollTop || bottom > input.scrollTop + input.clientHeight)
            link.reveal(input, Math.max(0, start - input.clientHeight / 3));
        syncMirror();
    }, [marked, link, syncMirror]);
    let cursor = 0;
    const parts = marked.flatMap(([a, b], index) => {
        const before = props.value.slice(cursor, a); cursor = b;
        return [before, <mark key={index}>{props.value.slice(a, b)}</mark>];
    });
    return <div className={styles.field}>
        <textarea {...props} ref={textarea} lang={language === "chinese" ? "zh" : "en"}
            onSelect={event => { link.select(language, event.currentTarget); props.onSelect?.(event); }}
            onScroll={event => { syncMirror(); link.scroll(language, event.currentTarget); props.onScroll?.(event); }} />
        <div ref={overlay} className={styles.overlay} aria-hidden="true">
            <div ref={mirror} className={styles.mirror}>{parts}{props.value.slice(cursor)}{"\n"}</div>
        </div>
    </div>;
}
