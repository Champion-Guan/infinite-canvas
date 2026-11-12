import type { CanvasNodeMetadata } from "@/types/canvas";
import type { ProductMainImage } from "./产品主图规则";

export type ConfirmationKind = "number" | "choice" | "image" | "supplement";
export type Confirmation = {
    id: string; label: string; question: string; kind: ConfirmationKind; unit: string;
    scope: "shared" | "variant"; scopes: Array<{ value: string; chinese: string; english: string }>;
    imageKeys: string[]; fallback: string;
};
export type ConfirmationAnswer = {
    factId: string; variantId: string; value: string; scope: string; unit?: string; definition: string;
    images: ProductMainImage[]; evidence?: string; updatedAt: number;
};
export type ConfirmationMetadata = CanvasNodeMetadata & {
    productImagePlan?: { pendingFacts: string[]; confirmations?: Confirmation[] };
    productConfirmations?: ConfirmationAnswer[];
    productVariants?: Array<{ id: string; name: string }>;
};
export type ConditionalText = { chinese: string; english: string };
export type ConditionalTemplate = {
    factId: string; unknown: ConditionalText; known?: ConditionalText; yes?: ConditionalText; no?: ConditionalText;
};
export const factToken = (id: string) => `{{fact:${id}}}`;
export const factTokens = (text: string) => [...text.matchAll(/\{\{fact:([a-z][a-z0-9-]{0,63})\}\}/g)].map(match => match[1]);
const validId = (value: unknown): value is string => typeof value === "string" && /^[a-z][a-z0-9-]{0,63}$/.test(value);
export type ConfirmationProtocolProblem = "invalid_fields" | "invalid_field" | "invalid_text" | "invalid_scopes" |
    "invalid_conditions" | "invalid_condition" | "unbound_fact" | "wrong_image" | "missing_fact_token" |
    "missing_number_value" | "missing_choice_branch" | "wrong_branch" | "evidence_requires_review" |
    "recursive_fact" | "unknown_placeholder" | "placeholder_in_fallback" | "placeholder_in_choice" | "duplicate_fact_token";
export type ConfirmationProtocolIssue = { path: string; problem: ConfirmationProtocolProblem; factId?: string };
export class ProductConfirmationProtocolError extends Error {
    readonly code = "invalid_confirmation_protocol";
    readonly issues: ConfirmationProtocolIssue[];
    constructor(issues: ConfirmationProtocolIssue[]) {
        super("待确认字段或条件提示词不完整，原方案已保留，请重试。");
        this.name = "ProductConfirmationProtocolError";
        this.issues = issues.slice(0, 32).map(issue => ({
            path: /^[a-zA-Z0-9_.[\]-]{1,240}$/.test(issue.path) ? issue.path : "confirmations",
            problem: issue.problem, ...(validId(issue.factId) ? { factId: issue.factId } : {}),
        }));
    }
}
const fail = (path = "confirmations", problem: ConfirmationProtocolProblem = "invalid_field", factId?: string): never => {
    throw new ProductConfirmationProtocolError([{ path, problem, factId }]);
};
const str = (value: unknown, max = 2000, path = "confirmations") =>
    typeof value === "string" && value.trim() && value.length <= max ? value.trim() : fail(path, "invalid_text");

export function parseConfirmations(input: unknown, imageKeys: string[]): Confirmation[] | undefined {
    if (input === undefined) return;
    if (!Array.isArray(input) || input.length > 32) return fail("confirmations", "invalid_fields");
    const ids = new Set<string>();
    return input.map((value, index) => {
        const path = `confirmations[${index}]`;
        if (!value || !validId(value.id) || ids.has(value.id) || !["number", "choice", "image", "supplement"].includes(value.kind)
            || !["shared", "variant"].includes(value.scope) || !Array.isArray(value.imageKeys)
            || value.imageKeys.some((key: unknown) => typeof key !== "string" || !imageKeys.includes(key))) return fail(path);
        ids.add(value.id);
        const scopes = value.scopes ?? [];
        if (!Array.isArray(scopes) || scopes.length > 8) return fail(`${path}.scopes`, "invalid_scopes", value.id);
        return { id: value.id, label: str(value.label, 80, `${path}.label`), question: str(value.question, 2000, `${path}.question`), kind: value.kind, scope: value.scope,
            unit: typeof value.unit === "string" && value.unit.length <= 24 ? value.unit.trim() : "",
            scopes: scopes.map((item, scopeIndex) => ({ value: str(item?.value, 40, `${path}.scopes[${scopeIndex}].value`),
                chinese: str(item?.chinese, 80, `${path}.scopes[${scopeIndex}].chinese`),
                english: str(item?.english, 120, `${path}.scopes[${scopeIndex}].english`) })),
            imageKeys: [...new Set(value.imageKeys)] as string[], fallback: str(value.fallback, 2000, `${path}.fallback`) };
    });
}

