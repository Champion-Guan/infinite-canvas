import { useRef, useState, useSyncExternalStore } from "react";

export type CanvasGenerationRequest = {
    targetNodeId: string;
    originNodeId: string;
    runningNodeId: string;
    controller: AbortController;
};

// 请求表是唯一运行依据，不写入画布；同一配置的来源与结果请求共用运行ID。
export function createCanvasGenerationRegistry() {
    const requests = new Map<string, CanvasGenerationRequest>();
    const listeners = new Set<() => void>();
    let snapshot: ReadonlySet<string> = new Set();
    const publish = () => {
        const next = new Set([...requests.values()].filter(request => !request.controller.signal.aborted).map(request => request.runningNodeId));
        if (next.size === snapshot.size && [...next].every(id => snapshot.has(id))) return;
        snapshot = next;
        listeners.forEach(listener => listener());
    };
    const startGenerationRequest = (targetNodeId: string, originNodeId: string, runningId = originNodeId, controller = new AbortController()) => {
        const previous = requests.get(targetNodeId);
        if (previous?.controller !== controller) previous?.controller.abort();
        requests.set(targetNodeId, { targetNodeId, originNodeId, runningNodeId: runningId, controller });
        publish();
        return controller;
    };
    const finishGenerationRequest = (targetNodeId: string, controller: AbortController) => {
        if (requests.get(targetNodeId)?.controller === controller) requests.delete(targetNodeId);
        publish();
    };
    const stopGenerationRequests = (runningId: string) => {
        const affected = new Set<string>();
        requests.forEach(request => {
            if (request.runningNodeId !== runningId) return;
            request.controller.abort();
            if (requests.get(request.targetNodeId) === request) requests.delete(request.targetNodeId);
            affected.add(request.targetNodeId);
            affected.add(request.originNodeId);
        });
        publish();
        return affected;
    };
    return {
        requests: requests as ReadonlyMap<string, CanvasGenerationRequest>,
        getSnapshot: () => snapshot,
        subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
        startGenerationRequest, finishGenerationRequest, stopGenerationRequests,
    };
}

export function useCanvasGenerationRequests() {
    const [registry] = useState(createCanvasGenerationRegistry);
    const generationRequestsRef = useRef(registry.requests);
    const runningNodeIds = useSyncExternalStore(registry.subscribe, registry.getSnapshot, registry.getSnapshot);
    return { generationRequestsRef, runningNodeIds,
        startGenerationRequest: registry.startGenerationRequest,
        finishGenerationRequest: registry.finishGenerationRequest,
        stopGenerationRequests: registry.stopGenerationRequests };
}
