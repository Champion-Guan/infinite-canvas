import type { BilingualPrompt, ProductPromptDocument } from "./商品提示词规则";
import { confirmationAnswer, confirmationAnswered, confirmationEvidence, confirmationFields, factToken, factTokens,
    type Confirmation, type ConfirmationMetadata, type ConditionalTemplate } from "./商品待确认规则";

export type ConfirmationRange = { id: string; start: number; end: number };
type Section = ConfirmationRange & { token: string };
export type ConfirmationCompilation = {
    pair: BilingualPrompt; ranges: { chinese: ConfirmationRange[]; english: ConfirmationRange[] };
    sections: { chinese: Section[]; english: Section[] }; states: Array<{ field: Confirmation; filled: boolean; fallback: string }>;
};

export function compileConfirmationPair(pair: BilingualPrompt, metadata: ConfirmationMetadata | undefined, imageKey: string,
    variantId?: string, preview = false): ConfirmationCompilation {
    const templates: ConditionalTemplate[] = pair.conditionalTemplate ? JSON.parse(pair.conditionalTemplate) : [];
    const fields = confirmationFields(metadata);
    const states: ConfirmationCompilation["states"] = [], ranges: ConfirmationCompilation["ranges"] = { chinese: [], english: [] };
    const sections: ConfirmationCompilation["sections"] = { chinese: [], english: [] };
    const resolved = Object.fromEntries((["chinese", "english"] as const).map(language => {
        let text = "", cursor = 0;
        const source = pair[language];
        for (const match of source.matchAll(/\{\{fact:([a-z][a-z0-9-]{0,63})\}\}/g)) {
            const field = fields.find(item => item.id === match[1] && item.imageKeys.includes(imageKey));
            const template = templates.find(item => item.factId === match[1]);
            if (!field || !template) throw Error("待确认变量关联已丢失，请更新相关提示词后再生成。");
            const answer = confirmationAnswer(metadata, field, variantId), filled = confirmationAnswered(field, answer);
            const branch = filled ? field.kind === "choice" ? template[answer!.value === "yes" ? "yes" : "no"] : template.known : template.unknown;
            if (!branch) throw Error(`“${field.label}”缺少对应方案，请更新相关提示词。`);
            const scope = field.scopes.find(item => item.value === answer?.scope);
            const values = { value: answer?.value.trim() || "", unit: field.unit || answer?.unit || "", scope: scope?.[language] || "" };
            const body = branch[language].replace(/\{\{(value|unit|scope)\}\}/g, (_, name: keyof typeof values) => filled ? values[name] : "");
            text += source.slice(cursor, match.index);
            const start = text.length;
            const badge = preview && !filled ? `〔${field.label}〕 ` : "";
            text += badge + body;
            const valueStart = filled && field.kind === "number" ? body.indexOf(values.value) : -1;
            ranges[language].push({ id: field.id, start: start + (valueStart >= 0 ? valueStart : 0),
                end: start + (valueStart >= 0 ? valueStart + values.value.length : badge.length || body.length) });
            sections[language].push({ id: field.id, token: factToken(field.id), start, end: text.length });
            if (language === "chinese") states.push({ field, filled, fallback: field.fallback });
            cursor = match.index! + match[0].length;
        }
        text += source.slice(cursor);
        if (factTokens(text).length || /\{\{(?:value|unit|scope)\}\}/.test(text)) throw Error("待确认变量未完整解析，未提交生成。");
        return [language, text];
    })) as { chinese: string; english: string };
    const hasTemplates = templates.length > 0;
    return { pair: hasTemplates ? { ...pair, ...resolved, conditionalTemplate: undefined, alignment: undefined,
        translatedChinese: pair.chinese === pair.translatedChinese ? resolved.chinese : pair.translatedChinese } : pair, ranges, sections, states };
}

// 编辑普通文本时将受控片段还原成占位符；变量片段由对应表单编辑，防止丢失绑定。
export function editConfirmationTemplate(before: string, after: string, sections: Section[]) {
    let prefix = 0;
    while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++;
    let suffix = 0;
    while (suffix < before.length - prefix && suffix < after.length - prefix
        && before[before.length - suffix - 1] === after[after.length - suffix - 1]) suffix++;
    const end = before.length - suffix, delta = after.length - before.length;
    if (sections.some(section => prefix < section.end && end > section.start
        || prefix === end && prefix > section.start && prefix < section.end))
        throw Error("高亮片段关联商品资料，请点击高亮变量修改对应值。");
    let text = after;
    for (const section of [...sections].reverse()) {
        const shift = section.start >= end ? delta : 0;
        text = text.slice(0, section.start + shift) + section.token + text.slice(section.end + shift);
    }
    return text;
}

export function confirmationPlanInputs(metadata: ConfirmationMetadata) {
    return confirmationFields(metadata).map(field => ({
        ...field, evidence: confirmationEvidence(metadata.promptVariableSupplement, field),
        answers: (field.scope === "variant" ? metadata.productVariants?.map(item => item.id) || [] : [""]).map(variantId => {
            const answer = confirmationAnswer(metadata, field, variantId);
            return { variantId, value: answer?.value || "", scope: answer?.scope || "", unit: field.unit || answer?.unit || "", evidence: answer?.evidence || "",
                images: answer?.images.map(image => ({ id: image.id, name: image.name })) || [] };
        }),
    }));
}

export function confirmationImageReferences(metadata: ConfirmationMetadata, doc: ProductPromptDocument, variantId?: string) {
    return confirmationFields(metadata).flatMap(field => {
        if (!field.imageKeys.includes(doc.key) || field.kind !== "image") return [];
        return (confirmationAnswer(metadata, field, variantId)?.images || [])
            .filter(image => doc.confirmationImageIds?.includes(image.id));
    });
}

export function confirmationPlanningImages(metadata: ConfirmationMetadata, imageKeys?: string[]) {
    return confirmationFields(metadata).flatMap(field => {
        if (field.kind !== "image" || !field.imageKeys.length || imageKeys && !field.imageKeys.some(key => imageKeys.includes(key))) return [];
        const variants = field.scope === "shared" ? [undefined] : metadata.productVariants?.map(item => item.id) || [];
        return variants.flatMap(variantId => confirmationAnswer(metadata, field, variantId)?.images || []);
    });
}

export function validateConfirmationImages(metadata: ConfirmationMetadata, doc: ProductPromptDocument) {
    const available = new Set(confirmationFields(metadata).flatMap(field => {
        if (field.kind !== "image" || !field.imageKeys.includes(doc.key)) return [];
        const variants = field.scope === "shared" ? [undefined] : metadata.productVariants?.map(item => item.id) || [];
        return variants.flatMap(variantId => confirmationAnswer(metadata, field, variantId)?.images.map(image => image.id) || []);
    }));
    if (doc.confirmationImageIds?.some(id => !available.has(id)))
        throw Error("本卡的待确认参考图已移除或关联范围已改变，请更新相关提示词后再生成。");
}
