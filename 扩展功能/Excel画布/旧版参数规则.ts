import { localizePromptTheme } from "./旧版主题翻译.js";
import type { CanvasNodeContext, CanvasNodeResource } from "@/types/canvas-plugin";
import type { CanvasNodeData, CanvasNodeMetadata } from "@/types/canvas";
import { promptVariableTokens, resolvePromptVariables, completePromptVariableValues } from "../提示词/变量使用规则";
import type { ProductMainImage } from "./产品主图规则";
export { promptVariableTokens, resolvePromptVariables, completePromptVariableValues } from "../提示词/变量使用规则";
export const PROMPT_VARIABLES_NODE_TYPE = "guan:prompt-variables";

export type ExcelPromptTemplate = {
    id: string;
    route: string;
    prompts: Record<string, string>;
};

export type ExcelPromptSpec = {
    key: string;
    label: string;
    kind: "main" | "detail" | "rich" | "video" | "other";
    theme: string;
    compositionLock: string;
    purpose: string;
    prompt: string;
    tokens: string[];
};

export type ExcelPromptContext = {
    fileName: string;
    activeProductName: string;
    templates: ExcelPromptTemplate[];
};

export const WILDBERRIES_PLATFORM = "Wildberries";
export const WILDBERRIES_LANGUAGE = "俄文";
export function defaultProductLanguage(platform: string) {
    if (platform === WILDBERRIES_PLATFORM || platform === "Ozon") return WILDBERRIES_LANGUAGE;
    if (platform === "亚马逊" || platform === "Takealot") return "英文";
    return "";
}
export type ProductOption = { value: string; label: string };
export const PRODUCT_PLATFORM_OPTIONS: ProductOption[] = [
    { value: WILDBERRIES_PLATFORM, label: "Wildberries" },
    { value: "Ozon", label: "OZON" },
    { value: "亚马逊", label: "亚马逊" },
    { value: "Takealot", label: "Takealot" },
    { value: "未指定", label: "未指定" },
];
export const PRODUCT_LANGUAGE_OPTIONS: ProductOption[] = [
    { value: WILDBERRIES_LANGUAGE, label: "俄文" },
    { value: "英文", label: "英文" },
    { value: "中文", label: "中文" },
    { value: "", label: "未指定" },
];
export const WILDBERRIES_RULES_TEXT = [
    "主图/轮播图：1800 x 2400 px ，3 : 4 ，PNG ，单张小于10MB 。",
    "富内容：800 x 500 px ，PNG ，单张最大5MB 。",
    "商品卡视频：3 : 4 ，MP4 ，小于50MB 。",
].join("\n");

const LEGACY_WILDBERRIES_RULES_TEXT = [
    "主图/轮播图：1800×2400，3:4，JPG/PNG/WEBP，单张小于10MB，最多30张，最低700×933。",
    "商品卡视频：3:4，MOV/MP4，单个小于50MB。",
    "富内容：仅图片，800×500，JPG/PNG，单张最大5MB。",
].join("\n");

export const PRODUCT_BRIEF_FIELDS = [
    { key: "nameCategory", label: "商品名称／品类", kind: "text", help: "填写这是什么商品、属于什么品类，以及具体用途。" },
    { key: "colorModel", label: "销售颜色／型号", kind: "text", help: "标明本次销售的颜色、型号或款式，并区分参考图片中的其他款式。" },
    { key: "dimensions", label: "真实尺寸与参数", kind: "multiline", help: "填写尺寸、重量、容量、型号、适配范围等真实参数，注明数值和单位；未知项可写“待确认”。" },
    { key: "material", label: "材质／成分", kind: "text", help: "填写主体、配件的真实材质或成分及已知比例，以产品资料为准；不确定可写“待确认”。" },
    { key: "packageContents", label: "包装清单及数量", kind: "multiline", help: "列出买家实际收到哪些物品、各多少件，并注明图片中的场景道具是否包含。" },
    { key: "sellingPoints", label: "核心卖点（1–3 个）", kind: "multiline", help: "填写最希望突出的 1–3 个优势，以及能够支持这些优势的资料或实拍依据。" },
    { key: "targetBuyer", label: "目标买家", kind: "text", help: "描述谁会购买，例如人群、年龄、职业、使用经验或送礼对象。" },
    { key: "usageScenarios", label: "主要使用场景", kind: "multiline", help: "描述买家在什么地方、什么情况下使用，以及希望解决什么问题。" },
    { key: "buyerConcerns", label: "买家最担心的问题", kind: "multiline", help: "填写买家购买前最在意的疑问，例如尺寸是否合适、是否耐用、是否易用或配件是否齐全。" },
    { key: "richContent", label: "富内容", kind: "choice", help: "选择本次是否需要制作富内容图片。" },
    { key: "imageKeywords", label: "需要在图片中展现的关键词", kind: "multiline", help: "填写希望显示在图片上的关键词或短句，可分行填写。AI写提示词会选择适合展示文字的图片，并安排字体样式与构图位置，不要求每张图片都展示。" },
    { key: "styleReference", label: "风格或竞品参考", kind: "multiline", help: "可填写参考风格、竞品链接、品牌 Logo、品牌色，以及希望借鉴的排版或氛围。" },
    { key: "preserveConstraints", label: "必须保留／禁止改变的地方", kind: "multiline", help: "说明必须保持一致的外形、颜色、结构、Logo、数量等，以及禁止添加、删减或改动的内容。" },
] as const;

