import type { AiTextMessage } from "@/services/api/image";

type TextConfig = { apiFormat: string; model: string; baseUrl: string; systemPrompt: string; reasoningEffort: string };

// 沿用旧版 Responses/Gemini 消息协议，交给既有本机任务端口发送。
export function prepareTextRequest(config: TextConfig, messages: AiTextMessage[]) {
    const system = config.systemPrompt.trim();
    const input = system ? [{ role: "system" as const, content: system }, ...messages] : messages;
    let path = "/v1/responses";
    let payload: object;
    if (config.apiFormat === "gemini") {
        const model = config.model.trim().replace(/^models\//, "");
        if (!/^[\w.:-]+$/.test(model)) throw Error("Gemini模型名称无效");
        const version = new URL(config.baseUrl).pathname.replace(/\/+$/, "").endsWith("/v1") ? "v1" : "v1beta";
        path = `/${version}/models/${model}:generateContent`;
        const systems = input.filter(item => item.role === "system").map(item => typeof item.content === "string" ? item.content : item.content.filter(part => part.type === "text").map(part => part.text).join("\n"));
        payload = {
            ...(systems.length ? { systemInstruction: { parts: [{ text: systems.join("\n\n") }] } } : {}),
            contents: input.filter(item => item.role !== "system").map(item => ({
                role: item.role === "assistant" ? "model" : "user",
                parts: typeof item.content === "string" ? [{ text: item.content }] : item.content.map(part => {
                    if (part.type === "text") return { text: part.text };
                    const image = part.image_url.url.match(/^data:([^;,]+);base64,(.+)$/s);
                    if (!image) throw Error("文本任务的参考图必须先读取本机内容，未发送远程图片地址");
                    return { inlineData: { mimeType: image[1], data: image[2] } };
                }),
            })),
        };
    } else {
        payload = {
            model: config.model,
            input: input.map(item => ({ role: item.role, content: typeof item.content === "string" ? item.content : item.content.map(part => part.type === "text" ? { type: "input_text", text: part.text } : { type: "input_image", image_url: part.image_url.url }) })),
            ...(config.reasoningEffort === "auto" ? {} : { reasoning: { effort: config.reasoningEffort } }),
            stream: false,
        };
    }
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return { method: "POST" as const, path, contentType: "application/json", body: btoa(binary) };
}

export function parseTextResponse(bytes: string) {
    const payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(atob(bytes), char => char.charCodeAt(0))));
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw Error("文本模型返回格式不正确，原数据已保留");
    if (payload.error?.message) throw Error(payload.error.message);
    const text = payload.output_text || payload.output?.filter((item: { type?: string }) => item.type === "message").flatMap((item: { content?: Array<{ text?: string }> }) => item.content || []).map((item: { text?: string }) => item.text || "").join("") || payload.candidates?.[0]?.content?.parts?.filter((part: { thought?: boolean }) => !part.thought).map((part: { text?: string }) => part.text || "").join("");
    if (typeof text !== "string" || !text.trim()) throw Error("文本模型没有返回有效内容，原数据已保留");
    return text;
}
