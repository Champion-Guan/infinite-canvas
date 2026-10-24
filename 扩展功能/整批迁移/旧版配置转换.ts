import { defaultBaseUrlForApiFormat, defaultConfig, defaultWebdavSyncConfig, type AiConfig } from "@/stores/use-config-store";
import { createPortableAppConfig, parseConfigFile, type AppConfigFile } from "../配置文件/配置文件安全";
import type { ExcelSourcePreference } from "../Excel画布/Excel提示词来源";
import { legacyState, object, type LegacyBackup } from "./旧版备份读取";

export type LegacySettings = { data: AppConfigFile | null; excelSources: Record<string, ExcelSourcePreference>; warnings: string[] };
export function prepareLegacySettings(backup: LegacyBackup, sourceId: string, configFile?: unknown): LegacySettings {
  const stored = legacyState(backup, "infinite-canvas:ai_config_store");
  const prompt = legacyState(backup, "infinite-canvas:prompt_source_store_v2");
  const warnings = ["渠道 API Key、WebDAV 密码、请求脚本及原工作区凭据绑定不自动迁入；目标已有凭据保留，新渠道需重新授权。"];
  const excelSources: Record<string, ExcelSourcePreference> = {};
  if (object(prompt?.excelSources)) for (const [id, value] of Object.entries(prompt.excelSources)) {
    if (!object(value)) throw new Error("旧 Excel 提示词来源偏好格式异常。");
    if (Object.entries(value).some(([key, item]) => !["name", "homepage", "removedRevision", "enabled"].includes(key) || typeof item !== (key === "enabled" ? "boolean" : "string"))) throw new Error("旧 Excel 提示词来源偏好格式异常。");
    excelSources[`${sourceId}_${id}`] = value;
  }
  let input: AppConfigFile | null = null;
  if (configFile !== undefined) input = parseConfigFile(configFile);
  else if (stored || prompt) {
    if (stored && !object(stored.config)) throw new Error("旧配置文件结构异常。");
    const config = { ...defaultConfig, ...(stored?.config as Partial<AiConfig> | undefined) } as AiConfig;
    const webdav = { ...defaultWebdavSyncConfig, ...(object(stored?.webdav) ? stored.webdav : {}) };
    const sources = prompt?.sources ?? [];
    if (!Array.isArray(config.channels) || config.channels.some(channel => !channel || !Array.isArray(channel.models)) || !Array.isArray(sources)) throw new Error("旧渠道或提示词来源格式异常。");
    // 先做白名单脱敏再进入统一解析器，旧工作区的凭据引用不能在新端解释。
    input = parseConfigFile(createPortableAppConfig(config, webdav, sources, { intervalMinutes: 30, lastFetchedAt: "", ...(object(prompt?.schedule) ? prompt.schedule : {}) }));
  }
  if (input) input = parseConfigFile(createPortableAppConfig(input.config, input.webdav, input.promptSources.sources, input.promptSources.schedule));
  const missingEndpoints = input?.config.channels.filter(channel => !channel.baseUrl.trim()).length ?? 0;
  if (missingEndpoints) warnings.push(`${missingEndpoints} 个渠道的原接口地址为空或属于旧版受保护本机转发，完整浏览器备份不含真实端点；请用独立配置文件补充或手动填写地址，默认协议地址不代表原渠道。`);
  return { data: input, excelSources, warnings };
}

export function mergeLegacySettings(current: AppConfigFile, incoming: AppConfigFile | null, sourceId: string, useLegacyPreferences: boolean) {
  if (!incoming) return { data: current, conflicts: [] as string[], addedChannels: 0, channelIds: new Map<string, string>() };
  const data = structuredClone(current), conflicts: string[] = [];
  const channels = data.config.channels;
  const channelIds = new Map<string, string>();
  let addedChannels = 0;
  for (const channel of incoming.config.channels) {
    const original = channels.find(item => item.id === channel.id);
    // 与配置存储刷新时的地址归一规则一致，避免空地址被补默认值后重复创建渠道。
    const endpoint = (item: typeof channel) => item.baseUrl.trim() || defaultBaseUrlForApiFormat(item.apiFormat);
    const same = (item: typeof channel) => endpoint(item) === endpoint(channel) && item.apiFormat === channel.apiFormat;
    const id = original && !same(original) ? `${sourceId}_${channel.id}` : channel.id;
    const existing = channels.find(item => item.id === id);
    channelIds.set(channel.id, id);
    if (existing) {
      if (!same(existing)) throw new Error("迁移渠道编号已存在但端点不同，未覆盖现有渠道。");
      for (const model of channel.models) if (!existing.models.some(item => item.name === model.name && item.capability === model.capability)) existing.models.push({ ...model, script: "" });
    } else { channels.push({ ...channel, id, apiKey: "" }); addedChannels++; }
  }
  const modelValue = (value: string) => {
    const split = value.indexOf("::");
    return split < 0 ? value : `${channelIds.get(value.slice(0, split)) ?? value.slice(0, split)}::${value.slice(split + 2)}`;
  };
  for (const key of Object.keys(defaultConfig) as Array<keyof AiConfig>) {
    if (["channels", "apiKey", "baseUrl", "apiFormat", "models", "proxyEnabled", "proxyUrl"].includes(key)) continue;
    const value = incoming.config[key];
    if (JSON.stringify(current.config[key]) !== JSON.stringify(value)) conflicts.push(`偏好 · ${key}`);
    if (useLegacyPreferences || JSON.stringify(current.config[key]) === JSON.stringify(defaultConfig[key])) {
      Object.assign(data.config, { [key]: typeof value === "string" && ["model", "imageModel", "videoModel", "textModel", "audioModel"].includes(key) ? modelValue(value) : value });
    }
  }
  data.config.models = channels.flatMap(channel => channel.models.map(model => `${channel.id}::${model.name}`));
  if (useLegacyPreferences) data.config.proxyUrl = incoming.config.proxyUrl;
  if (current.webdav.url && current.webdav.url !== incoming.webdav.url) conflicts.push("WebDAV · 服务器和账号");
  if (!current.webdav.url || useLegacyPreferences) {
    const same = current.webdav.url === incoming.webdav.url && current.webdav.username === incoming.webdav.username;
    data.webdav = { ...incoming.webdav, password: same ? current.webdav.password : "" };
  }
  for (const source of incoming.promptSources.sources) {
    const existing = data.promptSources.sources.find(item => item.id === source.id);
    if (!existing) data.promptSources.sources.push(source);
    else if (JSON.stringify(existing) !== JSON.stringify(source)) {
      conflicts.push(`提示词来源 · ${source.name}`);
      if (useLegacyPreferences) Object.assign(existing, source);
    }
  }
  if (useLegacyPreferences) data.promptSources.schedule = incoming.promptSources.schedule;
  return { data, conflicts, addedChannels, channelIds };
}