export function parseConditionalTemplates(input: unknown, path = "conditions"): string | undefined {
    if (input === undefined) return;
    if (!Array.isArray(input) || input.length > 32) return fail(path, "invalid_conditions");
    const ids = new Set<string>();
    const templates: ConditionalTemplate[] = input.map((item, index) => {
        const itemPath = `${path}[${index}]`;
        if (!item || !validId(item.factId) || ids.has(item.factId)) return fail(`${itemPath}.factId`, "invalid_condition");
        ids.add(item.factId);
        const result: ConditionalTemplate = { factId: item.factId,
            unknown: { chinese: str(item.unknown?.chinese, 2000, `${itemPath}.unknown.chinese`),
                english: str(item.unknown?.english, 2000, `${itemPath}.unknown.english`) } };
        for (const branch of ["known", "yes", "no"] as const) if (item[branch] !== undefined)
            result[branch] = { chinese: str(item[branch]?.chinese, 2000, `${itemPath}.${branch}.chinese`),
                english: str(item[branch]?.english, 2000, `${itemPath}.${branch}.english`) };
        return result;
    });
    return JSON.stringify(templates);
}

export function validateConditionalTemplates(chinese: string, english: string, serialized: string | undefined,
    fields: Confirmation[], imageKey: string, path = `images.${imageKey}.prompt`) {
    let templates: ConditionalTemplate[];
    try { templates = serialized ? JSON.parse(serialized) : []; }
    catch { return fail(`${path}.conditions`, "invalid_conditions"); }
    if (!Array.isArray(templates)) return fail(`${path}.conditions`, "invalid_conditions");
    parseConditionalTemplates(templates, `${path}.conditions`);
    const issues: ConfirmationProtocolIssue[] = [];
    const issue = (at: string, problem: ConfirmationProtocolProblem, factId?: string) => issues.push({ path: at, problem, factId });
    const ids = new Set(templates.map(item => item.factId));
    for (const language of ["chinese", "english"] as const) {
        const source = language === "chinese" ? chinese : english;
        if (/\{\{(?!fact:[a-z][a-z0-9-]{0,63}\}\})/.test(source)) issue(`${path}.${language}`, "unknown_placeholder");
        for (const id of factTokens(source))
            if (!ids.has(id)) issue(`${path}.${language}`, "unbound_fact", id);
    }
    for (const [index, template] of templates.entries()) {
        const itemPath = `${path}.conditions[${index}]`;
        const field = fields.find(item => item.id === template.factId && item.imageKeys.includes(imageKey));
        if (!field) { issue(`${itemPath}.factId`, "wrong_image", template.factId); continue; }
        for (const language of ["chinese", "english"] as const) {
            const count = factTokens(language === "chinese" ? chinese : english).filter(id => id === field.id).length;
            if (!count) issue(`${path}.${language}`, "missing_fact_token", field.id);
            else if (count > 1) issue(`${path}.${language}`, "duplicate_fact_token", field.id);
        }
        if (field.kind === "number") {
            for (const language of ["chinese", "english"] as const)
                if (!template.known?.[language]?.includes("{{value}}")) issue(`${itemPath}.known.${language}`, "missing_number_value", field.id);
            for (const branch of ["yes", "no"] as const)
                if (template[branch]) issue(`${itemPath}.${branch}`, "wrong_branch", field.id);
        }
        if (field.kind === "choice") {
            for (const branch of ["yes", "no"] as const)
                if (!template[branch]) issue(`${itemPath}.${branch}`, "missing_choice_branch", field.id);
            if (template.known) issue(`${itemPath}.known`, "wrong_branch", field.id);
        }
        // 图片和自由文字要经一次有实物/依据的策划核对，不能仅凭上传或非空输入就确认事实。
        if (field.kind === "image" || field.kind === "supplement") issue(itemPath, "evidence_requires_review", field.id);
        for (const branch of ["unknown", "known", "yes", "no"] as const) {
            const text = template[branch];
            if (!text) continue;
            for (const language of ["chinese", "english"] as const) {
                const value = text[language];
                if (factTokens(value).length) issue(`${itemPath}.${branch}.${language}`, "recursive_fact", field.id);
                if (/\{\{(?!value\}\}|unit\}\}|scope\}\})/.test(value)) issue(`${itemPath}.${branch}.${language}`, "unknown_placeholder", field.id);
                if (/\{\{(?:value|unit|scope)\}\}/.test(value)) {
                    if (branch === "unknown") issue(`${itemPath}.${branch}.${language}`, "placeholder_in_fallback", field.id);
                    else if (field.kind === "choice") issue(`${itemPath}.${branch}.${language}`, "placeholder_in_choice", field.id);
                }
            }
        }
    }
    if (issues.length) throw new ProductConfirmationProtocolError(issues);
}

