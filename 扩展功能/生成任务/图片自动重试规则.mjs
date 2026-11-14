export const IMAGE_RETRY_INTERVAL = 5000;
export const IMAGE_AUTO_RETRY_LIMIT = 3;

function failureDetails(result) {
  if (!(result?.bytes instanceof Uint8Array) || !result.bytes.length || result.bytes.length > 64 * 1024) return null;
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(result.bytes); } catch { return null; }
  let payload;
  try { payload = JSON.parse(text); } catch { /* 部分中转直接返回错误文本。 */ }
  // 仅识别错误信封，不把成功图片正文、模型输出或附带提示词里的关键词当作错误。
  const record = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : null;
  const explicit = record?.error;
  const error = explicit && typeof explicit === 'object' ? explicit : record;
  const message = typeof explicit === 'string' ? explicit :
    [error?.message, error?.msg, error?.detail, record?.message, record?.msg].find(value => typeof value === 'string') || text;
  const code = [error?.status_code, error?.status, error?.code, record?.status_code,
    message.match(/\bstatus_code\s*[=:]\s*([45]\d\d)\b/i)?.[1]].map(Number).find(value => Number.isInteger(value) && value >= 400 && value <= 599);
  const hasResult = Array.isArray(record?.data) && record.data.length > 0 || Array.isArray(record?.candidates) && record.candidates.length > 0 ||
    Array.isArray(record?.output) && record.output.length > 0;
  return { text: `${error?.type || ''} ${error?.code || ''} ${message}`, code,
    explicitFailure: !hasResult && (Boolean(explicit) || Boolean(code)) };
}

// HTTP 200 中的明确错误信封也按失败保存；不改写响应正文或将成功图片误判为失败。
export function normalizeImageFailureResponse(result) {
  if (result?.status < 200 || result?.status >= 300) return result;
  const details = failureDetails(result);
  return details?.explicitFailure ? { ...result, status: details.code || 400 } : result;
}

// 只有已完整返回的临时故障才允许重新生成；连接异常、取消和结果保存失败不在此处重试。
export function canRetryImageResponse(result) {
  if (result?.status < 400) return false;
  const details = failureDetails(result);
  if (!details) return false;
  const text = details.text;
  if (/insufficient[_\s-]*(?:quota|balance|credits)|invalid[_\s-]*(?:api[_\s-]*key|parameter|size)|billing[_\s-]*hard[_\s-]*limit|content[_\s-]*policy|safety[_\s-]*violation|policy[_\s-]*violation|余额不足|额度不足|密钥无效|鉴权失败|未授权|图片数量过多|最多只能上传|尺寸不合法|内容违规|提示词违规|敏感内容|审核不通过/i.test(text)) return false;
  if ([401, 403, 404, 413, 422, 429].includes(result.status)) return false;
  return [500, 502, 503, 504].includes(details.code || result.status) ||
    /服务暂时繁忙|服务暂时不可用|服务暂时繁忙或不可用|图片服务.{0,12}(?:繁忙|不可用)|暂时波动|稍后(?:再)?重试|请稍后再试|server[_\s-]*(?:busy|overloaded)|temporarily[_\s-]*(?:unavailable|overloaded)|service[_\s-]*unavailable/i.test(text);
}

export function waitImageRetry(milliseconds, signal) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const finish = error => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (error) reject(error); else resolve();
    };
    const abort = () => finish(signal.reason || new DOMException('已取消', 'AbortError'));
    const timer = setTimeout(() => finish(), milliseconds);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

export async function runSingleImageRetry({ execute, record, signal, wait = waitImageRetry, now = Date.now }) {
  const maximum = IMAGE_AUTO_RETRY_LIMIT;
  for (let attempt = 0; attempt <= maximum; attempt++) {
    signal?.throwIfAborted();
    await record({ attempt, maxRetries: maximum, phase: 'requesting', nextRetryAt: null });
    signal?.throwIfAborted();
    const result = normalizeImageFailureResponse(await execute());
    if (signal?.aborted || attempt === maximum || !canRetryImageResponse(result)) return result;
    await record({ attempt, maxRetries: maximum, phase: 'waiting', nextRetryAt: now() + IMAGE_RETRY_INTERVAL }, result);
    // 在已确认失败后的等待期停止，交回最后一次真实错误，不丢弃它或再发请求。
    try { await wait(IMAGE_RETRY_INTERVAL, signal); }
    catch (error) { if (signal?.aborted) return result; throw error; }
    if (signal?.aborted) return result;
  }
}
