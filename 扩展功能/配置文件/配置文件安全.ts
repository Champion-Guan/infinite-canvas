// 独立后继，原配置安全来源 SHA256 f703e850d553a23e83a0c51922db19a3f96128c70e9bf0c41836630f7ea69b50；保留脱敏及导入门禁，只增加有限非负价格字段。
// 迁入旧版config-file.ts与config-portability.ts的导出/导入行为。
// 来源与指纹由开发工具/预审配置文件安全.mjs锁定；SQLite负责凭据加密及保存ACK。
import { saveAs } from "file-saver";

import i18n from "@/i18n/index";
import { defaultConfig, defaultWebdavSyncConfig, useConfigStore, type AiConfig, type WebdavSyncConfig } from "@/stores/use-config-store";
import { usePromptSourceStore, type PromptSourceSchedule } from "@/stores/use-prompt-source-store";
import { filterWorkbenchPromptSources, type PromptSource } from "@/services/api/prompt-source-presets";
import { flushSQLiteStorage } from "../本机存储/上游浏览器存储桥";

type AppConfigFile = {
    app: "infinite-canvas";
    version: 1;
    exportedAt: string;
    credentialsOmitted?: true;
    config: AiConfig;
    webdav: WebdavSyncConfig;
    promptSources: { sources: PromptSource[]; schedule: PromptSourceSchedule };
};

export const MAX_CONFIG_BYTES = 4 * 1024 * 1024;
let importing = false;

function portableEndpoint(value: string) {
    if (!value) return value;
    try {
        const url = new URL(value, "http://config.invalid");
        if (/\/(?:local-secure-api)(?:\/|$)/i.test(decodeURIComponent(url.pathname))) return "";
        // Endpoint userinfo and query strings may themselves contain tokens.
        if (url.username || url.password || url.search || url.hash) return "";
    } catch {
        // An invalid endpoint is not a usable portable configuration value.
        return "";
    }
    return value;
}

export function createPortableAppConfig(config: AiConfig, webdav: WebdavSyncConfig, sources: PromptSource[], schedule: PromptSourceSchedule): AppConfigFile {
    const fields = Object.fromEntries(Object.keys(defaultConfig).map((key) => [key, config[key as keyof AiConfig]])) as AiConfig;
    return {
        app: "infinite-canvas", version: 1, exportedAt: new Date().toISOString(), credentialsOmitted: true,
        config: {
            ...fields,
            apiKey: "",
            baseUrl: portableEndpoint(config.baseUrl),
            proxyUrl: portableEndpoint(config.proxyUrl),
            channels: config.channels.map((channel) => ({
                id: channel.id, name: channel.name, apiFormat: channel.apiFormat, apiKey: "", baseUrl: portableEndpoint(channel.baseUrl),
                // Arbitrary request scripts can contain embedded credentials.
                models: channel.models.map((model) => ({ name: model.name, capability: model.capability, script: "",
                    ...(typeof model.price === "number" && Number.isFinite(model.price) && model.price >= 0 ? { price: model.price } : {}) })),
            })),
        },
        webdav: { username: webdav.username, directory: webdav.directory, lastSyncedAt: webdav.lastSyncedAt, password: "", url: portableEndpoint(webdav.url) },
        promptSources: {
            sources: sources.map((source) => ({ id: source.id, name: source.name, enabled: source.enabled, builtIn: source.builtIn,
                url: portableEndpoint(source.url), homepage: portableEndpoint(source.homepage) })),
            schedule: { intervalMinutes: schedule.intervalMinutes, lastFetchedAt: schedule.lastFetchedAt },
        },
    };
}

function invalid(): never { throw new Error(i18n.t("config.invalidFile")); }
function record(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}
function string(value: unknown): string { if (typeof value !== "string") invalid(); return value; }
function boolean(value: unknown): boolean { if (typeof value !== "boolean") invalid(); return value; }
function secret(value: unknown): string {
    const text = string(value);
    if (/[\uD800-\uDFFF]/u.test(text) || new TextEncoder().encode(text).length > 2048) invalid();
    return text;
}

