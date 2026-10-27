import { useCallback, useMemo, useSyncExternalStore } from 'react';
import type { CanvasNodeData, CanvasNodeText } from '@/types/canvas';
import { textPreviewSnapshot, subscribeTextPreview } from './文本临时显示.mjs';
const noPreview = () => null;

export function useCanvasTextPreview(node: CanvasNodeData): CanvasNodeData {
    const subscribe = useCallback((listener: () => void) => subscribeTextPreview(node.id, listener), [node.id]);
    const read = useCallback(() => textPreviewSnapshot(node.id), [node.id]);
    const preview = useSyncExternalStore(subscribe, read, noPreview);
    return useMemo(() => {
        if (node.type !== 'text' || !preview || !node.metadata) return node;
        const tasks = node.metadata.gatewayGenerationTasks || [];
        const active = tasks.flatMap(task => {
            const item = preview.get(task.taskId);
            return item && item.slotId === task.slotId ? [item] : [];
        });
        if (!active.length) return node;
        const texts: CanvasNodeText[] = node.metadata.texts?.length ? node.metadata.texts : active.map(item => ({ id: item.slotId, content: '', status: 'loading' }));
        const primaryId = node.metadata.primaryTextId || texts[0]?.id;
        const primary = active.find(item => item.slotId === primaryId);
        return { ...node, metadata: { ...node.metadata,
            ...(primary ? { content: primary.text } : {}),
            texts: texts.map(item => { const value = active.find(current => current.slotId === item.id); return value ? { ...item, content: value.text } : item; }),
        } };
    }, [node, preview]);
}