const stableId = (text: string) => {
    let hash = 2166136261;
    for (const character of text) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
    return `legacy-${(hash >>> 0).toString(36)}`;
};

// 旧方案只有问题文本。分类只提供填写入口，不伪造变量位置或把答案自动写进旧提示词。
export function confirmationFields(metadata?: ConfirmationMetadata): Confirmation[] {
    const plan = metadata?.productImagePlan;
    if (plan?.confirmations) return plan.confirmations;
    return (plan?.pendingFacts || []).map(question => {
        const kind: ConfirmationKind = /承重.*实测|承重.*数值/.test(question) ? "number" : /提升\d|宣传|计算基准|认证|依据|承诺|测试条件|测试时长/.test(question) ? "supplement"
            : /请(?:提供|补充).*实拍|背面|封口|阀口|高清|孔型/.test(question) ? "image"
            : /是否|有无|是不是/.test(question) ? "choice" : /数值|多少|尺寸|高度|长度|承重|测量/.test(question) ? "number" : "supplement";
        const label = /承重/.test(question) ? "实测承重" : /刹车/.test(question) ? "是否带刹车"
            : /净空|测量起止/.test(question) ? "层间净空" : /包装实拍/.test(question) ? "包装与配件实拍"
            : /排水孔|孔型/.test(question) ? "托盘底面实拍" : /脚轮.*测试/.test(question) ? "脚轮移动测试依据"
            : /宣传|计算基准|提升\d/.test(question) ? "宣传依据" : question.split(/[，；。]/, 1)[0].replace(/^请(?:提供|确认|补充)/, "").slice(0, 18);
        return { id: stableId(question), label,
            question, kind, unit: /承重/.test(question) && kind === "number" ? "kg" : "", scope: metadata?.productVariants?.length ? "variant" : "shared",
            scopes: /整架.*单层|单层.*整架/.test(question) && kind === "number" ? [
                { value: "whole", chinese: "整架", english: "whole rack" }, { value: "single", chinese: "单层", english: "one shelf" },
            ] : [],
            imageKeys: [], fallback: "未确认的内容不新增展示，沿用当前方案。" };
    });
}

export const confirmationDefinition = (field: Confirmation) => JSON.stringify([field.id, field.kind, field.question, field.unit, field.scope, field.scopes]);
export function confirmationAnswer(metadata: ConfirmationMetadata | undefined, field: Confirmation, variantId?: string) {
    const scope = field.scope === "shared" ? "" : variantId || "";
    return metadata?.productConfirmations?.find(item => item.factId === field.id && item.variantId === scope
        && item.definition === confirmationDefinition(field));
}
export function confirmationAnswered(field: Confirmation, answer?: ConfirmationAnswer) {
    if (!answer) return false;
    if (field.kind === "number") return /^\d+(?:[.,]\d+)?$/.test(answer.value.trim())
        && Number.isFinite(Number(answer.value.replace(",", "."))) && (!field.scopes.length || field.scopes.some(item => item.value === answer.scope));
    return field.kind === "choice" && ["yes", "no"].includes(answer.value);
}
export function confirmationAnswerPatch(metadata: ConfirmationMetadata, field: Confirmation, variantId: string | undefined,
    change: Partial<Pick<ConfirmationAnswer, "value" | "scope" | "unit" | "images" | "evidence">>): ConfirmationMetadata {
    const scope = field.scope === "shared" ? "" : variantId || "";
    if (field.scope === "variant" && !metadata.productVariants?.some(item => item.id === scope))
        throw Error("请先选择需要填写的产品变体。");
    const old = confirmationAnswer(metadata, field, variantId);
    const answer: ConfirmationAnswer = { factId: field.id, variantId: scope, value: "", scope: "",
        images: [], ...old, ...change, definition: confirmationDefinition(field), updatedAt: Date.now() };
    return { productConfirmations: [...(metadata.productConfirmations || []).filter(item =>
        !(item.factId === field.id && item.variantId === scope)), answer] };
}

const evidenceBlock = /\n?【待确认依据：([^\n】]{1,80})】\n([\s\S]*?)\n【\/待确认依据：\1】/g;
export const baseConfirmationSupplement = (value = "") => value.replace(evidenceBlock, "").trim();
export function confirmationEvidence(value = "", field: Confirmation) {
    return [...value.matchAll(evidenceBlock)].find(match => match[1] === field.label)?.[2].trim() || "";
}
export function appendConfirmationEvidence(value: string, field: Confirmation) {
    if ([...value.matchAll(evidenceBlock)].some(match => match[1] === field.label)) return value;
    return `${value}${value ? "\n\n" : ""}【待确认依据：${field.label}】\n\n【/待确认依据：${field.label}】`;
}