export type ProductBriefField = typeof PRODUCT_BRIEF_FIELDS[number]["key"];
// 旧字段仅兼容读取，不再作为规划条件或生成约束。
export type ProductBriefValues = Partial<Record<ProductBriefField | "carouselCount" | "generationTool", string>>;

export type ProductParameterMetadata = CanvasNodeMetadata & {
    productMainImages?: ProductMainImage[];
    productBrief?: ProductBriefValues;
    productPlatform?: string;
    productLanguage?: string;
    productPlatformRules?: string;
    productMainImageStorageKey?: string;
    productMainImageUrl?: string;
    productMainImageWidth?: number;
    productMainImageHeight?: number;
    productMainImageBytes?: number;
    productMainImageMimeType?: string;
};

export function productPlatformRules(metadata?: ProductParameterMetadata) {
    const value = metadata;
    if (value?.productPlatform !== WILDBERRIES_PLATFORM) return "";
    const rules = String(value.productPlatformRules || "").trim();
    return !rules || rules === LEGACY_WILDBERRIES_RULES_TEXT ? WILDBERRIES_RULES_TEXT : rules;
}

export function productParameterSupplement(metadata?: CanvasNodeMetadata) {
    const value = metadata as ProductParameterMetadata | undefined;
    const user = String(metadata?.promptVariableSupplement || "").trim();
    const rules = productPlatformRules(metadata);
    const richContentRequirement = value?.productPlatform === WILDBERRIES_PLATFORM ? "富内容必须制作：800 x 500 px，PNG，单张最大5MB。" : "";
    return [productBriefSupplement(metadata), user, rules, richContentRequirement].filter(Boolean).join("\n\n");
}

export function productBriefSupplement(metadata?: CanvasNodeMetadata) {
    const value = metadata as ProductParameterMetadata | undefined;
    const lines = PRODUCT_BRIEF_FIELDS.flatMap(field => {
        if (field.key === "richContent" && value?.productPlatform === WILDBERRIES_PLATFORM) return [];
        const text = String(value?.productBrief?.[field.key] || "").trim();
        return text ? [`${field.label}：${text}`] : [];
    });
    if (!lines.length) return "";
    if (value?.productMainImages ? value.productMainImages.length > 0 : value?.productMainImageStorageKey || value?.productMainImageUrl) lines.splice(2, 0, "实物图：已附");
    if (value?.productLanguage) lines.push(`图片文字语言：${value.productLanguage}`);
    return ["【商品资料】", ...lines, "未填写的资料保持待确认，不猜测或编造产品参数。"].join("\n");
}

function productName(route: string) {
    return String(route || "").split(/[|｜]/, 1)[0].trim();
}

