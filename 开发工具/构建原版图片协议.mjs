import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ts } from './检查首批功能适配.mjs';
import { 哈希 } from './检查运行副本.mjs';

const 历史来源 = '/Users/guanchengbin/CodexProjects/guan-ai-workbench-projects/guan-ai-workbench';
// 项目迁移后从保留的历史发布来源读取；仍逐文件核验原指纹。
export const 图片原来源 = existsSync(join(历史来源, 'src/canvas/services/api/image.ts')) ? 历史来源 :
  resolve(dirname(fileURLToPath(import.meta.url)), '../.运行/GitHub发布');
export const 图片来源指纹 = Object.freeze({
  'src/canvas/services/api/image.ts': '671f45c36a23e312047cb15d85db6b802454e759a342fc99ab763da8500f70eb',
  'src/canvas/lib/media-size.ts': '122a534ade3e228cc0ef721332a92ab9fef42ccd7db2902d0fa0d827ff54e2bc',
  'src/canvas/lib/image-reference-prompt.ts': 'c61d2d4d24e2bd1ad0a0039c1eb6a7e56247bbb17617a977bff8171430b5b977',
});
function declarations(path) {
  const source = readFileSync(join(图片原来源, path), 'utf8');
  if (哈希(source) !== 图片来源指纹[path]) throw Error('原版图片协议来源改变，停止，不更新指纹');
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true), result = new Map();
  for (const node of file.statements) {
    const name = node.name?.text || (ts.isVariableStatement(node) ? node.declarationList.declarations[0].name.text : null);
    if (name) result.set(name, node.getText(file));
  }
  return result;
}
export function 构建原版图片协议() {
  const original = declarations('src/canvas/services/api/image.ts');
  const media = declarations('src/canvas/lib/media-size.ts');
  declarations('src/canvas/lib/image-reference-prompt.ts');
  const names = ['apiText', 'ImageApiResponse', 'GeminiPart', 'GeminiPayload', 'GeneratedImage',
    'IMAGE_QUALITY_VALUES', 'DEFAULT_IMAGE_SHORT_SIDE', 'IMAGE_SIZE_STEP', 'IMAGE_MIN_PIXELS', 'IMAGE_OUTPUT_FORMAT', 'GEMINI_SUPPORTED_RATIOS',
    'supportsAdvancedImageQuality', 'normalizeQuality', 'normalizeBackground', 'normalizeModeration', 'resolveSize', 'parseRatioValue',
    'parseImageRatio', 'parseImageDimensions', 'validateImageSize', 'ensureMinimumImagePixels', 'resolveRequestSize', 'resolveGeminiImageConfig',
    'closestGeminiAspectRatio', 'resolveGeminiImageSize', 'resolveImageSource', 'parseImagePayload', 'validateGeminiPayload',
    'parseGeminiImagePayload', 'withSystemPrompt', 'toGeminiImagePart', 'attachRequestMetadata'];
  for (const name of names) if (!original.has(name)) throw Error('原版图片声明缺失：' + name);
  const implementation = `
export async function prepareOriginalImageRequest(config: AiConfig, prompt: string, references: ReferenceImage[] = []) {
    const requestConfig = resolveModelRequestConfig(config, config.model || config.imageModel);
    // 原脚本关闭策略继续生效；不把脚本模型静默改为系统请求。
    if (resolveModelScript(config, config.model || config.imageModel)) throw new Error("自定义模型脚本已停用");
    const requestPrompt = references.length ? buildImageReferencePromptText(prompt, references) : prompt;
    const n = Math.max(1, Math.min(15, Math.floor(Math.abs(Number(config.count)) || 1)));
    if (requestConfig.apiFormat === "gemini") {
        if (n !== 1) throw new Error("画布图片任务必须逐张登记，不能共用任务身份");
        const parts: GeminiPart[] = [{ text: requestPrompt }];
        for (const image of references) parts.push(toGeminiImagePart(await imageToDataUrl(image)));
        const systemText = requestConfig.systemPrompt.trim();
        const body = {
            ...(systemText ? { systemInstruction: { parts: [{ text: systemText }] } } : {}),
            generationConfig: { responseModalities: ["TEXT", "IMAGE"], ...resolveGeminiImageConfig(requestConfig) },
            contents: [{ role: "user", parts }],
        };
        const model = requestConfig.model.trim().replace(/^models\\//, "");
        if (!/^[\\w.:-]+$/.test(model)) throw new Error("Gemini模型名称无效");
        const version = new URL(requestConfig.baseUrl).pathname.replace(/\\/+$/, "").endsWith("/v1") ? "/v1" : "/v1beta";
        return encodeImageRequest(version + "/models/" + model + ":generateContent", body);
    }
    const quality = normalizeQuality(config.quality, requestConfig.model);
    const requestSize = resolveRequestSize(quality, config.size);
    const background = normalizeBackground(config.background);
    if (!references.length) {
        return encodeImageRequest("/v1/images/generations", {
            model: requestConfig.model,
            prompt: withSystemPrompt(requestConfig, requestPrompt), n,
            ...(quality ? { quality } : {}), ...(requestSize ? { size: requestSize } : {}),
            ...(background ? { background } : {}), moderation: normalizeModeration(config.moderation),
            ...(/gpt-image/.test(requestConfig.model) ? {} : { response_format: "b64_json" }),
            output_format: IMAGE_OUTPUT_FORMAT,
        });
    }
    const formData = new FormData();
    formData.set("model", requestConfig.model);
    formData.set("prompt", withSystemPrompt(requestConfig, requestPrompt));
    formData.set("n", String(n));
    if (!/gpt-image/.test(requestConfig.model)) formData.set("response_format", "b64_json");
    formData.set("output_format", IMAGE_OUTPUT_FORMAT);
    if (quality) formData.set("quality", quality);
    if (requestSize) formData.set("size", requestSize);
    if (background) formData.set("background", background);
    formData.set("moderation", normalizeModeration(config.moderation));
    const files = await Promise.all(references.map(async (image) => dataUrlToFile({ ...image, dataUrl: await imageToDataUrl(image) })));
    const imageField = files.length > 1 ? "image[]" : "image";
    files.forEach((file) => formData.append(imageField, file));
    return encodeImageRequest("/v1/images/edits", formData);
}
async function encodeImageRequest(path: string, body: object | FormData) {
    // Request只用于原生multipart编码，不发送网络，也不附加Authorization。
    const encoded = new Request("http://encoding.invalid", { method: "POST", body: body instanceof FormData ? body : JSON.stringify(body),
        ...(body instanceof FormData ? {} : { headers: { "Content-Type": "application/json" } }) });
    const bytes = new Uint8Array(await encoded.arrayBuffer());
    if (bytes.length > 32 * 1024 * 1024) throw new Error("图片请求超过32MiB，未发起生成");
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
    let contentType = encoded.headers.get("content-type")!;
    if (body instanceof FormData) {
        const boundary = contentType.split("boundary=")[1];
        const pieces = binary.split(boundary);
        // 拒绝文件内容碰巧包含编码边界；不改写文件字节。
        if (pieces.length !== [...body.keys()].length + 2) throw new Error("参考图编码边界冲突，未提交");
        const canonical = pieces.join("guan-native-multipart-boundary");
        const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical)))].map(value => value.toString(16).padStart(2, "0")).join("");
        const stable = "guan-image-" + digest;
        if (pieces.some(piece => piece.includes(stable))) throw new Error("参考图编码边界冲突，未提交");
        binary = pieces.join(stable); contentType = "multipart/form-data; boundary=" + stable;
    }
    return { method: "POST" as const, path, contentType, body: btoa(binary) };
}
export function parseOriginalImageResponse(config: AiConfig, bytes: string): GeneratedImage[] {
    const decoded = Uint8Array.from(atob(bytes), value => value.charCodeAt(0));
    const payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decoded));
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("渠道图片响应无效");
    if (payload.error?.message) throw new Error(payload.error.message);
    const requestConfig = resolveModelRequestConfig(config, config.model || config.imageModel);
    const images = requestConfig.apiFormat === "gemini" ? parseGeminiImagePayload(payload) : parseImagePayload(payload);
    return attachRequestMetadata(images, config, requestConfig, "direct");
}
`;
  return '// 图片参数、尺寸规则和响应解析迁自锁定旧版；仅传输出口改接本机任务，不含自动收费重试。\n' +
    'import i18n from "@/i18n";\nimport { nanoid } from "nanoid";\n' +
    'import { resolveModelChannel, resolveModelRequestConfig, resolveModelScript, type AiConfig as BaseAiConfig } from "@/stores/use-config-store";\n' +
    'import { dataUrlToFile } from "@/lib/image-utils";\nimport { buildImageReferencePromptText } from "@/lib/image-reference-prompt";\n' +
    'import { imageToDataUrl } from "@/services/image-storage";\nimport type { ReferenceImage } from "@/types/image";\n' +
    'type AiConfig = BaseAiConfig & { moderation?: string };\n' + media.get('imageSizePresets').replace('export ', '') + '\n\n' +
    names.map(name => original.get(name)).join('\n\n') + '\n' + implementation;
}
