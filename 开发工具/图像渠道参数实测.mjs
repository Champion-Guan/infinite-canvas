import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { createMacOSMasterKeyProvider } from '../扩展功能/本机凭据/钥匙串主密钥.mjs';
import { openSQLiteCredentialVault } from '../扩展功能/本机凭据/SQLite凭据保管.mjs';
import { 核验稳定助手 } from './日常助手部署.mjs';
import { requestProviderBytes } from '../扩展功能/生成网关/受限上游传输.mjs';
import { createCanvas, loadImage } from '@napi-rs/canvas';

// 仅在用户明确授权真实渠道参数实测时运行；密钥只在内存使用，不进入结果文件。
const root = resolve(import.meta.dirname, '..');
const channelName = process.argv.find(arg => arg.startsWith('--channel='))?.slice(10) || 'hicode生图';
const channelEndpoints = { hicode生图: 'https://api-cn.hi-code.cc', 不吃坤肉: 'https://api.kunrouai.com' };
if (!Object.hasOwn(channelEndpoints, channelName)) throw Error('未列入本次授权的渠道');
const isKunrou = channelName === '不吃坤肉';
const output = join(root, '开发文档', isKunrou ? '不吃坤肉图像参数实测20261116' : '图像渠道参数实测20261116');
mkdirSync(output, { recursive: true });
const supplemental = process.argv.includes('--supplemental');
const reportPath = join(output, supplemental ? '补充测试结果.json' : '测试结果.json');
const report = existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, 'utf8')) : { channel: channelName, endpoint: channelEndpoints[channelName], tests: [] };
if (report.channel !== channelName) throw Error('不能混用不同渠道的测试结果');
const db = new DatabaseSync(join(process.env.HOME, 'Library/Application Support/AI-Workbench-重建版/工作区/工作台.sqlite'), { readOnly: true });
const workspaceId = db.prepare("SELECT value FROM workspace WHERE key='id'").get().value;
const workspace = {
  workspaceId,
  readDocument(collection, id) {
    const row = db.prepare('SELECT * FROM documents WHERE collection=? AND id=?').get(collection, id);
    return row ? { workspaceId, collection, id, revision: row.revision, value: JSON.parse(row.body), mediaIds: [] } : null;
  },
  writeDocument() { throw Error('实测禁止修改原数据库'); },
  listDocuments(collection) { return db.prepare('SELECT id FROM documents WHERE collection=?').all(collection); },
};
const decode = value => !Array.isArray(value) ? value : value[0] === 'object'
  ? Object.fromEntries(value[1].map(([key, item]) => [key, decode(item)]))
  : value[0] === 'array' ? value[1].map(decode) : value[1];