const VARIABLE_LABELS: Record<string, string> = {
    "PRODUCT PHOTO/CAD": "产品图片/CAD",
    "PRODUCT NAME": "产品名称",
    "MY BRAND": "我的品牌",
    "MY SKU": "我的 SKU",
    "BODY MATERIAL": "主体材质",
    DIMENSIONS: "尺寸",
    "CORE FEATURE 1": "核心卖点 1",
    "CORE FEATURE 2": "核心卖点 2",
    "CORE FEATURE 3": "核心卖点 3",
    "KIT CONTENTS AND QUANTITIES": "套件内容及数量",
    "NEEDLE / THREAD SPECIFICATION": "针线规格",
    "CASE OR STORAGE TYPE": "收纳盒/存储类型",
    "WARRANTY AND AFTER-SALES LIMITS": "质保及售后范围",
    "VERIFIED TEST EVIDENCE": "已验证的测试证据",
    "ACTUAL PARAMETERS": "实际参数",
    "SHORT RUSSIAN TITLE": "俄文短标题",
    "MATERIAL": "材质",
    "USE SCENARIO": "使用场景",
    "SURFACE FINISH": "表面处理",
    "COLOR": "颜色",
    "KIT USE CASE": "套件用途",
    "TOOL AND ACCESSORY LIST": "工具及配件清单",
    "KIT QUANTITY": "套件数量",
    "CASE SIZE": "收纳盒尺寸",
    "STORAGE FORMAT": "收纳方式",
    "ACCESSORIES AND QUANTITIES": "配件及数量",
    "RUSSIAN SHORT HEADLINE": "俄文短标题",
    "NEEDLE TYPE": "编织针类型",
    "NEEDLE SIZE / DIAMETER": "针号/直径",
    "NEEDLE SIZE RANGE": "针号范围",
    "CABLE OR NEEDLE LENGTH": "连接线或针身长度",
    "TIP MATERIAL": "针尖材质",
    "SET CONTENTS AND QUANTITIES": "套装内容及数量",
    "LENGTH": "长度",
    "CONNECTION / CABLE": "连接方式/连接线",
    "SET CONTENTS": "套装内容",
    "BRAND NAME": "品牌名称",
    "MODEL NUMBER": "型号",
    "PRODUCT CATEGORY": "产品类别",
    "PRODUCT DESCRIPTION": "产品描述",
    "TARGET AUDIENCE": "适用人群",
    "AGE RANGE": "适用年龄",
    "PACKAGE CONTENTS": "包装内容",
    "PACKAGE SIZE": "包装尺寸",
    "PACKAGE DIMENSIONS": "包装尺寸",
    "NET WEIGHT": "净重",
    "GROSS WEIGHT": "毛重",
    "LOAD CAPACITY": "承重能力",
    "MAX LOAD": "最大承重",
    "POWER SUPPLY": "供电方式",
    "POWER CONSUMPTION": "耗电量",
    "BATTERY CAPACITY": "电池容量",
    "BATTERY LIFE": "续航时间",
    "CHARGING TIME": "充电时间",
    "CABLE LENGTH": "线缆长度",
    "OPERATING TEMPERATURE": "工作温度",
    "TEMPERATURE RANGE": "温度范围",
    "WATERPROOF RATING": "防水等级",
    "IP RATING": "防护等级",
    "COMPATIBLE DEVICES": "兼容设备",
    "COMPATIBLE MODELS": "兼容型号",
    "MOUNTING TYPE": "安装方式",
    "INSTALLATION METHOD": "安装方式",
    "CARE INSTRUCTIONS": "保养说明",
    "WASHING INSTRUCTIONS": "洗涤说明",
    "SAFETY WARNINGS": "安全警告",
    "COUNTRY OF ORIGIN": "原产国",
    "SHELF LIFE": "保质期",
    "EXPIRATION DATE": "有效期",
    "FOOD GRADE": "食品级标准",
    "BPA FREE": "不含双酚A",
    "KEY BENEFITS": "主要优势",
    "SELLING POINTS": "卖点",
    "USE CASE": "用途",
    "USE CASES": "用途",
    "USAGE SCENARIO": "使用场景",
    "USAGE SCENARIOS": "使用场景",
    "CORE FEATURES": "核心卖点",
    "RUSSIAN TITLE": "俄文标题",
    "RUSSIAN HEADLINE": "俄文标题",
    "SHORT HEADLINE": "短标题",
    "CALL TO ACTION": "行动引导文案",
    "ASPECT RATIO": "宽高比",
    "BACKGROUND COLOR": "背景颜色",
    "TEXT COLOR": "文字颜色",
    "FONT SIZE": "字号",
    "THREAD SIZE": "螺纹规格",
    "THREAD COUNT": "织物纱线密度",
    "FABRIC COMPOSITION": "面料成分",
    "FIT TYPE": "版型",
    "HEEL HEIGHT": "鞋跟高度",
    "SOLE MATERIAL": "鞋底材质",
    "HANDLE MATERIAL": "手柄材质",
    "BLADE MATERIAL": "刀片材质",
    "NEEDLE SIZE": "针号",
    "NEEDLE DIAMETER": "针径",
    "NEEDLE LENGTH": "针身长度",
    "CONNECTION TYPE": "连接类型",
    "SET QUANTITY": "套装数量",
    "ACCESSORY LIST": "配件清单",
    "ACCESSORIES LIST": "配件清单",
};

