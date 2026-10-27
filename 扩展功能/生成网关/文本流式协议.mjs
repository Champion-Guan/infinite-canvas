import { requireValue } from '../本机存储/协议.mjs';

export const MAX_TEXT_BYTES = 1024 * 1024;
const invalid = () => requireValue(false, 'provider_text_stream_invalid', '文本流尚未完整确认，原任务保留，不会重新生成。', 502);
export function textStreamKind(request) {
  if (request.method !== 'POST' || request.contentType !== 'application/json') return null;
  if (/^\/v1(?:beta)?\/models\/[\w.:-]+:streamGenerateContent\?alt=sse$/.test(request.path)) return 'gemini';
  if (!['/v1/responses', '/v1/chat/completions'].includes(request.path)) return null;
  try { return JSON.parse(Buffer.from(request.body, 'base64')).stream === true ? request.path.endsWith('/responses') ? 'responses' : 'chat' : null; }
  catch { return null; }
}
export const credentialVariants = value => [...new Set([value, encodeURIComponent(value), JSON.stringify(value).slice(1, -1), Buffer.from(value).toString('base64')])].sort((a, b) => b.length - a.length);
export function redactText(text, variants) {
  for (const value of variants) text = text.split(value).join('[credential-redacted]');
  return text;
}

// 只保留可能构成凭据的尾部；跨网络chunk、跨SSE事件的文字都不能提前漏出。
function incrementalRedactor(variants) {
  let pending = '';
  return (text, final = false) => {
    pending += text; let output = '';
    while (pending) {
      let at = -1, matched;
      for (const value of variants) { const index = pending.indexOf(value); if (index !== -1 && (at === -1 || index < at)) { at = index; matched = value; } }
      if (at !== -1) { output += pending.slice(0, at) + '[credential-redacted]'; pending = pending.slice(at + matched.length); continue; }
      let keep = 0;
      if (!final) for (const value of variants) for (let size = Math.min(value.length - 1, pending.length); size > keep; size--) {
        if (pending.endsWith(value.slice(0, size))) { keep = size; break; }
      }
      output += pending.slice(0, pending.length - keep); pending = pending.slice(pending.length - keep); break;
    }
    return output;
  };
}
function responseText(response) {
  if (typeof response?.output_text === 'string') return response.output_text;
  return response?.output?.filter(item => item.type === 'message').flatMap(item => item.content || []).map(item => item.type === 'output_text' ? item.text || '' : '').join('') || '';
}

// 原始SSE仅在后端解析，页面只能观察已消毒的文字；最终仍保存普通JSON结果及原任务收据。
export function createProviderTextStream({ kind, credential, onProgress = () => {} }) {
  const variants = credentialVariants(credential), mask = incrementalRedactor(variants), decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = '', lines = [], event = '', rawText = '', visible = '', finalText, total = 0, completed = false, received = false, ended = false;
  const append = text => {
    if (typeof text !== 'string' || completed) invalid();
    total += Buffer.byteLength(text); if (total > MAX_TEXT_BYTES) invalid();
    rawText += text; const safe = mask(text); if (safe) { visible += safe; onProgress(visible); }
  };
  function dispatch() {
    if (!lines.length) { event = ''; return; }
    const data = lines.join('\n'), name = event; lines = []; event = '';
    if (data === '[DONE]') { if (completed) return; invalid(); }
    let value; try { value = JSON.parse(data); } catch { invalid(); }
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.error || name === 'error') invalid();
    if (kind === 'responses') {
      const type = value.type || name;
      if (type === 'response.output_text.delta') append(value.delta);
      else if (type === 'response.completed') {
        if (completed || !value.response || value.response.status && value.response.status !== 'completed') invalid();
        finalText = responseText(value.response) || rawText; completed = true;
      } else if (['response.failed', 'response.incomplete', 'error'].includes(type)) invalid();
    } else if (kind === 'chat') {
      const choice = value.choices?.find(item => item.index === 0) || value.choices?.[0];
      if (choice?.delta?.content) append(choice.delta.content);
      if (choice?.finish_reason) { if (!['stop', 'length'].includes(choice.finish_reason)) invalid(); completed = true; }
    } else {
      if (value.promptFeedback?.blockReason) invalid();
      const choice = value.candidates?.find(item => item.index === 0) || value.candidates?.[0];
      const text = choice?.content?.parts?.filter(part => !part.thought).map(part => typeof part.text === 'string' ? part.text : '').join('');
      if (text) append(text);
      if (choice?.finishReason) { if (!['STOP', 'MAX_TOKENS'].includes(choice.finishReason)) invalid(); completed = true; }
    }
  }
  function parse(text) {
    buffer += text; if (Buffer.byteLength(buffer) > MAX_TEXT_BYTES * 2) invalid();
    let end;
    while ((end = buffer.search(/[\r\n]/)) !== -1) {
      if (buffer[end] === '\r' && end === buffer.length - 1) break;
      const line = buffer.slice(0, end), size = buffer[end] === '\r' && buffer[end + 1] === '\n' ? 2 : 1;
      buffer = buffer.slice(end + size);
      if (!line) dispatch();
      else if (line.startsWith('data:')) lines.push(line.slice(5).replace(/^ /, ''));
      else if (line.startsWith('event:')) event = line.slice(6).trim();
      if (lines.reduce((sum, item) => sum + item.length, 0) > MAX_TEXT_BYTES * 2) invalid();
    }
  }
  return {
    push(bytes) { if (ended) invalid(); received = true; parse(decoder.decode(bytes, { stream: true })); },
    finish(bytes) {
      if (!received) parse(decoder.decode(bytes)); else parse(decoder.decode());
      if (buffer) { parse('\n\n'); } else dispatch();
      ended = true; if (!completed) invalid();
      const text = finalText === undefined ? visible + mask('', true) : redactText(finalText, variants);
      if (!text.trim() || Buffer.byteLength(text) > MAX_TEXT_BYTES) invalid();
      if (text !== visible) { visible = text; onProgress(text); }
      return Buffer.from(JSON.stringify({ output_text: text }));
    },
  };
}
