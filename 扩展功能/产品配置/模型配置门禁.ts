import { FALLBACK_MODEL_OPTION, fallbackModelsByCapability, modelCapabilityOf, useConfigStore,
    type AiConfig, type ModelCapability } from "@/stores/use-config-store";
import { publishMissingModelNotice } from "./模型配置通知";

const labels = { text: "文本", image: "图片", video: "视频", audio: "音频" } as const;
const preferred = (config: AiConfig, capability: ModelCapability) => ({
    text: config.textModel, image: config.imageModel, video: config.videoModel, audio: config.audioModel,
})[capability];

export class ModelConfigurationRequiredError extends Error {
    readonly code = "model_configuration_required";
    constructor(readonly capability: ModelCapability, message: string) {
        super(message); this.name = "ModelConfigurationRequiredError";
    }
}
export function modelConfigurationProblem(config: AiConfig, capability: ModelCapability, selected = config.model || preferred(config, capability)) {
    const label = labels[capability];
    const state = useConfigStore.getState();
    const ready = (model: string) => modelCapabilityOf(config, model) === capability && state.isAiConfigReady(config, model);
    const usingFallback = selected === FALLBACK_MODEL_OPTION || config.fallbackRequested && config.fallbackCapability === capability;
    if (usingFallback) {
        try { if (fallbackModelsByCapability(config, capability).some(ready)) return ""; } catch { /* 未接入或空的Fallback同样引导配置。 */ }
        return `尚未配置可用的${label} Fallback 模型，请在“渠道”中添加${label}模型并检查 Fallback 配置。`;
    }
    if (!config.channels.some(channel => channel.models.some(model => model.capability === capability)))
        return `尚未添加${label}模型，请在“渠道”中添加${label}模型并填写渠道地址与密钥。`;
    if (!selected || modelCapabilityOf(config, selected) !== capability)
        return `当前${label}模型不可用，请在“渠道”中添加或选择可用的${label}模型。`;
    if (!state.isAiConfigReady(config, selected))
        return `${label}模型的渠道配置不完整，请在“渠道”中检查地址与密钥。`;
    return "";
}

export function showMissingModelConfiguration(capability: ModelCapability, message = `请先在“渠道”中添加并配置${labels[capability]}模型。`) {
    // 只拦截本次操作；保存设置后由用户重新点击，不自动提交收费任务。
    useConfigStore.getState().openConfigDialog(false, "channels");
    publishMissingModelNotice(message);
}
export function ensureModelConfigured(config: AiConfig, capability: ModelCapability, selected?: string) {
    const problem = modelConfigurationProblem(config, capability, selected);
    if (!problem) return true;
    showMissingModelConfiguration(capability, problem);
    return false;
}
export function requireModelConfigured(config: AiConfig, capability: ModelCapability, selected?: string) {
    const problem = modelConfigurationProblem(config, capability, selected);
    if (!problem) return;
    showMissingModelConfiguration(capability, problem);
    throw new ModelConfigurationRequiredError(capability, problem);
}