function normalizeVariableKey(key: string) {
    return key.replace(/([a-z])([A-Z])/g, "$1 $2").toUpperCase()
        .replace(/\((MM|CM|M|G|KG|ML|L|W|V|A|MAH|HZ|RPM|PX)\)/g, " $1 ")
        .replace(/[_–—-]+/g, " ").replace(/\s*\/\s*/g, " / ")
        .replace(/\s*&\s*/g, " AND ").replace(/\s+/g, " ").trim();
}

const NORMALIZED_VARIABLE_LABELS = Object.fromEntries(Object.entries(VARIABLE_LABELS).map(([key, label]) => [normalizeVariableKey(key), label]));
// Conservative phrase composition: translate only when every part is known.
// Never alter stored variable keys or partially guess an unknown technical term.
const VARIABLE_WORDS: Record<string, string> = {
    "CORE FEATURE": "核心卖点", "KEY FEATURE": "主要功能", "SELLING POINT": "卖点",
    "USE SCENARIO": "使用场景", "USE CASE": "用途", "SURFACE FINISH": "表面处理",
    PRODUCT: "产品", BRAND: "品牌", MODEL: "型号", MODELS: "型号", SKU: "SKU", NAME: "名称",
    TYPE: "类型", CATEGORY: "类别", DESCRIPTION: "描述", MATERIAL: "材质", MATERIALS: "材质",
    COLOR: "颜色", COLOUR: "颜色", COLORS: "颜色", COLOURS: "颜色", SIZE: "尺寸", SIZES: "尺寸",
    DIMENSION: "尺寸", DIMENSIONS: "尺寸", LENGTH: "长度", WIDTH: "宽度", HEIGHT: "高度",
    DEPTH: "深度", THICKNESS: "厚度", DIAMETER: "直径", RADIUS: "半径", WEIGHT: "重量",
    CAPACITY: "容量", VOLUME: "容积", QUANTITY: "数量", QUANTITIES: "数量", COUNT: "数量",
    SET: "套装", KIT: "套件", PACKAGE: "包装", PACKAGING: "包装", CONTENTS: "内容",
    ACCESSORY: "配件", ACCESSORIES: "配件", TOOL: "工具", TOOLS: "工具", LIST: "清单",
    SPECIFICATION: "规格", SPECIFICATIONS: "规格", PARAMETER: "参数", PARAMETERS: "参数",
    FEATURE: "功能", FEATURES: "功能", FUNCTION: "功能", FUNCTIONS: "功能", BENEFIT: "优势", BENEFITS: "优势",
    COMPATIBLE: "兼容", COMPATIBILITY: "兼容性", DEVICE: "设备", DEVICES: "设备",
    POWER: "功率", VOLTAGE: "电压", CURRENT: "电流", FREQUENCY: "频率", SPEED: "速度",
    BATTERY: "电池", CHARGING: "充电", TIME: "时间", TEMPERATURE: "温度", RANGE: "范围",
    HANDLE: "手柄", TIP: "针尖", NEEDLE: "编织针", CABLE: "连接线", CONNECTION: "连接",
    CASE: "收纳盒", STORAGE: "收纳", FORMAT: "方式", WARRANTY: "质保", CERTIFICATION: "认证",
    CERTIFICATIONS: "认证", SAFETY: "安全", STANDARD: "标准", STANDARDS: "标准",
    FABRIC: "面料", PATTERN: "图案", STYLE: "风格", SCENT: "香型", INGREDIENTS: "成分",
    USAGE: "使用方法", INSTRUCTIONS: "说明", INSTALLATION: "安装", CLEANING: "清洁", CARE: "保养",
    PRICE: "价格", CURRENCY: "币种", ORIGIN: "产地", COUNTRY: "国家", BRANDING: "品牌标识",
    TITLE: "标题", HEADLINE: "标题", SUBTITLE: "副标题", TEXT: "文字", LANGUAGE: "语言",
    BACKGROUND: "背景", LIGHTING: "光照", ANGLE: "角度", RESOLUTION: "分辨率", DURATION: "时长",
    MY: "我的", ACTUAL: "实际", VERIFIED: "已验证", MAX: "最大", MAXIMUM: "最大", MIN: "最小", MINIMUM: "最小",
    AND: "及", OR: "或", "/": "/",
};

