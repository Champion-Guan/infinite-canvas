const languages: Record<string, { label: string; english: string }> = {
    "俄文": { label: "俄文", english: "Russian" },
    "俄语": { label: "俄文", english: "Russian" },
    "英文": { label: "英文", english: "English" },
    "英语": { label: "英文", english: "English" },
    "中文": { label: "中文", english: "Chinese" },
};

export const productImageTextLanguage = (value?: string) => languages[value || ""]?.label || "未指定";

export function productImageLanguageRequirement(value?: string) {
    const language = languages[value || ""];
    const requirement = language
        ? `Image text language: ${language.english}. This current setting replaces earlier language directions for ordinary on-image copy only. Render ordinary captions, headings and labels in ${language.english}, translating supplied ordinary copy into ${language.english} even when quoted in another language.`
        : "Image text language: unspecified. No additional language requirement applies; follow the image prompt's copy instructions.";
    return `${requirement} Keep brand names, product names, reference IDs, numbers, measurement units and exact dimension strings unchanged. Preserve existing text in the reference photo when the prompt requires it. Do not add words to a text-free image or introduce captions when only dimension annotations are requested. Preserve all product, composition and editing constraints.`;
}
