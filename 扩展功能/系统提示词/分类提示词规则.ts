import { PRODUCT_PLANNING_ROLE } from "../Excel画布/商品视觉策划指令";

export type PromptCapability = "image" | "text" | "video" | "audio";
export type SystemPromptPreferences = {
    systemPrompt?: string;
    imageSystemPrompt?: string | null;
    textSystemPrompt?: string | null;
    videoSystemPrompt?: string | null;
    imagePlanningSystemPrompt?: string | null;
    audioInstructions?: string;
};

export const CAPABILITY_PROMPT_KEYS = {
    image: "imageSystemPrompt", text: "textSystemPrompt", video: "videoSystemPrompt", audio: "audioInstructions",
} as const;

export function systemPromptForCapability(config: SystemPromptPreferences, capability: PromptCapability): string {
    const value = config[CAPABILITY_PROMPT_KEYS[capability]];
    if (typeof value === "string") return value;
    // The legacy field was used by image and text requests only.
    return capability === "image" || capability === "text" ? config.systemPrompt ?? "" : "";
}

export function withCapabilitySystemPrompt<T extends SystemPromptPreferences>(config: T, capability: PromptCapability) {
    return {
        ...config,
        imageSystemPrompt: systemPromptForCapability(config, "image"),
        textSystemPrompt: systemPromptForCapability(config, "text"),
        videoSystemPrompt: systemPromptForCapability(config, "video"),
        systemPrompt: systemPromptForCapability(config, capability),
    };
}

export function imagePlanningSystemPrompt(config: SystemPromptPreferences) {
    return config.imagePlanningSystemPrompt ?? PRODUCT_PLANNING_ROLE;
}

export function prependSystemPrompt(system: string | null | undefined, prompt: string) {
    return system?.trim() ? `${system.trim()}\n\n${prompt}` : prompt;
}
