/** Display-only segments. Joining text always reconstructs the stored content. */
export function promptHighlightSegments(content, raw, values = {}) {
    const split = (text, substitute) => {
        const segments = [];
        let end = 0;
        for (const match of text.matchAll(/\[[^\]\r\n]{1,160}\]/g)) {
            if (match.index > end) segments.push({ text: text.slice(end, match.index) });
            const token = match[0];
            const value = substitute ? String(values[token] ?? "").trim() : "";
            segments.push({ text: value || token, token });
            end = match.index + token.length;
        }
        if (end < text.length) segments.push({ text: text.slice(end) });
        return segments;
    };
    if (typeof raw === "string") {
        const resolved = split(raw, true);
        // Only use source provenance when it exactly matches the final card.
        // Manual edits must never be overwritten or guessed by value matching.
        const reconstructed = resolved.map(part => part.text).join("");
        const suffix = content.startsWith(reconstructed) ? content.slice(reconstructed.length) : null;
        const generatedSuffix = suffix === "" || suffix?.startsWith("\n\n【变量与画面约束】\n") || suffix?.startsWith("\n\n【产品补充】\n");
        if (generatedSuffix) return suffix ? [...resolved, { text: suffix }] : resolved;
    }
    return split(content, false);
}