function variableLabel(token: string) {
    const key = token.replace(/^\[/, "").replace(/\]$/, "").trim();
    if (/[\u3400-\u9fff]/.test(key)) return key;
    const normalized = normalizeVariableKey(key);
    if (NORMALIZED_VARIABLE_LABELS[normalized]) return NORMALIZED_VARIABLE_LABELS[normalized];
    const parts = normalized.split(" ");
    const translated: string[] = [];
    for (let i = 0; i < parts.length;) {
        let matched = false;
        for (let length = Math.min(3, parts.length - i); length > 0; length--) {
            const phrase = parts.slice(i, i + length).join(" ");
            const label = NORMALIZED_VARIABLE_LABELS[phrase] || VARIABLE_WORDS[phrase];
            if (!label) continue;
            translated.push(label);
            i += length;
            matched = true;
            break;
        }
        if (matched) continue;
        // Retain numbered fields and common measurement units in the heading.
        if (/^\d+$/.test(parts[i]) || /^(MM|CM|M|G|KG|ML|L|W|V|A|MAH|HZ|RPM|PX)$/.test(parts[i])) {
            translated.push(` ${parts[i]}`);
            i++;
        } else {
            return `变量 ${token}`;
        }
    }
    return translated.some((part) => /[\u3400-\u9fff]/.test(part)) ? translated.join("") : `变量 ${token}`;
}

function promptEntries(template: ExcelPromptTemplate | undefined) {
    return Object.entries(template?.prompts || {}).filter(([, prompt]) => String(prompt || "").trim());
}

function promptKind(key: string): ExcelPromptSpec["kind"] {
    if (key === "Main Prompt") return "main";
    if (/^Detail Prompt \d+$/i.test(key)) return "detail";
    if (/^Rich Prompt \d+$/i.test(key)) return "rich";
    if (key === "Video Prompt") return "video";
    return "other";
}

function promptLabel(key: string) {
    if (key === "Main Prompt") return "主图提示词";
    if (key === "Video Prompt") return "视频提示词";
    const detail = key.match(/^Detail Prompt (\d+)$/i);
    if (detail) return `详情页提示词${detail[1]}`;
    const rich = key.match(/^Rich Prompt (\d+)$/i);
    if (rich) return `富内容提示词${rich[1]}`;
    return key;
}

export function parseExcelPromptSpec(key: string, prompt: string): ExcelPromptSpec {
    const text = String(prompt || "");
    const compositionLock = text.match(/COMPOSITION LOCK:\s*([^\.\n]+)/i)?.[1]?.trim() || "";
    const explicitTheme = text.match(/(?:主题(?:\/角度)?|Theme|核心视觉|Core visual|Visual focus|画面重点|重点|Camera angle|Shot type|拍摄角度)\s*[：:]\s*([^\.\n]+)/i)?.[1]?.trim() || compositionLock;
    const themeRules: Array<[string, RegExp]> = [
        ["收纳/折叠", /fold|storage|case|portable|compact|收纳|折叠|便携/i],
        ["角度/调节", /angle|degree|tilt|viewing angle|倾角|角度|调节|截止线/i],
        ["安装/兼容", /install|installation|fitment|compatib|adapter|安装|兼容|适配/i],
        ["尺寸/规格", /dimension|size|specification|measurement|尺寸|规格|参数/i],
        ["材质/结构", /material|structure|heat dissipation|散热|材质|结构/i],
        ["配件/数量", /accessor|contents|quantity|kit|included|配件|套装|数量|清单/i],
        ["使用场景", /scene|use case|scenario|workbench|桌面|场景|使用/i],
        ["核心功能/卖点", /core feature|key selling|selling point|功能|卖点|优势/i],
    ];
    // Shared product-data/safety boilerplate is not the current card's theme.
    const intentText = text.replace(/\[[^\]\r\n]+\]/g, "").split(/(?:PRODUCT DATA|VARIABLES|产品参数|SAFETY RULES|通用规则)\s*[:：]/i)[0];
    const scored = themeRules.map(([label, pattern]) => [label, (intentText.match(new RegExp(pattern.source, `${pattern.flags}g`)) || []).length] as const).sort((a, b) => b[1] - a[1]);
    const kindFallback = /^Main/i.test(key) ? "主图｜产品全貌与核心卖点" : /^Rich/i.test(key) ? "富内容｜模块化信息与证据" : /^Video/i.test(key) ? "视频｜使用场景与功能演示" : `详情图${key.match(/(\d+)/)?.[1] || ""}｜单一卖点`;
    const theme = localizePromptTheme(explicitTheme || (scored[0]?.[1] > 0 ? scored[0][0] : kindFallback));
    const purpose = text.match(/(?:Module purpose|模块)\s*[：:]\s*([^\.\n]+)/i)?.[1]?.trim() || "";
    return { key, label: promptLabel(key), kind: promptKind(key), theme, compositionLock, purpose, prompt: text, tokens: promptVariableTokens(text) };
}