let channel;
for (const { body } of db.prepare("SELECT body FROM documents WHERE collection='extension' AND instr(body,?)>0").all(channelName)) {
  for (const [, entry] of JSON.parse(body).entries || []) {
    const walk = value => {
      if (!value || typeof value !== 'object') return;
      if (value.name === channelName && value.baseUrl === channelEndpoints[channelName]) channel = value;
      for (const item of Object.values(value)) if (item && typeof item === 'object') walk(item);
    };
    walk(decode(entry.tree));
  }
}
if (!channel) throw Error('没有找到指定渠道，未发送请求');
const binding = workspace.readDocument('extension', channel.apiKey);
if (!binding || binding.value.endpoint !== channel.baseUrl) throw Error('渠道绑定不符');
const baseline = { manifest: JSON.parse(readFileSync(join(root, '.运行/SQLite日常准备-UWriM2/准备清单.json'))) };
const helper = 核验稳定助手(baseline);
const vault = await openSQLiteCredentialVault({ workspace, keyProvider: createMacOSMasterKeyProvider({
  helperPath: helper.helperPath, helperSHA256: baseline.manifest.helper.sha256,
}) });
const secretRef = Object.values(binding.value).find(value => typeof value === 'string' && value.startsWith('secret:'));
let credential = await vault.read(secretRef);
const save = () => writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
const prompt = 'A simple red ceramic mug centered on a plain white background, studio product photograph. No text.';
const primaryModel = isKunrou ? 'gpt-image-2.6-sunburst-4k' : 'gpt-image-2.6-sunburst';
const base = { model: primaryModel, prompt, size: '1024x1024', quality: 'low', n: 1, output_format: 'png', moderation: 'auto' };
report.primaryModel = primaryModel;
const cases = [
  ...channel.models.map(item => ({ id: '模型-' + item.name, params: { model: item.name } })),
  ...['auto', '1152x1536', '1536x2048', '2480x3312', '2448x3264', '2400x3200', '1800x2400', '800x500', '1000x1333', '1536x1024', '2048x1152', '1024x1536'].map(size => ({ id: '尺寸-' + size, params: { size } })),
  ...['auto', 'medium', 'high', 'xhigh', 'max'].map(quality => ({ id: '质量-' + quality, params: { quality } })),
  ...['transparent', 'opaque', 'auto'].map(background => ({ id: '背景-' + background, params: { background } })),
  { id: '审核-low', params: { moderation: 'low' } },
  ...['jpeg', 'webp'].map(output_format => ({ id: '格式-' + output_format, params: { output_format } })),
  ...[0, 50, 100].map(output_compression => ({ id: '压缩-' + output_compression, params: { output_format: 'jpeg', output_compression } })),
  { id: '张数-2', params: { n: 2 } },
  { id: '响应格式-b64_json', params: { response_format: 'b64_json' } },
  { id: '响应格式-url', params: { response_format: 'url' } },
  { id: '用户标识', params: { user: 'workbench-parameter-test' } },
  { id: '流式-0', params: { stream: true, partial_images: 0 } },
  { id: '流式-1', params: { stream: true, partial_images: 1 } },
  ...['low', 'high'].map(input_fidelity => ({ id: '编辑保真-' + input_fidelity, edit: true, params: { input_fidelity } })),
  { id: '编辑尺寸-1800x2400', edit: true, params: { size: '1800x2400', input_fidelity: 'high' } },
  { id: '编辑遮罩', edit: true, mask: true, params: { input_fidelity: 'high' } },
  { id: '压缩-webp-50', params: { output_format: 'webp', output_compression: 50 } },
  { id: '透明-webp', params: { output_format: 'webp', background: 'transparent' } },
  { id: '透明-jpeg', params: { output_format: 'jpeg', background: 'transparent' } },
  { id: '编辑背景透明', edit: true, params: { background: 'transparent' } },
  { id: '尺寸质量-max-2480x3312', params: { size: '2480x3312', quality: 'max' } },
  { id: '尺寸质量-high-2480x3312', params: { size: '2480x3312', quality: 'high' } },
  { id: '省略可选参数', params: { size: undefined, quality: undefined, output_format: undefined, moderation: undefined } },
  ...channel.models.filter(item => item.name !== base.model).map(item => ({
    id: '跨模型自定义-' + item.name, params: { model: item.name, size: '1800x2400' },
  })),
  ...['1824x2432', '1024x640', '1008x1344'].map(size => ({ id: '适配请求-' + size, params: { size } })),
  { id: '编辑遮罩独立', edit: true, mask: true, params: {} },
  { id: '编辑合法适配尺寸', edit: true, params: { size: '1824x2432' } },
  { id: '编辑保真2.5-high', edit: true, params: { model: isKunrou ? 'gpt-image-2.5-sunburst-4k' : 'gpt-image-2.5-sunburst', input_fidelity: 'high' } },
  ...(isKunrou ? [
    ...['gpt-image-2.6-sunburst-1k', 'gpt-image-2.6-4k', 'gpt-image-2.6-flare-4k'].map(model => ({
      id: '跨型号大图-' + model, params: { model, size: '2480x3312' },
    })),
    { id: '编辑原问题尺寸', edit: true, params: { size: '2480x3312', quality: 'max' } },
    { id: '1k精确竖图', params: { model: 'gpt-image-2.6-sunburst-1k', size: '1086x1448' } },
  ] : []),
];
const extraIds = new Set(['压缩-webp-50', '透明-webp', '透明-jpeg', '编辑背景透明', '尺寸质量-max-2480x3312',
  '尺寸质量-high-2480x3312', '省略可选参数', ...channel.models.filter(item => item.name !== base.model).map(item => '跨模型自定义-' + item.name),
  ...['1824x2432', '1024x640', '1008x1344'].map(size => '适配请求-' + size), '编辑遮罩独立', '编辑合法适配尺寸', '编辑保真2.5-high',
  ...['gpt-image-2.6-sunburst-1k', 'gpt-image-2.6-4k', 'gpt-image-2.6-flare-4k'].map(model => '跨型号大图-' + model), '编辑原问题尺寸', '1k精确竖图']);
