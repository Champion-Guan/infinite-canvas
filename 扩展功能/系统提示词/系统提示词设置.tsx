import { Input, Segmented } from "antd";
import { AudioLines, FileText, Image, RotateCcw, Video } from "lucide-react";
import { useState } from "react";
import type { AiConfig } from "@/stores/use-config-store";
import { AppleAntButton } from "../主题/苹果交互按钮";
import { TabContentTransition } from "../主题/页签内容过渡";
import { CAPABILITY_PROMPT_KEYS, imagePlanningSystemPrompt, systemPromptForCapability, type PromptCapability } from "./分类提示词规则";

const categories = [
    { value: "image", label: "生图", icon: Image },
    { value: "text", label: "文本", icon: FileText },
    { value: "video", label: "视频", icon: Video },
    { value: "audio", label: "音频", icon: AudioLines },
] as const;

export function SystemPromptSettings({ config, onChange }: {
    config: AiConfig;
    onChange: <K extends keyof AiConfig>(key: K, value: AiConfig[K]) => void;
}) {
    const [category, setCategory] = useState<PromptCapability>("image");
    const current = categories.find(item => item.value === category)!;
    return <section aria-label="系统提示词" className="min-w-0">
        <div className="mb-2 flex min-h-6 items-center justify-between gap-2">
            <div className="text-sm">系统提示词</div>
            {category === "image" ? <AppleAntButton size="small" type="text" icon={<RotateCcw className="size-3.5" />}
                disabled={config.imagePlanningSystemPrompt == null}
                onClick={() => onChange("imagePlanningSystemPrompt", null)}>恢复默认</AppleAntButton> : null}
        </div>
        <Segmented aria-label="系统提示词分类" value={category} onChange={setCategory}
            options={categories.map(({ value, label, icon: Icon }) => ({ value,
                label: <span className="inline-flex items-center gap-1.5"><Icon className="size-3.5" aria-hidden="true" />{label}</span>,
            }))} />
        <TabContentTransition transitionKey={category} className="mt-3 min-h-[360px]">
            <Input.TextArea aria-label={`${current.label}系统提示词`} rows={14}
                value={category === "image" ? imagePlanningSystemPrompt(config) : systemPromptForCapability(config, category)}
                className="guan-scroll-field"
                onChange={event => onChange(category === "image" ? "imagePlanningSystemPrompt" : CAPABILITY_PROMPT_KEYS[category], event.target.value)} />
        </TabContentTransition>
    </section>;
}