function promptSpecs(template: ExcelPromptTemplate | undefined) {
    return promptEntries(template).map(([key, prompt]) => parseExcelPromptSpec(key, prompt));
}

function defaultTemplate(context: ExcelPromptContext) {
    return context.templates.find((template) => promptEntries(template).some(([key]) => key === "Main Prompt")) || context.templates[0];
}

function defaultPromptKey(template: ExcelPromptTemplate | undefined) {
    const entries = promptEntries(template);
    return entries.find(([key]) => key === "Main Prompt")?.[0] || entries[0]?.[0] || "";
}

function productVariableTokens(context: ExcelPromptContext) {
    const seen = new Set<string>();
    const tokens: string[] = [];
    for (const template of context.templates) {
        for (const [, prompt] of promptEntries(template)) {
            for (const token of promptVariableTokens(prompt)) {
                if (!seen.has(token)) {
                    seen.add(token);
                    tokens.push(token);
                }
            }
        }
    }
    return tokens;
}

export function buildPromptVariablesMetadata(context: ExcelPromptContext = { fileName: "", activeProductName: "", templates: [] }, template = defaultTemplate(context), promptKey = defaultPromptKey(template), previousValues: Record<string, string> = {}): CanvasNodeMetadata {
    const prompt = String(template?.prompts?.[promptKey] || "");
    const spec = parseExcelPromptSpec(promptKey, prompt);
    const tokens = promptVariableTokens(prompt);
    const values = completePromptVariableValues(tokens, previousValues);
    return {
        status: "success",
        promptVariableTemplateId: template?.id || "",
        promptVariablePromptKey: promptKey,
        promptVariablePromptTheme: spec.theme,
        promptVariableCompositionLock: spec.compositionLock,
        promptVariablePurpose: spec.purpose,
        promptVariableSource: "excel-marker",
        promptVariableProductName: productName(template?.route || "") || context.activeProductName,
        promptVariableFileName: context.fileName,
        promptVariableRawPrompt: prompt,
        promptVariableTokens: tokens,
        promptVariableValues: values,
        promptVariableResolvedPrompt: resolvePromptVariables(prompt, values),
        productPlatform: WILDBERRIES_PLATFORM,
        productLanguage: WILDBERRIES_LANGUAGE,
        productPlatformRules: WILDBERRIES_RULES_TEXT,
    } as ProductParameterMetadata;
}

export function promptVariablesResource(node: CanvasNodeData): CanvasNodeResource | null {
    const text = resolvePromptVariables(node.metadata?.promptVariableRawPrompt || "", node.metadata?.promptVariableValues, productParameterSupplement(node.metadata));
    return text.trim() ? { kind: "text", text } : null;
}

function pickCurrentTemplate(context: ExcelPromptContext, metadata: CanvasNodeMetadata) {
    return context.templates.find((template) => template.id === metadata.promptVariableTemplateId) || defaultTemplate(context);
}


export { variableLabel, pickCurrentTemplate, productVariableTokens };
