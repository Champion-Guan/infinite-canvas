// 只处理产品变量的真实性和当前画面的尺寸使用；不改变图像输出分辨率。
const VARIABLE_PATTERN = /\[[^\]\r\n]{1,160}\]/g;
const OMITTED_VARIABLES = [/^\[\d+\s*[-–—]\s*\d+秒/i, /^\[FILL WITH VERIFIED PRODUCT DATA\]$/i, /^\[PRODUCT PHOTO\/CAD\]$/i, /^\[待填写\]$/, /^\[我的产品变量\]$/, /^\[补充自有产品/i, /^\[node:/i, /^\[\d+\]$/];
const normalize = (token: string) => token.replace(/^\[|\]$/g, "").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().replace(/[\s_-]+/g, " ").trim();
const DIMENSION = /\b(dimensions?|measurements?|width|height|length|depth|diameter|thickness)\b|\b(?:product|package|case) size\b|\bsize (?:chart|guide|diagram|display)\b|尺寸|宽度|高度|长度|深度|直径|厚度/i;
const OUTPUT_SIZE = /\b(image|output|canvas|pixel|resolution|aspect)\b|图像|图片|输出|画布|像素|分辨率|宽高比/i;
const EMPTY_VALUE = /^(?:待填写|未填写|未知|未提供|unknown|n\/a|null|undefined|[-—–])$/i;
const RULE_HEADER = "【变量与画面约束】";

export function promptVariableTokens(prompt: string) {
    return [...new Set((prompt.match(VARIABLE_PATTERN) || []).filter(token => !OMITTED_VARIABLES.some(pattern => pattern.test(token))))];
}

function isDimensionToken(token: string) {
    const name = normalize(token);
    return DIMENSION.test(name) && !OUTPUT_SIZE.test(name);
}

function variableReader(values: Record<string, string>) {
    const aliases = new Map(Object.entries(values).map(([key, value]) => [normalize(key), value]));
    return (token: string) => {
        // 显式清空优先于旧别名值；字符串“0”是已确认值。
        const value = String(values[token] ?? aliases.get(normalize(token)) ?? "").trim();
        return !value || EMPTY_VALUE.test(value) || normalize(value) === normalize(token) ? "" : value;
    };
}

// 补齐表单键时保留已填写的别名；显式清空的同名键仍优先。
export function completePromptVariableValues(tokens: string[], values: Record<string, string> = {}) {
    const read = variableReader(values);
    return { ...values, ...Object.fromEntries(tokens.map(token => [token, Object.hasOwn(values, token) ? values[token] : read(token)])) };
}

function isDimensionTheme(prompt: string) {
    // 优先读本卡主题，不从共享 PRODUCT DATA、尺寸变量或输出像素推断主题。
    const creative = prompt.split(/(?:PRODUCT DATA|VARIABLES|产品参数|SAFETY RULES|通用规则)\s*[：:]?/i, 1)[0];
    const explicit = creative.match(/(?:^|\n|[.;；。])\s*(?:[-*#]\s*)*(?:主题(?:\/角度)?|Theme|Visual focus|核心视觉|Core visual|画面重点)\s*[：:]\s*([^\n.;；。]+)/i)?.[1];
    const lock = creative.match(/COMPOSITION LOCK\s*[：:]\s*([^\n.;；。]+)/i)?.[1];
    const focus = (explicit || lock || creative).replace(VARIABLE_PATTERN, "").replace(/\b\d{3,5}\s*[x×:]\s*\d{3,5}\s*(?:px|pixels?)?\b/gi, "");
    const withoutNegation = focus
        .replace(/(?:尺寸|宽度|高度|长度|直径|厚度)(?:以外|之外|无关|不相关)/g, "")
        .replace(/(?:no|not|without|avoid|exclude|do not|don't|never)\b[^,;，；。\n]{0,70}(?:dimensions?|measurements?|size|width|height|length|depth|diameter|thickness)(?:\s+(?:annotations?|labels?|lines?|display|related))?/gi, "")
        .replace(/(?:非|不(?:要|得|是|含|显示|展示|标注|涉及)?|无|禁止)[^,;，；。\n]{0,20}(?:尺寸|宽度|高度|长度|直径|厚度)(?:展示|标注|相关|主题)?/g, "");
    return DIMENSION.test(withoutNegation) && !/^\s*(?:image|output|canvas|pixel|resolution|aspect|输出|图像|画布|像素|分辨率)/i.test(withoutNegation);
}

function resolveVariableContent(prompt: string, values: Record<string, string>) {
    if (!prompt.trim()) return prompt;
    // 对已经生成的预览重复调用不叠加约束；原始模板仍在源卡保留。
    if (prompt.includes("\n\n" + RULE_HEADER)) return prompt;
    const raw = prompt;
    const tokens = promptVariableTokens(raw);
    const read = variableReader(values);
    const focusPrompt = raw.replace(VARIABLE_PATTERN, token => isDimensionToken(token) ? token : read(token) || token);
    const dimensionTheme = isDimensionTheme(focusPrompt);
    const missing = tokens.filter(token => !read(token));
    const suppressed = tokens.filter(token => isDimensionToken(token) && !dimensionTheme);
    const resolved = raw.replace(VARIABLE_PATTERN, token => {
        if (!tokens.includes(token)) return token;
        if (suppressed.includes(token)) return "（本画面不使用产品尺寸参数）";
        return read(token) || token;
    });
    if (!tokens.length && !dimensionTheme) return resolved;
    const rules = [
        "仅使用用户明确填写的真实产品数据。未填写的变量（包括尺寸、数量、材质等）不得根据主题、常识、示例或参考图猜测、补齐或编造；省略对应的文字标注和依赖该数据的展示，不把占位符画到图片中。",
        dimensionTheme
            ? "本卡为产品尺寸展示主题，也只能标注本提示词中已填写的尺寸；缺少长度等参数时省略该尺寸标注，不用其他尺寸代替。"
            : "本卡不是产品尺寸展示主题。不要增加尺寸线、标尺、长宽高数字或测量信息图；共享参数中的产品尺寸不作为本画面的展示内容。图像输出像素和宽高比只控制出图规格。",
    ];
    if (missing.length) rules.push(`未填写变量：${missing.join("、")}。保持未提供，不填默认值。`);
    if (suppressed.length) rules.push(`本画面停用的尺寸变量：${suppressed.join("、")}。`);
    return resolved + "\n\n" + RULE_HEADER + "\n" + rules.join("\n");
}

// 独立分隔补充原文，后续协议复核不再把其中的方括号当成待填写变量。
export const PRODUCT_PROMPT_SUPPLEMENT_SEPARATOR = "\n\n【产品补充】\n";
export function resolvePromptVariables(prompt: string, values: Record<string, string> = {}, supplement?: string) {
    const boundary = prompt.indexOf(PRODUCT_PROMPT_SUPPLEMENT_SEPARATOR);
    const raw = boundary < 0 ? prompt : prompt.slice(0, boundary);
    const tail = supplement === undefined
        ? (boundary < 0 ? "" : prompt.slice(boundary))
        : (supplement.trim() ? PRODUCT_PROMPT_SUPPLEMENT_SEPARATOR + supplement : "");
    return resolveVariableContent(raw, values) + tail;
}