async function send(path, bytes, contentType, method = 'POST') {
  return requestProviderBytes({ url: new URL(path, channel.baseUrl), method, bytes,
    headers: { authorization: 'Bearer ' + credential, accept: '*/*', 'accept-encoding': 'identity', ...(contentType ? { 'content-type': contentType } : {}) },
    timeout: 180000 });
}
async function inspectImage(bytes, id, index, suppliedType) {
  const image = await loadImage(bytes);
  const canvas = createCanvas(image.width, image.height), context = canvas.getContext('2d');
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, image.width, image.height).data;
  let transparent = 0;
  for (let i = 3; i < pixels.length; i += 4) if (pixels[i] < 255) transparent++;
  const type = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'png'
    : bytes[0] === 255 && bytes[1] === 216 ? 'jpeg' : bytes.subarray(8, 12).toString() === 'WEBP' ? 'webp' : 'unknown';
  const file = `${id}-${index}.${type === 'jpeg' ? 'jpg' : type}`;
  writeFileSync(join(output, file), bytes);
  return { width: image.width, height: image.height, bytes: bytes.length, type, transparentPixels: transparent,
    sha256: createHash('sha256').update(bytes).digest('hex'), file, ...(suppliedType ? { suppliedType } : {}) };
}
async function readReturnedImage(value) {
  if (value.startsWith('data:image/')) return Buffer.from(value.slice(value.indexOf(',') + 1), 'base64');
  let url = new URL(value);
  for (let hop = 0; hop < 4; hop++) {
    if (url.protocol !== 'https:' || url.username || url.password) throw Error('图片下载地址不符合受限传输要求');
    const response = await requestProviderBytes({ url, method: 'GET', bytes: Buffer.alloc(0),
      headers: { accept: 'image/*', 'accept-encoding': 'identity' }, timeout: 120000, allowImageRedirect: true });
    if (response.redirectLocation) { url = new URL(response.redirectLocation, url); continue; }
    if (response.status !== 200) throw Error('返回图片下载失败，HTTP ' + response.status);
    return response.bytes;
  }
  throw Error('返回图片跳转次数超出限制');
}
try {
  if (process.argv.includes('--models')) {
    const response = await send('/v1/models', Buffer.alloc(0), null, 'GET');
    let data; try { data = JSON.parse(response.bytes); } catch {}
    report.models = { status: response.status, names: data?.data?.map(item => item.id), error: data?.error?.message };
    save(); console.log(JSON.stringify(report.models));
  } else {
    const selected = process.argv.find(arg => arg.startsWith('--only='))?.slice(7);
    for (const item of cases) {
      if (supplemental !== extraIds.has(item.id)) continue;
      if (selected && !item.id.includes(selected)) continue;
      if (report.tests.some(test => test.id === item.id)) continue;
      const params = { ...base, ...item.params }, started = Date.now();
      const result = { id: item.id, startedAt: new Date().toISOString(), interface: item.edit ? 'edits' : 'generations', request: params };
      console.log('开始 ' + item.id);
      try {
        let bytes, contentType;
        if (item.edit) {
          const referenceReport = supplemental ? JSON.parse(readFileSync(join(output, '测试结果.json'), 'utf8')) : report;
          const reference = referenceReport.tests.flatMap(test => test.images || []).find(image => image.type === 'png');
          if (!reference) throw Error('编辑实测需要前面的成功参考图');
          const form = new FormData();
          for (const [key, value] of Object.entries(params)) if (value !== undefined) form.set(key, String(value));
          form.set('image', new File([readFileSync(join(output, reference.file))], 'reference.png', { type: 'image/png' }));
          if (item.mask) {
            const mask = createCanvas(reference.width, reference.height);
            const context = mask.getContext('2d'); context.fillStyle = '#000'; context.fillRect(0, 0, mask.width, mask.height);
            context.clearRect(mask.width / 4, mask.height / 4, mask.width / 2, mask.height / 2);
            form.set('mask', new File([mask.toBuffer('image/png')], 'mask.png', { type: 'image/png' }));
          }
          const request = new Request('https://encoding.invalid', { method: 'POST', body: form });
          bytes = Buffer.from(await request.arrayBuffer()); contentType = request.headers.get('content-type');
        } else { bytes = Buffer.from(JSON.stringify(params)); contentType = 'application/json'; }
        result.wireSHA256 = createHash('sha256').update(bytes).digest('hex');
        const response = await send('/v1/images/' + result.interface, bytes, contentType);
        result.status = response.status; result.contentType = response.contentType; result.responseBytes = response.bytes.length;
        let data;
        if (response.contentType.includes('text/event-stream')) {
          const events = response.bytes.toString().split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => {
            try { return JSON.parse(line.slice(5)); } catch { return null; }
          }).filter(Boolean);
          result.events = events.map(event => ({ type: event.type, partial_image_index: event.partial_image_index }));
          const final = events.filter(event => /completed/.test(event.type)).at(-1);
          data = final ? { data: [{ b64_json: final.b64_json || final.result }], usage: final.usage } : { error: events.find(event => event.error)?.error };
        } else { try { data = JSON.parse(response.bytes); } catch { result.error = response.bytes.toString().slice(0, 600); } }
        result.error = data?.error || result.error;
        result.usage = data?.usage;
        result.responseMetadata = data ? Object.fromEntries(['size', 'quality', 'background', 'output_format'].filter(key => typeof data[key] === 'string').map(key => [key, data[key]])) : undefined;
        result.responseFields = data ? Object.keys(data) : [];
        result.images = [];
        for (const [index, image] of (data?.data || []).entries()) {
          if (image.b64_json) result.images.push(await inspectImage(Buffer.from(image.b64_json, 'base64'), item.id, index, image.mime_type));
          else if (image.url) result.images.push({ ...(await inspectImage(await readReturnedImage(image.url), item.id, index, image.mime_type)), delivery: 'url' });
        }
      } catch (error) { result.error = { code: error.code || 'test_error', message: String(error.message).replaceAll(credential, '[redacted]') }; }
      result.durationMs = Date.now() - started;
      report.tests.push(result); save();
      console.log(JSON.stringify({ id: result.id, status: result.status, images: result.images?.map(({ width, height, type, bytes, transparentPixels }) => ({ width, height, type, bytes, transparentPixels })), error: result.error, durationMs: result.durationMs }));
      // 传输结果未确认时不自动重发，也不继续扩大未知费用。
      if (result.error?.code === 'provider_connection_lost') break;
    }
  }
} finally {
  credential = ''; vault.close(); db.close();
}