// 凭据引用属于原工作区，不能让导入文件选择当前电脑的账户。
export function assertPortableCredentialBindings(config: unknown, webdav: unknown) {
    const object = (value: unknown): Record<string, unknown> => record(value) ? value : {};
    const root = object(config);
    const bindings = [root, ...(Array.isArray(root.channels) ? root.channels.map(object) : []), object(webdav)];
    for (const binding of bindings) {
        for (const key of ["apiKey", "password"]) {
            const value = binding[key];
            if (typeof value === "string" && /^(?:guan-vault|secret|provider):/i.test(value.trim())) throw new Error("config_local_credential_reference");
        }
        for (const key of ["baseUrl", "url"]) {
            const value = binding[key];
            if (typeof value !== "string" || !value.trim()) continue;
            try {
                const path = new URL(value, "http://config.invalid").pathname;
                if (/\/(?:local-secure-api)(?:\/|$)/i.test(decodeURIComponent(path))) throw new Error("config_local_credential_reference");
            } catch (error) {
                if (error instanceof Error && error.message === "config_local_credential_reference") throw error;
            }
        }
    }
}

function parseConfigFile(value: unknown): AppConfigFile {
    if (!record(value) || value.app !== "infinite-canvas" || value.version !== 1 ||
        (value.credentialsOmitted !== undefined && value.credentialsOmitted !== true) ||
        !record(value.config) || !record(value.webdav) || !record(value.promptSources) ||
        !Array.isArray(value.config.channels) || !value.config.channels.length ||
        !Array.isArray(value.promptSources.sources) || !record(value.promptSources.schedule)) invalid();
    const input = value.config;
    // 只接收当前配置的已知数据字段；旧文件缺少的偏好补默认值，不将额外JSON展开到store。
    const config = { ...defaultConfig, models: [...defaultConfig.models] };
    for (const key of Object.keys(defaultConfig) as Array<keyof AiConfig>) {
        if (key === "channels" || !Object.hasOwn(input, key)) continue;
        const field = input[key], fallback = defaultConfig[key];
        if (Array.isArray(fallback)) {
            if (!Array.isArray(field) || field.some((item) => typeof item !== "string")) invalid();
        } else if (typeof field !== typeof fallback) invalid();
        Object.assign(config, { [key]: field });
    }
    config.apiKey = secret(config.apiKey);
    const ids = new Set<string>();
    config.channels = value.config.channels.map((channel) => {
        if (!record(channel) || !Array.isArray(channel.models) || !["openai", "gemini"].includes(string(channel.apiFormat))) invalid();
        const id = string(channel.id);
        if (!id || ids.has(id)) invalid();
        ids.add(id);
        return {
            id, name: string(channel.name), baseUrl: string(channel.baseUrl), apiKey: secret(channel.apiKey),
            apiFormat: channel.apiFormat as "openai" | "gemini",
            models: channel.models.map((model) => {
                if (!record(model) || !["image", "video", "text", "audio"].includes(string(model.capability))) invalid();
                if (model.price !== undefined && (typeof model.price !== "number" || !Number.isFinite(model.price) || model.price < 0)) invalid();
                return { name: string(model.name), ...(model.price === undefined ? {} : { price: model.price as number }), capability: model.capability as "image" | "video" | "text" | "audio",
                    ...(model.script === undefined ? {} : { script: string(model.script) }) };
            }),
        };
    });
    if (!["local", "remote"].includes(config.channelMode) || !["openai", "gemini"].includes(config.apiFormat) ||
        !["auto", "low", "medium", "high", "xhigh"].includes(config.reasoningEffort) ||
        !["new-node", "overwrite"].includes(config.nodeRegenerateBehavior)) invalid();
    const webdav = { ...defaultWebdavSyncConfig };
    for (const key of Object.keys(defaultWebdavSyncConfig) as Array<keyof WebdavSyncConfig>) {
        if (Object.hasOwn(value.webdav, key)) webdav[key] = string(value.webdav[key]);
    }
    webdav.password = secret(webdav.password);
    const sourceIds = new Set<string>();
    const sources = value.promptSources.sources.map((source) => {
        if (!record(source)) invalid();
        const id = string(source.id);
        if (!id || sourceIds.has(id)) invalid();
        sourceIds.add(id);
        return { id, name: string(source.name), url: string(source.url), homepage: string(source.homepage),
            enabled: boolean(source.enabled), builtIn: boolean(source.builtIn) };
    });
    const schedule = value.promptSources.schedule;
    if (typeof schedule.intervalMinutes !== "number" || ![0, 30, 60, 360, 1440].includes(schedule.intervalMinutes)) invalid();
    const data: AppConfigFile = {
        app: "infinite-canvas", version: 1, exportedAt: value.exportedAt === undefined ? "" : string(value.exportedAt),
        ...(value.credentialsOmitted === true ? { credentialsOmitted: true } : {}), config, webdav,
        promptSources: { sources: filterWorkbenchPromptSources(sources), schedule: { intervalMinutes: schedule.intervalMinutes, lastFetchedAt: string(schedule.lastFetchedAt) } },
    };
    try { assertPortableCredentialBindings(data.config, data.webdav); }
    catch { throw new Error("配置包含仅限原工作区使用的安全凭据引用，请在此电脑重新授权；原配置未改变。"); }
    return data;
}

