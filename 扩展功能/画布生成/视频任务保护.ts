import { useCallback, useEffect, useMemo, type RefObject } from "react";
import type { CanvasNodeData } from "@/types/canvas";
import { resolveModelRequestConfig, resolveModelScript, type AiConfig } from "@/stores/use-config-store";
import { isVideoTaskFailed, type VideoGenerationTask } from "@/services/api/video";
import { waitForProtectedVideo } from "../生成任务/视频读取客户端.mjs";
import { bindGenerationChannel } from "./原画布图片调用";
import { saveProductCanvas } from "../产品/产品操作";
import { serializeProductResult } from "./图片任务衔接.mjs";

type Scope = { id: string; productId: string; nodeId: string; binding: string; provider: "openai" | "gemini"; model: string };
type Record = Scope & { remoteId: string | null; state: "uncertain" | "succeeded" | "failed" | "cancelled" };
type Request = { method: "POST"; path: string; contentType: string; body: string };
type Host = Parameters<typeof bindGenerationChannel>[0] & {
    videoFind(productId: string, nodeId: string): Promise<Record | null>;
    videoCreate(scope: Scope, request: Request): Promise<Record>;
    videoEnsure(scope: Scope, remoteId: string): Promise<Record>;
    videoTerminal(id: string): Promise<Record>;
    videoPoll(id: string): Promise<unknown>;
    videoDownload(id: string): Promise<unknown>;
};
export type ProtectedVideoTask = { task: VideoGenerationTask; record: Record };
const hostPort = () => {
    const host = (window as unknown as { __guanGenerationHost?: Host }).__guanGenerationHost;
    if (!host?.videoCreate) throw Error("本机视频任务保护尚未连接，请重新打开工作台；未发送视频请求。");
    return host;
};
const taskFrom = (record: Record): VideoGenerationTask => {
    if (!record.remoteId) throw Error("原视频创建请求的结果尚未确认，请先在软件更新面板核实原请求；没有重新生成。");
    if (record.state !== "uncertain") throw Error("原视频已结束，请明确开始下一次生成。");
    return { id: record.remoteId, provider: record.provider, model: record.model };
};
async function encodeRequest(path: string, body: FormData | object): Promise<Request> {
    const multipart = body instanceof FormData;
    const request = new globalThis.Request("https://request.invalid", { method: "POST", body: multipart ? body : JSON.stringify(body), ...(multipart ? {} : { headers: { "Content-Type": "application/json" } }) });
    const bytes = new Uint8Array(await request.arrayBuffer());
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
    return { method: "POST", path, contentType: request.headers.get("content-type")!, body: btoa(binary) };
}

