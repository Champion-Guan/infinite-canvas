// 旧产品包的占位符替换仅作兼容；不推断主题，不追加生成约束。
const VARIABLE_PATTERN = /\[[^\]\r\n]{1,160}\]/g;
const OMITTED_VARIABLES = [/^\[\d+\s*[-–—]\s*\d+秒/i, /^\[FILL WITH VERIFIED PRODUCT DATA\]$/i, /^\[PRODUCT PHOTO\/CAD\]$/i, /^\[待填写\]$/, /^\[我的产品变量\]$/, /^\[补充自有产品/i, /^\[node:/i, /^\[\d+\]$/];
const normalize = (token: string) => token.replace(/^\[|\]$/g, "").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().replace(/[\s_-]+/g, " ").trim();
const EMPTY_VALUE = /^(?:待填写|未填写|未知|未提供|unknown|n\/a|null|undefined|[-—–])$/i;
const LEGACY_RULE_HEADER = "【变量与画面约束】";
const LEGACY_RULE_LINES = new Set([
    "仅使用用户明确填写的真实产品数据。未填写的变量（包括尺寸、数量、材质等）不得根据主题、常识、示例或参考图猜测、补齐或编造；省略对应的文字标注和依赖该数据的展示，不把占位符画到图片中。",
    "本卡为产品尺寸展示主题，也只能标注本提示词中已填写的尺寸；缺少长度等参数时省略该尺寸标注，不用其他尺寸代替。",
    "本卡不是产品尺寸展示主题。不要增加尺寸线、标尺、长宽高数字或测量信息图；共享参数中的产品尺寸不作为本画面的展示内容。图像输出像素和宽高比只控制出图规格。",
]);

// 只移除旧版自动生成的已知行，不吞掉下一张引用卡、产品补充或用户正文。
export function stripLegacyPromptConstraints(prompt: string) {
    if (!prompt.includes(LEGACY_RULE_HEADER)) return prompt;
    const header = /(^|\r?\n)【变量与画面约束】(?=\r?\n|$)/g;
    let result = prompt, match: RegExpExecArray | null;
    while ((match = header.exec(result))) {
        const start = match.index + match[1].length;
        let end = start + LEGACY_RULE_HEADER.length;
        const headerEnd = end;
        let line: RegExpExecArray | null;
        while ((line = /^(?:\r?\n)([^\r\n]*)/.exec(result.slice(end)))) {
            const text = line[1];
            if (!LEGACY_RULE_LINES.has(text) && !(
                text.startsWith("未填写变量：") && text.endsWith("。保持未提供，不填默认值。") ||
                text.startsWith("本画面停用的尺寸变量：") && text.endsWith("。"))) break;
            end += line[0].length;
        }
        // 自定义同名章节不是旧版自动后缀，保留原文。
        if (end === headerEnd) continue;
        const before = result.slice(0, start).replace(/(?:\r?\n){1,2}$/, "");
        const after = result.slice(end);
        result = before + (before ? after : after.replace(/^(?:\r?\n){1,2}/, ""));
        header.lastIndex = before.length;
    }
    return result;
}

export function promptVariableTokens(prompt: string) {
    return [...new Set((prompt.match(VARIABLE_PATTERN) || []).filter(token => !OMITTED_VARIABLES.some(pattern => pattern.test(token))))];
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

function resolveVariableContent(prompt: string, values: Record<string, string>) {
    if (!prompt.trim()) return prompt;
    const tokens = promptVariableTokens(prompt);
    const read = variableReader(values);
    return prompt.replace(VARIABLE_PATTERN, token => tokens.includes(token) ? read(token) || token : token);
}

// 独立分隔补充原文，后续协议复核不再把其中的方括号当成待填写变量。
export const PRODUCT_PROMPT_SUPPLEMENT_SEPARATOR = "\n\n【产品补充】\n";
export function resolvePromptVariables(prompt: string, values: Record<string, string> = {}, supplement?: string) {
    prompt = stripLegacyPromptConstraints(prompt);
    const boundary = prompt.indexOf(PRODUCT_PROMPT_SUPPLEMENT_SEPARATOR);
    const raw = boundary < 0 ? prompt : prompt.slice(0, boundary);
    const tail = supplement === undefined
        ? (boundary < 0 ? "" : prompt.slice(boundary))
        : (supplement.trim() ? PRODUCT_PROMPT_SUPPLEMENT_SEPARATOR + supplement : "");
    return resolveVariableContent(raw, values) + tail;
}