export function exportAppConfig() {
    const { config, webdav } = useConfigStore.getState();
    const { sources, schedule } = usePromptSourceStore.getState();
    const data = createPortableAppConfig(config, webdav, sources, schedule);
    saveAs(new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" }), "guan-workbench-config-no-credentials.json");
}

export async function importAppConfig(file: File) {
    if (importing) throw new Error("正在导入配置，请等待当前导入完成。");
    importing = true;
    try {
        const original = useConfigStore.getState(), originalSources = usePromptSourceStore.getState();
        // 既有失败保存先留在原队列，不能用一次新导入掩盖它。
        await flushSQLiteStorage();
        let raw: unknown;
        try {
            if (file.size > MAX_CONFIG_BYTES) invalid();
            const text = await file.text();
            if (new TextEncoder().encode(text).length > MAX_CONFIG_BYTES) invalid();
            raw = JSON.parse(text);
        } catch { invalid(); }
        const data = parseConfigFile(raw);
        if (data.credentialsOmitted) {
            for (const channel of data.config.channels) {
                const old = original.config.channels.find((item) => item.id === channel.id);
                channel.apiKey = old && channel.baseUrl && channel.apiFormat === old.apiFormat && channel.baseUrl === old.baseUrl ? old.apiKey : "";
            }
            data.config.apiKey = data.config.baseUrl && data.config.apiFormat === original.config.apiFormat && data.config.baseUrl === original.config.baseUrl ? original.config.apiKey : "";
            data.webdav.password = data.webdav.url && data.webdav.username === original.webdav.username && data.webdav.url === original.webdav.url ? original.webdav.password : "";
        }
        const current = useConfigStore.getState(), currentSources = usePromptSourceStore.getState();
        if (current.config !== original.config || current.webdav !== original.webdav ||
            currentSources.sources !== originalSources.sources || currentSources.schedule !== originalSources.schedule) {
            throw new Error("配置已改变，请重新导入；本次导入未覆盖现有编辑。");
        }
        useConfigStore.setState({ config: data.config, webdav: data.webdav });
        usePromptSourceStore.setState({ sources: data.promptSources.sources, schedule: data.promptSources.schedule });
        // 两份store沿用既有保存队列；不把页面setState当成已落盘，也不自动回滚覆盖期间的新编辑。
        try { await flushSQLiteStorage(); }
        catch { throw new Error("导入配置的本机保存尚未确认，请保留页面并通过保存状态栏重试。"); }
    } finally { importing = false; }
}