export function useCanvasVideoProtection({ projectId, nodesRef, restoredProjectIdRef, surfaceRef, setNodes }: {
    projectId: string; nodesRef: RefObject<CanvasNodeData[]>; restoredProjectIdRef: RefObject<string | null>;
    surfaceRef: RefObject<{ projectId: string; active: boolean; mounted: boolean }>;
    setNodes(update: (previous: CanvasNodeData[]) => CanvasNodeData[]): void;
}) {
    const assertTarget = useCallback((nodeId: string, signal?: AbortSignal) => {
        signal?.throwIfAborted();
        const surface = surfaceRef.current;
        if (!surface.mounted || !surface.active || surface.projectId !== projectId || restoredProjectIdRef.current !== projectId || !nodesRef.current.some(node => node.id === nodeId))
            throw Error("原视频画布已关闭或切换，任务保留在本机账本，请返回原画布继续。");
    }, [projectId, nodesRef, restoredProjectIdRef, surfaceRef]);
    const prepare = useCallback(async (nodeId: string, config: AiConfig) => {
        const host = hostPort(), model = config.model || config.videoModel;
        if (resolveModelScript(config, model)) throw Error("视频脚本未接入当前任务保护，没有发送请求。");
        const resolved = resolveModelRequestConfig(config, model);
        const binding = await bindGenerationChannel(host, { ...config, model });
        const scope: Scope = { id: crypto.randomUUID(), productId: projectId, nodeId, binding, provider: resolved.apiFormat === "gemini" ? "gemini" : "openai", model };
        const pending = await host.videoFind(projectId, nodeId);
        if (pending && ["binding", "provider", "model"].some(key => pending[key as keyof Scope] !== scope[key as keyof Scope]))
            throw Error("原视频使用的渠道或模型已改变，请恢复原渠道查询；没有改用新密钥或重新生成。");
        return { host, scope, pending };
    }, [projectId]);
    const saveIdentity = useCallback(async (record: Record) => {
        const task = taskFrom(record);
        await serializeProductResult(projectId, async () => {
            assertTarget(record.nodeId);
            setNodes(previous => previous.map(node => node.id !== record.nodeId ? node : { ...node, metadata: { ...node.metadata,
                videoTaskId: task.id, videoTaskProvider: record.provider, model: task.model,
            } }));
            await saveProductCanvas(projectId);
        });
        return { task, record };
    }, [projectId, setNodes, assertTarget]);
    const create = useCallback(async (nodeId: string, config: AiConfig, dispatch: (send: (path: string, body: FormData | object) => Promise<VideoGenerationTask>) => Promise<VideoGenerationTask>, signal: AbortSignal) => {
        assertTarget(nodeId, signal);
        const { host, scope, pending } = await prepare(nodeId, config);
        if (pending) return saveIdentity(pending);
        let record: Record | undefined;
        await dispatch(async (path, body) => {
            const request = await encodeRequest(path, body);
            assertTarget(nodeId, signal);
            // 后端先确认意图落盘，再读取绑定凭据发送；页面断线不能触发重发。
            record = await host.videoCreate(scope, request);
            return taskFrom(record);
        });
        if (!record) throw Error("视频创建没有经过持久保护，没有继续轮询。");
        return saveIdentity(record);
    }, [assertTarget, prepare, saveIdentity]);
    const resume = useCallback(async (nodeId: string, config: AiConfig, task: VideoGenerationTask, signal: AbortSignal) => {
        assertTarget(nodeId, signal);
        const { host, scope, pending } = await prepare(nodeId, config);
        if (pending?.remoteId && pending.remoteId !== task.id) throw Error("卡片任务ID与原视频账本不一致，没有覆盖原任务。");
        const record = pending || await host.videoEnsure(scope, task.id);
        return saveIdentity(record);
    }, [assertTarget, prepare, saveIdentity]);
    const wait = useCallback(async (_config: AiConfig, protectedTask: ProtectedVideoTask, signal: AbortSignal) => {
        try { return await waitForProtectedVideo({ host: hostPort(), record: protectedTask.record, signal }); }
        catch (error) {
            if (isVideoTaskFailed(error)) {
                // 只有后端以原绑定再次确认失败终态，调用方才可清理失败任务ID。
                const confirmed = await hostPort().videoTerminal(protectedTask.record.id);
                if (confirmed.state !== "failed") throw Error("视频终态尚未核实，保留原任务。");
            }
            throw error;
        }
    }, []);
    const saveResult = useCallback(async (protectedTask: ProtectedVideoTask, apply: () => void, signal: AbortSignal) => {
        await serializeProductResult(projectId, async () => {
            assertTarget(protectedTask.record.nodeId, signal);
            const node = nodesRef.current.find(node => node.id === protectedTask.record.nodeId);
            if (node?.metadata?.videoTaskId !== protectedTask.task.id) throw Error("原视频卡片任务已经变化，未覆盖结果。");
            apply();
            await saveProductCanvas(projectId);
            await hostPort().videoTerminal(protectedTask.record.id);
        });
    }, [projectId, assertTarget, nodesRef]);
    // 保存成功但终态确认丢ACK时，仅核实原记录，不下载、不上传、不重新生成。
    const savedVideos = JSON.stringify(nodesRef.current.filter(node => node.type === "video" && node.metadata?.status === "success" && node.metadata.content && node.metadata.videoTaskId)
        .map(node => [node.id, node.metadata!.videoTaskId]));
    const active = surfaceRef.current.active;
    useEffect(() => {
        if (!active) return;
        const queue: string[] = JSON.parse(savedVideos).map((item: string[]) => item[0]);
        let stopped = false, timer: ReturnType<typeof setTimeout> | undefined;
        const check = async () => {
            for (let count = 0, length = Math.min(queue.length, 4); count < length && !stopped; count++) {
                const nodeId = queue.shift()!;
                try {
                    const host = hostPort(), record = await host.videoFind(projectId, nodeId);
                    if (stopped) return;
                    if (record) await host.videoTerminal(record.id);
                } catch { queue.push(nodeId); }
            }
            if (!stopped && queue.length) timer = setTimeout(() => { void check(); }, 15000);
        };
        if (queue.length) timer = setTimeout(() => { void check(); }, 15000);
        return () => { stopped = true; clearTimeout(timer); };
    }, [active, projectId, savedVideos]);
    return useMemo(() => ({ create, resume, wait, saveResult }), [create, resume, wait, saveResult]);
}
