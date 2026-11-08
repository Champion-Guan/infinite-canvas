export type TextRange = [number, number];
export type BilingualAlignment = [number, number, number, number][];
export type AlignedBilingualText = { chinese: string; english: string; alignment?: BilingualAlignment };

// 模型返回原文片段，由程序计算偏移，避免模型数错字符或重复保存两份全文。
export function readBilingualSegments(value: unknown): AlignedBilingualText | undefined {
    const segments = (value as { segments?: unknown } | null)?.segments;
    if (segments === undefined) return undefined;
    if (!Array.isArray(segments) || !segments.length || segments.length > 400) throw Error("双语对应片段不完整，请重试。");
    let chinese = "", english = "";
    const alignment: BilingualAlignment = [];
    for (const item of segments) {
        if (!item || typeof item.chinese !== "string" || !item.chinese.trim() || typeof item.english !== "string" || !item.english.trim())
            throw Error("双语对应片段缺少中文或英文，请重试。");
        alignment.push([chinese.length, chinese.length + item.chinese.length, english.length, english.length + item.english.length]);
        chinese += item.chinese; english += item.english;
        if (chinese.length > 100_000 || english.length > 100_000) throw Error("双语内容过长，请精简后重试。");
    }
    const left = chinese.length - chinese.trimStart().length, right = english.length - english.trimStart().length;
    chinese = chinese.trim(); english = english.trim();
    return { chinese, english, alignment: alignment.map(([a, b, c, d]) => [
        Math.max(0, a - left), Math.min(chinese.length, b - left), Math.max(0, c - right), Math.min(english.length, d - right),
    ]) };
}

function clauses(text: string): TextRange[] {
    // 小数、文件名和参考ID保持完整；括号外的指令可单独对应。
    const ranges: TextRange[] = [];
    let start = 0;
    const add = (end: number) => {
        let a = start, b = end;
        while (a < b && /[\s，,；;：:（）()。.!?！？]/.test(text[a])) a++;
        while (b > a && /[\s，,；;：:（）()。.!?！？]/.test(text[b - 1])) b--;
        if (b > a) ranges.push([a, b]);
        start = end;
    };
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (/[；;。!！?？\n（）()]/.test(char) || char === "." && (!text[i + 1] || /\s/.test(text[i + 1]))) add(i + 1);
    }
    add(text.length);
    return ranges;
}
const anchors = (text: string) => new Set((text.toLowerCase().match(/[a-z0-9]+(?:[._/-][a-z0-9]+)*/g) || []).filter(word => /\d/.test(word) || word.length > 3));

export function bilingualAlignment(chinese: string, english: string, supplied?: BilingualAlignment): BilingualAlignment {
    if (supplied?.length && supplied.every(row => Array.isArray(row) && row.length === 4 && row.every(Number.isSafeInteger)
        && row[0] >= 0 && row[1] > row[0] && row[1] <= chinese.length && row[2] >= 0 && row[3] > row[2] && row[3] <= english.length))
        return supplied;
    if (!chinese.trim() || !english.trim()) return [];
    const zh = clauses(chinese), en = clauses(english);
    if (!zh.length || !en.length || zh.length > 300 || en.length > 300) return [];
    const zhKeys = zh.map(([a, b]) => anchors(chinese.slice(a, b))), enKeys = en.map(([a, b]) => anchors(english.slice(a, b)));
    // 旧全文按语句顺序及共同数字/参考ID匹配；没有证据时保留语句级定位，不伪造词级偏移。
    const rows: BilingualAlignment = [];
    let previous = 0;
    for (let i = 0; i < zh.length; i++) {
        const expected = i * en.length / zh.length;
        let best = Math.max(previous, Math.min(en.length - 1, Math.round(expected))), bestScore = -Infinity;
        for (let j = previous; j < en.length; j++) {
            const common = [...zhKeys[i]].filter(key => enKeys[j].has(key)).length;
            const score = common * 12 - Math.abs(j - expected) * 1.5;
            if (score > bestScore) { best = j; bestScore = score; }
        }
        rows.push([...zh[i], ...en[best]]); previous = best;
    }
    return rows;
}

export function correspondingRanges(alignment: BilingualAlignment, language: "chinese" | "english", selection: TextRange): TextRange[] {
    const source = language === "chinese" ? 0 : 2, target = source === 0 ? 2 : 0;
    const matches = alignment.filter(row => row[source] < selection[1] && row[source + 1] > selection[0])
        .map(row => [row[target], row[target + 1]] as TextRange).sort((a, b) => a[0] - b[0]);
    return matches.reduce<TextRange[]>((result, range) => {
        const last = result.at(-1);
        if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
        else result.push([...range]);
        return result;
    }, []);
}

export function linkedScrollTop(source: Pick<HTMLElement, "scrollTop" | "scrollHeight" | "clientHeight">,
    target: Pick<HTMLElement, "scrollHeight" | "clientHeight">) {
    const from = source.scrollHeight - source.clientHeight, to = Math.max(0, target.scrollHeight - target.clientHeight);
    return from > 0 ? Math.max(0, Math.min(1, source.scrollTop / from)) * to : 0;
}
