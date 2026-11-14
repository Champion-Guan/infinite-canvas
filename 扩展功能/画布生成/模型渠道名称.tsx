import { decodeChannelModel, modelOptionName, type AiConfig } from "@/stores/use-config-store";

export function ModelChannelName({ config, model, compact = false }: { config: AiConfig; model: string; compact?: boolean }) {
    const decoded = decodeChannelModel(model);
    const channel = decoded && config.channels.find(item => item.id === decoded.channelId);
    return <span className="canvas-model-channel-name flex min-w-0 flex-1 flex-col text-left">
        <span className={compact ? "block truncate text-[12px] leading-[14px]" : "block whitespace-normal break-all text-[13px] leading-[18px]"}>
            {modelOptionName(model)}
        </span>
        {channel ? <span className={compact ? "block truncate text-[10px] leading-[12px] opacity-65" : "block whitespace-normal break-words text-[11px] leading-[16px] opacity-65"}
            title={channel.name}>{channel.name}</span> : null}
    </span>;
}
