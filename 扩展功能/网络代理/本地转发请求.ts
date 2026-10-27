import originalAxios, { AxiosError, AxiosHeaders, CanceledError } from "axios";

export const 本地转发前缀 = () => window.location.origin + "/__guan-local/relay/";
export function 本地转发地址(url: string) { return url.startsWith(本地转发前缀()) ? url : 本地转发前缀() + url; }
type RelayReply = { status: number; headers: Record<string, string>; body: string };
type ProxyPort = { relay(request: { url: string; method: string; headers: Record<string, string>; body: string }, options?: { signal?: AbortSignal }): Promise<RelayReply> };
function encode(bytes: Uint8Array) { let text = ""; for (let i = 0; i < bytes.length; i += 32768) text += String.fromCharCode(...bytes.subarray(i, i + 32768)); return btoa(text); }

// 只供显式接入的渠道/WebDAV模块调用；不改写全局fetch或全局axios。
export async function 本地转发请求(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const request = new Request(typeof input === "string" ? new URL(input, window.location.href) : input, init);
    if (!request.url.startsWith(本地转发前缀())) return fetch(request);
    request.signal.throwIfAborted();
    const port = (window as unknown as { __guanNetworkProxyHost?: ProxyPort }).__guanNetworkProxyHost;
    if (!port) throw Error("本机转发服务尚未就绪，请重新打开工作台。");
    const body = new Uint8Array(await request.arrayBuffer());
    if (body.byteLength > 32 * 1024 * 1024) throw Error("本次转发正文超过32MiB。");
    const result = await port.relay({ url: request.url.slice(本地转发前缀().length), method: request.method,
        headers: Object.fromEntries(request.headers.entries()), body: encode(body) }, { signal: request.signal }).catch(error => { request.signal.throwIfAborted(); throw error; });
    request.signal.throwIfAborted();
    const bytes = Uint8Array.from(atob(result.body), c => c.charCodeAt(0));
    return new Response(request.method === "HEAD" || [204, 205, 304].includes(result.status) ? null : bytes, { status: result.status, headers: result.headers });
}

const instance = originalAxios.create({ adapter: async config => {
    const url = originalAxios.getUri(config);
    if (!url.startsWith(本地转发前缀())) return originalAxios.getAdapter(originalAxios.defaults.adapter)(config);
    const headers = AxiosHeaders.from(config.headers).toJSON() as Record<string, string>;
    if (config.data instanceof FormData) { delete headers["Content-Type"]; delete headers["content-type"]; }
    const controller = new AbortController();
    const abort = () => controller.abort(); config.signal?.addEventListener?.("abort", abort);
    const timer = config.timeout ? setTimeout(abort, config.timeout) : undefined;
    try {
        if (config.signal?.aborted) controller.abort();
        const raw = await 本地转发请求(url, { method: config.method?.toUpperCase(), headers, body: config.data, signal: controller.signal });
        const data = config.responseType === "blob" ? await raw.blob() : config.responseType === "arraybuffer" ? await raw.arrayBuffer() : await raw.text();
        const response = { data, status: raw.status, statusText: raw.statusText, headers: AxiosHeaders.from(Object.fromEntries(raw.headers)), config };
        if (config.validateStatus && !config.validateStatus(raw.status)) throw new AxiosError("本地转发返回HTTP " + raw.status, raw.status >= 500 ? AxiosError.ERR_BAD_RESPONSE : AxiosError.ERR_BAD_REQUEST, config, undefined, response);
        return response;
    } catch (error) {
        if (controller.signal.aborted) {
            const canceled = new CanceledError("请求已取消，未自动重发");
            canceled.config = config;
            throw canceled;
        }
        throw error;
    }
    finally { clearTimeout(timer); config.signal?.removeEventListener?.("abort", abort); }
} });
export const 本地转发Axios = Object.assign(instance, { isCancel: originalAxios.isCancel, isAxiosError: originalAxios.isAxiosError });
