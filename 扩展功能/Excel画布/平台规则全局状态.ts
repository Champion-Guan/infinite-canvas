export const WILDBERRIES_PLATFORM = "Wildberries";
export const WILDBERRIES_IMAGE_COUNTS = { main: 1, carousel: 10, rich: 6 } as const;
export const WILDBERRIES_RULES_TEXT = [
    `主图/轮播图：共${WILDBERRIES_IMAGE_COUNTS.main + WILDBERRIES_IMAGE_COUNTS.carousel}张（主图${WILDBERRIES_IMAGE_COUNTS.main}张、轮播图${WILDBERRIES_IMAGE_COUNTS.carousel}张），1800 x 2400 px ，3 : 4 ，PNG ，单张小于10MB 。`,
    `富内容：${WILDBERRIES_IMAGE_COUNTS.rich}张，800 x 500 px ，PNG ，单张最大5MB 。`,
    "商品卡视频：3 : 4 ，MP4 ，小于50MB 。",
].join("\n");
const oldDefaults = new Set([
    ["主图/轮播图：1800×2400，3:4，JPG/PNG/WEBP，单张小于10MB，最多30张，最低700×933。",
        "商品卡视频：3:4，MOV/MP4，单个小于50MB。", "富内容：仅图片，800×500，JPG/PNG，单张最大5MB。"].join("\n"),
    ["主图/轮播图：1800 x 2400 px ，3 : 4 ，PNG ，单张小于10MB 。",
        "富内容：800 x 500 px ，PNG ，单张最大5MB 。", "商品卡视频：3 : 4 ，MP4 ，小于50MB 。"].join("\n"),
    ["主图/轮播图：共10张（主图1张、轮播图9张），1800 x 2400 px ，3 : 4 ，PNG ，单张小于10MB 。",
        "富内容：6张，800 x 500 px ，PNG ，单张最大5MB 。", "商品卡视频：3 : 4 ，MP4 ，小于50MB 。"].join("\n"),
]);
export const defaultProductPlatformRules = (platform: string) => platform === WILDBERRIES_PLATFORM ? WILDBERRIES_RULES_TEXT : "";
export const GLOBAL_PLATFORM_RULES_KEY = "guan-platform-rules:v1";
type Storage = { getItem(key: string): string | null; setItem(key: string, value: string): void; flush(): Promise<unknown> };
type LegacyProject = { id?: string; updatedAt?: string; nodes?: Array<{ metadata?: {
    productPlatform?: string; productPlatformRules?: string; productPlatformRuleOverrides?: Record<string, string>;
} }> };

export function createGlobalPlatformRuleStore() {
    let storage: Storage | null = null, rules: Readonly<Record<string, string>> = Object.freeze({});
    const listeners = new Set<() => void>();
    const publish = (value: Record<string, string>) => {
        rules = Object.freeze(value);
        for (const listener of listeners) listener();
    };
    const read = (platform: string) => Object.hasOwn(rules, platform) ? rules[platform] : defaultProductPlatformRules(platform);
    return {
        read,
        getSnapshot: () => rules,
        subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
        async initialize(port: Storage, projects: LegacyProject[] = []) {
            const raw = port.getItem(GLOBAL_PLATFORM_RULES_KEY);
            let next: Record<string, string> = {};
            if (raw !== null) {
                const value = JSON.parse(raw);
                if (value?.version !== 1 || !value.rules || typeof value.rules !== "object" || Array.isArray(value.rules)
                    || Object.values(value.rules).some(item => typeof item !== "string"))
                    throw Error("全局平台规则格式异常，未使用默认值覆盖。");
                next = { ...value.rules };
            } else {
                // Seed once from the newest saved product. Keep legacy card
                // fields untouched so conflicting old edits remain recoverable.
                const ordered = [...projects].sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""))
                    || String(a.id || "").localeCompare(String(b.id || "")));
                const chosen = new Set<string>();
                for (const project of ordered) for (const node of project.nodes || []) {
                    const metadata = node.metadata;
                    if (!metadata) continue;
                    for (const [platform, text] of Object.entries(metadata.productPlatformRuleOverrides || {})) {
                        if (chosen.has(platform) || typeof text !== "string") continue;
                        chosen.add(platform);
                        if (text !== defaultProductPlatformRules(platform)) next[platform] = text;
                    }
                    const text = metadata.productPlatformRules?.trim();
                    if (metadata.productPlatform === WILDBERRIES_PLATFORM && text && !oldDefaults.has(text)
                        && text !== WILDBERRIES_RULES_TEXT && !chosen.has(WILDBERRIES_PLATFORM)) {
                        next[WILDBERRIES_PLATFORM] = text;
                        chosen.add(WILDBERRIES_PLATFORM);
                    }
                }
            }
            storage = port;
            if (raw === null) {
                port.setItem(GLOBAL_PLATFORM_RULES_KEY, JSON.stringify({ version: 1, rules: next }));
                await port.flush();
            }
            publish(next);
        },
        async save(platform: string, draft: string, expected: string) {
            if (!storage) throw Error("全局平台规则存储尚未就绪，请重新打开工作台。");
            if (read(platform) !== expected) throw Error("平台规则已被其他操作修改，请重新打开编辑。");
            const value = draft.trim();
            if (read(platform) !== value) {
                const next = { ...rules };
                if (value === defaultProductPlatformRules(platform)) delete next[platform];
                else next[platform] = value;
                storage.setItem(GLOBAL_PLATFORM_RULES_KEY, JSON.stringify({ version: 1, rules: next }));
                publish(next);
            }
            await storage.flush();
        },
    };
}
export const globalPlatformRules = createGlobalPlatformRuleStore();
