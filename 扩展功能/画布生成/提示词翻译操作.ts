// 最终提示词翻译只负责建卡、关联和调用原生成入口；任务账本仍使用原文本生成链路。
import { useCallback, useEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { MessageInstance } from "antd/es/message/interface";
import type { AiConfig } from "@/stores/use-config-store";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";
import type { CanvasNodeGenerationMode } from "@/components/canvas/canvas-node-prompt-panel";
import { buildGenerationConfig } from "@/lib/canvas/canvas-generation-helpers";
import { createCanvasNode } from "@/lib/canvas/canvas-node-factory";
import { nanoid } from "nanoid";

type TranslationPort = {
    projectId: string;
    nodesRef: RefObject<CanvasNodeData[]>;
    connectionsRef: RefObject<CanvasConnection[]>;
    generateNodeRef: RefObject<((id: string, mode: CanvasNodeGenerationMode, prompt: string) => Promise<void>) | null>;
    effectiveConfig: AiConfig;
    isAiConfigReady: (config: AiConfig, model: string) => boolean;
    openConfigDialog: (open: boolean) => void;
    assertImportTarget: () => void;
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
    setConnections: Dispatch<SetStateAction<CanvasConnection[]>>;
    setSelectedNodeIds: Dispatch<SetStateAction<Set<string>>>;
    message: MessageInstance;
};
export function usePromptTranslation({ projectId, nodesRef, connectionsRef, generateNodeRef, effectiveConfig,
    isAiConfigReady, openConfigDialog, assertImportTarget, setNodes, setConnections, setSelectedNodeIds, message }: TranslationPort) {
    const pending = useRef(new Set<ReturnType<typeof setTimeout>>());
    useEffect(() => {
        const timers = pending.current;
        return () => { for (const timer of timers) clearTimeout(timer); timers.clear(); };
    }, [projectId]);

    return useCallback((node: CanvasNodeData, language: "en" | "zh") => {
        try { assertImportTarget(); } catch (error) { message.warning(error instanceof Error ? error.message : "原画布已切换"); return; }
        const current = nodesRef.current.find(item => item.id === node.id);
        if (!current) return;
        const source = current.metadata?.content?.trim();
        if (!source) { message.warning("最终提示词为空，无法翻译"); return; }
        const existing = nodesRef.current.find(item => item.metadata?.promptVariableTranslationOf === current.id && item.metadata?.promptVariableTranslationLanguage === language);
        if (existing) { setSelectedNodeIds(new Set([existing.id])); return; }
        const config = buildGenerationConfig(effectiveConfig, current, "text");
        if (!isAiConfigReady(config, config.model)) { openConfigDialog(true); return; }
        const translated = {
            ...createCanvasNode(CanvasNodeType.Text, { x: current.position.x, y: current.position.y + current.height + 96 },
                { status: "idle", promptVariableTranslationOf: current.id, promptVariableTranslationLanguage: language }),
            title: language === "en" ? "英文最终生图提示词" : "中文最终生图提示词",
        };
        setNodes([...nodesRef.current, translated]);
        const nextConnections = [...connectionsRef.current, { id: nanoid(), fromNodeId: current.id, toNodeId: translated.id }];
        connectionsRef.current = nextConnections;
        setConnections(nextConnections);
        setSelectedNodeIds(new Set([translated.id]));
        const timer = setTimeout(() => {
            pending.current.delete(timer);
            try {
                assertImportTarget();
                const original = nodesRef.current.find(item => item.id === current.id);
                const target = nodesRef.current.find(item => item.id === translated.id);
                if (!target || !original || original.metadata?.content?.trim() !== source) return;
                if (target.metadata?.content || target.metadata?.status !== "idle") return;
                void generateNodeRef.current?.(translated.id, "text",
                    `${language === "en" ? "Translate the following image-generation prompt into natural English" : "将下面的生图提示词翻译成自然、准确的简体中文"}. Preserve all product facts, structure, measurements, and placeholders. Output only the translated prompt, with no explanation.\n\n${source}`,
                ).catch(error => message.error(error instanceof Error ? error.message : "提示词翻译失败"));
            } catch { /* 切换或关闭原画布后不提交新的翻译请求。 */ }
        }, 0);
        pending.current.add(timer);
    }, [nodesRef, connectionsRef, generateNodeRef, effectiveConfig, isAiConfigReady, openConfigDialog, assertImportTarget,
        setNodes, setConnections, setSelectedNodeIds, message]);
}
