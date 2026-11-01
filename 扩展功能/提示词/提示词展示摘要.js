const VARIABLE_PATTERN = /\[[^\]\r\n]{1,160}\]/g;
const PIXEL_PATTERNS = [
    /(?:输出|生成|目标)?(?:图片|图像)?(?:分辨率|像素)\s*[：:=]?\s*\d{2,5}\s*[x×*]\s*\d{2,5}(?:\s*(?:px|pixels?|像素))?/gi,
    /(?:输出|生成|目标)(?:图片|图像)?尺寸\s*[：:=]?\s*\d{2,5}\s*[x×*]\s*\d{2,5}(?:\s*(?:px|pixels?|像素))?/gi,
    /(?:output\s*size|image\s*size|pixel\s*size|resolution)\s*[：:=]?\s*\d{2,5}\s*[x×*]\s*\d{2,5}(?:\s*(?:px|pixels?))?/gi,
    /\b\d{2,5}\s*[x×*]\s*\d{2,5}\s*(?:px|pixels?|像素)/gi,
];
const RATIO_PATTERN = /(?:宽高比|比例|aspect\s*ratio|ratio)\s*[：:=]?\s*\d{1,2}\s*:\s*\d{1,2}/gi;
const COMMON_RATIO_PATTERN = /\b(?:1\s*:\s*1|2\s*:\s*3|3\s*:\s*2|3\s*:\s*4|4\s*:\s*3|4\s*:\s*5|5\s*:\s*4|9\s*:\s*16|16\s*:\s*9|21\s*:\s*9)(?!\d)/gi;
const THEME_LABEL_PATTERN = /(?:主题(?:\/角度)?|theme|core\s*visual|visual\s*focus|camera\s*angle|shot\s*type|composition\s*lock|拍摄角度|角度)\s*[：:]\s*[^\r\n.;。；]{1,120}/gi;

function text(value) {
    return String(value ?? "").trim();
}

function firstMatch(patterns, value) {
    for (const pattern of patterns) {
        const match = value.match(pattern);
        if (match) return match[0].match(/\d{2,5}\s*[x×*]\s*\d{2,5}(?:\s*(?:px|pixels?|像素))?/i)?.[0].trim() || match[0].trim();
    }
    return "";
}

function explicitSummary(prompt) {
    const match = prompt.match(/(?:摘要|总结|summary|brief)\s*[：:]\s*([^\r\n]+)/i);
    return match?.[1]?.trim().replace(/[。；;]+$/, "") || "";
}

function promptVariables(prompt) {
    return [...new Set(prompt.match(VARIABLE_PATTERN) || [])];
}

export function promptDisplaySummary(prompt, metadata = {}) {
    const content = text(prompt);
    const width = Number(metadata.generationPixelWidth);
    const height = Number(metadata.generationPixelHeight);
    const pixels = width > 0 && height > 0
        ? `${width} × ${height} px`
        : firstMatch(PIXEL_PATTERNS, content);
    const ratioValue = text(metadata.generationAspectRatio) || firstMatch([RATIO_PATTERN, COMMON_RATIO_PATTERN], content);
    const ratio = ratioValue.match(/\d{1,2}\s*:\s*\d{1,2}/)?.[0].replace(/\s+/g, "") || "";
    const theme = text(metadata.excelPromptTheme || metadata.promptVariablePromptTheme)
        || (content.match(THEME_LABEL_PATTERN)?.[0]?.replace(/^.*?[：:]/, "").trim() || "");
    const summary = explicitSummary(content)
        || text(metadata.excelPromptPurpose || metadata.promptVariablePurpose)
        || text(metadata.excelPromptCompositionLock || metadata.promptVariableCompositionLock);
    const variables = Array.isArray(metadata.excelPromptTokens) && metadata.excelPromptTokens.length
        ? [...new Set(metadata.excelPromptTokens.map(text).filter(Boolean))]
        : Array.isArray(metadata.promptVariableTokens) && metadata.promptVariableTokens.length
          ? [...new Set(metadata.promptVariableTokens.map(text).filter(Boolean))]
          : promptVariables(content);
    return { summary, theme, pixels, ratio, variables };
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchesIn(value, pattern, kind, priority, exact = false) {
    const matcher = exact ? new RegExp(escapeRegExp(pattern), "gi") : pattern;
    return [...value.matchAll(matcher)].filter(match => match[0].trim()).map(match => ({
        start: match.index,
        end: match.index + match[0].length,
        kind,
        priority,
    }));
}

function enrichPlainSegment(segment, summary) {
    const value = segment.text;
    if (!value) return [];
    const matches = [
        ...matchesIn(value, THEME_LABEL_PATTERN, "theme", 1),
        ...(summary.theme ? matchesIn(value, summary.theme, "theme", 2, true) : []),
        ...PIXEL_PATTERNS.flatMap(pattern => matchesIn(value, pattern, "pixels", 3)),
        ...matchesIn(value, RATIO_PATTERN, "ratio", 4),
        ...matchesIn(value, COMMON_RATIO_PATTERN, "ratio", 5),
    ].sort((a, b) => a.start - b.start || a.priority - b.priority || b.end - a.end);
    const output = [];
    let offset = 0;
    for (const match of matches) {
        if (match.start < offset) continue;
        if (match.start > offset) output.push({ text: value.slice(offset, match.start) });
        output.push({ text: value.slice(match.start, match.end), kind: match.kind });
        offset = match.end;
    }
    if (offset < value.length) output.push({ text: value.slice(offset) });
    return output;
}

export function promptDisplaySegments(segments, summary) {
    return segments.flatMap(segment => segment.token
        ? [{ ...segment, kind: "variable" }]
        : enrichPlainSegment(segment, summary));
}
