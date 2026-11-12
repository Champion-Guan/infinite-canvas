import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { runCanvasImageTask, imageRequestHash } from '../扩展功能/画布生成/图片任务衔接.mjs';
import { createCanvasCheckpointReader } from '../扩展功能/画布生成/画布检查点.mjs';
import { createGenerationClient } from '../扩展功能/生成任务/生成任务客户端.mjs';
import { createValueCodec } from '../扩展功能/本机存储/应用值编码.mjs';
import { GENERATION_PROTOCOL } from '../扩展功能/生成网关/生成协议.mjs';
import { createGenerationHTTPHandler } from '../扩展功能/生成网关/生成HTTP入口.mjs';
import { StorageError } from '../扩展功能/本机存储/协议.mjs';
import { bindChannelConfiguration } from '../扩展功能/本机凭据/页面凭据引用.mjs';
import { ts } from './检查首批功能适配.mjs';
import { 构建原版图片协议, 图片原来源 } from './构建原版图片协议.mjs';
import { 根目录 } from './公共.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const binding = 'provider:' + 'a'.repeat(64);
const request = { method: 'POST', path: '/v1/images/generations', contentType: 'application/json', body: 'e30=' };
const code = expected => error => error?.code === expected;
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function fixture() {
  const jobs = new Map(), records = [], commands = [], events = [];
  let saved = false;
  const bytes = Buffer.from('{"data":[{"b64_json":"aXNvbGF0ZWQ="}]}');
  const response = { id: hash(bytes), size: bytes.length, status: 200, contentType: 'application/json' };
  async function command(value) {
    commands.push(structuredClone(value)); events.push(value.operation);
    let result, job = jobs.get(value.id || value.task?.id);
    if (value.operation === 'submit') { job = { ...value.task, state: 'succeeded', applied: false, reason: '', result: response }; jobs.set(job.id, job); result = job; }
    else if (value.operation === 'get') { if (!job) throw new StorageError('generation_not_found', '合成任务缺失', 404); result = job; }
    else if (value.operation === 'result') result = { ...job, bytes: bytes.toString('base64') };
    else if (value.operation === 'applied') { assert.ok(saved); job.applied = true; result = job; }
    else if (value.operation === 'cancel') result = job;
    else if (value.operation === 'checkpoint') { assert.ok(saved); result = { rootRevision: 1, rootHash: 'b'.repeat(64) }; }
    else if (value.operation === 'retry-save') { job.state = 'succeeded'; result = job; }
    else throw Error('意外操作');
    return { protocol: GENERATION_PROTOCOL, result: structuredClone(result) };
  }
  const client = createGenerationClient({ command });
  const host = { ...client, checkpoint: async id => (await command({ operation: 'checkpoint', id })).result };
  const options = { host, scope: { productId: 'product-A', nodeId: 'node-A', slotId: 'image-A' },
    prepare: async () => structuredClone(request), bind: async () => binding,
    recordTask: async value => { events.push('record'); records.push(structuredClone(value)); },
    applyAndSave: async (job, receipt) => { assert.equal(job.productId, 'product-A'); assert.equal(receipt.responseHash, hash(bytes)); events.push('save'); saved = true; },
    wait: async () => {},
  };
  return { options, commands, records, events, jobs, response, resetSave() { saved = false; }, markSaved() { saved = true; } };
}
test('先保存任务身份再提交，原产品结果保存之后才读取检查点和确认完成', async () => {
  const f = fixture(), result = await runCanvasImageTask(f.options);
  assert.equal(result.applied, true); assert.equal(f.records.length, 1);
  assert.deepEqual(f.events, ['record', 'submit', 'result', 'save', 'checkpoint', 'applied']);
  assert.equal(f.commands.find(item => item.operation === 'submit').task.id, f.records[0].taskId);
});
test('批量结果保存被整批延后时工作线程先退出，最终画布ACK后沿用原任务确认', async () => {
  const f = fixture();
  const result = await runCanvasImageTask({ ...f.options, deferConfirm: () => true });
  assert.equal(result.applied, false, '工作线程不能把延后保存冒充为已经持久化');
  assert.deepEqual(f.events, ['record', 'submit', 'result', 'save']);
  assert.equal(f.commands.filter(item => item.operation === 'checkpoint' || item.operation === 'applied').length, 0);

  // The simulated final canvas save is the single batch save; no task is submitted again.
  f.markSaved();
  const confirmed = await f.options.host.confirmSaved(
    { id: f.records[0].taskId, productId: 'product-A', nodeId: 'node-A' },
    { responseHash: f.response.id },
  );
  assert.equal(confirmed.applied, true);
  assert.equal(f.commands.filter(item => item.operation === 'submit').length, 1);
  assert.equal(f.commands.filter(item => item.operation === 'checkpoint').length, 1);
});
test('应用失败后保留成功响应；重新交付不重新准备、绑定或提交收费请求', async () => {
  const f = fixture();
  await assert.rejects(runCanvasImageTask({ ...f.options, applyAndSave: async () => { throw Error('合成磁盘满'); } }));
  const id = f.records[0].taskId; assert.equal(f.jobs.get(id).applied, false);
  await runCanvasImageTask({ ...f.options, previous: f.records[0], retry: true,
    prepare: async () => assert.fail('不可重建请求'), bind: async () => assert.fail('不可重新绑定') });
  assert.equal(f.jobs.get(id).applied, true); assert.equal(f.commands.filter(item => item.operation === 'submit').length, 1);
});
test('同一图片同时点击被门禁拦截，不重复提交', async () => {
  const f = fixture(), gate = deferred();
  const flight = runCanvasImageTask({ ...f.options, prepare: () => gate.promise });
  await assert.rejects(runCanvasImageTask(f.options), code('generation_slot_busy'));
  await assert.rejects(runCanvasImageTask({ ...f.options, scope: { slotId: 'image-A', nodeId: 'node-A', productId: 'product-A' } }), code('generation_slot_busy'));
  gate.resolve(request); await flight;
  assert.equal(f.commands.filter(item => item.operation === 'submit').length, 1);
});
test('多张结果并行生成，但同产品保存回调串行', async () => {
  const f = fixture(); let active = 0, maximum = 0;
  await Promise.all(['image-1', 'image-2', 'image-3'].map(slotId => runCanvasImageTask({ ...f.options,
    scope: { ...f.options.scope, slotId }, applyAndSave: async (...args) => {
      active++; maximum = Math.max(active, maximum); await Promise.resolve(); await f.options.applyAndSave(...args); active--;
    } })));
  assert.equal(maximum, 1); assert.equal(f.commands.filter(item => item.operation === 'submit').length, 3);
});
test('保存任务身份失败时不会发送生成请求', async () => {
  const f = fixture(); await assert.rejects(runCanvasImageTask({ ...f.options, recordTask: async () => { throw Error('保存未确认'); } }));
  assert.equal(f.commands.length, 0);
});
test('记录身份期间取消，不提交收费请求', async () => {
  const f = fixture(), controller = new AbortController();
  await assert.rejects(runCanvasImageTask({ ...f.options, signal: controller.signal,
    recordTask: async value => { await f.options.recordTask(value); controller.abort(); } }), error => error.name === 'AbortError');
  assert.equal(f.commands.filter(item => item.operation === 'submit').length, 0);
});
test('已保存身份但未到达后端，按同ID同请求安全补交', async () => {
  const f = fixture(), id = randomUUID(), previous = { taskId: id, slotId: 'image-A', binding, requestHash: await imageRequestHash(request) };
  await runCanvasImageTask({ ...f.options, previous, bind: async () => assert.fail('不重绑') });
  assert.equal(f.commands.find(item => item.operation === 'submit').task.id, id); assert.equal(f.records.length, 0);
});
test('未决身份的请求改变时拒绝补交，不拿新提示词覆盖原请求', async () => {
  const f = fixture(), previous = { taskId: randomUUID(), slotId: 'image-A', binding, requestHash: 'c'.repeat(64) };
  await assert.rejects(runCanvasImageTask({ ...f.options, previous }), code('generation_request_changed'));
  assert.equal(f.commands.filter(item => item.operation === 'submit').length, 0);
});
test('提交ACK丢失后不自动重发；用保留ID查询成功结果', async () => {
  const f = fixture(); let lose = true;
  const host = { ...f.options.host, async submit(value) { const job = await f.options.host.submit(value); if (lose) { lose = false; throw Error('ACK丢失'); } return job; } };
  await assert.rejects(runCanvasImageTask({ ...f.options, host }));
  await runCanvasImageTask({ ...f.options, host, previous: f.records[0] });
  assert.equal(f.commands.filter(item => item.operation === 'submit').length, 1);
});
for (const [state, reason, expected] of [['uncertain', 'upstream_result_unknown', 'generation_result_unknown'], ['failed', '', 'generation_explicit_retry_required'], ['cancelled', '', 'generation_explicit_retry_required']]) {
  test(state + '不会自动生成新任务或切换渠道', async () => {
    const f = fixture(); await runCanvasImageTask(f.options); const previous = f.records[0];
    Object.assign(f.jobs.get(previous.taskId), { state, reason, applied: false }); const before = f.commands.length;
    await assert.rejects(runCanvasImageTask({ ...f.options, previous }), code(expected));
    assert.equal(f.commands.slice(before).filter(item => item.operation === 'submit').length, 0);
  });
}
test('本机响应保存未确认只重试结果保存，不请求上游', async () => {
  const f = fixture(); await runCanvasImageTask(f.options); const previous = f.records[0];
  Object.assign(f.jobs.get(previous.taskId), { state: 'uncertain', reason: 'result_save_unconfirmed', applied: false });
  await runCanvasImageTask({ ...f.options, previous });
  assert.equal(f.commands.filter(item => item.operation === 'retry-save').length, 1);
  assert.equal(f.commands.filter(item => item.operation === 'submit').length, 1);
});
test('已完成任务明确重试时才创建新ID', async () => {
  const f = fixture(); await runCanvasImageTask(f.options); const previous = f.records[0];
  await runCanvasImageTask({ ...f.options, previous, retry: true });
  assert.equal(f.records.length, 2); assert.notEqual(f.records[0].taskId, f.records[1].taskId);
});
test('正在运行任务只查询原ID，直到成功后交付', async () => {
  const f = fixture(); await runCanvasImageTask(f.options); const previous = f.records[0];
  Object.assign(f.jobs.get(previous.taskId), { state: 'running', applied: false });
  await runCanvasImageTask({ ...f.options, previous, wait: async () => { f.jobs.get(previous.taskId).state = 'succeeded'; } });
  assert.equal(f.commands.filter(item => item.operation === 'submit').length, 1);
});
test('跨产品或节点的结果被拒绝，不调用应用保存', async () => {
  const f = fixture(); await runCanvasImageTask(f.options); const previous = f.records[0];
  f.jobs.get(previous.taskId).productId = 'product-B';
  await assert.rejects(runCanvasImageTask({ ...f.options, previous, applyAndSave: async () => assert.fail('禁止写错产品') }), code('generation_scope_mismatch'));
});
test('未知任务状态被拒绝，不无限轮询', async () => {
  const f = fixture(); await runCanvasImageTask(f.options); const previous = f.records[0]; f.jobs.get(previous.taskId).state = 'invalid';
  await assert.rejects(runCanvasImageTask({ ...f.options, previous }), code('generation_scope_mismatch'));
});

async function savedCheckpointFixture(status = 'success', matching = true) {
  const job = { id: randomUUID(), productId: 'product-A', nodeId: 'node-A', state: 'succeeded', result: { id: 'd'.repeat(64) } };
  const codec = createValueCodec({ client: {} });
  const value = { state: { projects: [{ id: job.productId, nodes: [{ id: job.nodeId, metadata: { status,
    gatewayGenerationReceipts: [{ taskId: job.id, responseHash: matching ? job.result.id : 'e'.repeat(64) }] } }] }] } };
  const tree = await codec.encode(value);
  const root = { revision: 2, hash: 'f'.repeat(64), value: { format: 'guan-app-storage.v1', namespace: 'app_state', entries: [['infinite-canvas:canvas_store', tree]] } };
  return { job, root, read: createCanvasCheckpointReader({ workspace: { readDocument: () => root }, tasks: { get: () => job } }) };
}
test('检查点只返回真实已保存产品的根版本和摘要，不暴露画布及配置', async () => {
  const f = await savedCheckpointFixture(); assert.deepEqual(await f.read(f.job.id), { rootRevision: 2, rootHash: 'f'.repeat(64) });
});
for (const [status, matching] of [['loading', true], ['success', false]]) test('检查点拒绝未完成卡片或错误收据：' + status + matching, async () => {
  const f = await savedCheckpointFixture(status, matching); await assert.rejects(f.read(f.job.id), code('generation_canvas_unsaved'));
});

function commonContext() {
  const channel = { id: 'channel-A', name: '原渠道' };
  const t = (key, options = {}) => key === 'imageReferences.promptPrefix' ? `参考图:${options.labels};${options.prompt}` : key === 'imageReferences.label' ? `图${options.index}` : key === 'imageReferences.separator' ? ',' : key;
  return { console, URL, Request, Response, FormData, File, Blob, crypto, TextEncoder, TextDecoder, Uint8Array, atob, btoa, structuredClone,
    i18n: { t }, nanoid: () => 'synthetic-image',
    resolveModelRequestConfig: config => ({ ...config, model: config.model }), resolveModelChannel: () => channel, resolveModelScript: () => '',
    buildApiUrl: (url, path) => url.replace(/\/$/, '') + '/v1' + path,
    withLocalProxy: url => url, withoutLocalProxy: url => url,
    imageToDataUrl: async image => image.dataUrl,
    dataUrlToFile: image => new File([Buffer.from(image.dataUrl.split(',')[1], 'base64')], image.name || 'reference.png', { type: image.type || 'image/png' }),
    buildImageReferencePromptText: (prompt, refs) => refs.length ? `参考图:${refs.map((_, index) => `图${index + 1}`).join(',')};${prompt.trim()}` : prompt.trim(),
    observeActivity: (_kind, operation) => operation(),
  };
}
function evaluateTS(source, globals = commonContext(), extra = {}) {
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  const imports = {
    '@/i18n': { default: globals.i18n }, nanoid: { nanoid: globals.nanoid },
    '@/stores/use-config-store': globals, '@/lib/image-utils': globals, '@/lib/image-reference-prompt': globals, '@/services/image-storage': globals, ...extra,
  };
  vm.runInNewContext(compiled, { ...globals, exports: module.exports, module, require: id => { assert.ok(imports[id], '未授权导入：' + id); return imports[id]; } });
  return module.exports;
}
const prepared = evaluateTS(构建原版图片协议());
const baseConfig = { model: 'gpt-image-2', imageModel: 'gpt-image-2', apiFormat: 'openai', baseUrl: 'https://api.example.com', apiKey: 'synthetic-only-key',
  count: '1', quality: 'high', size: '1024x1024', systemPrompt: '系统提示', background: 'transparent', moderation: 'low' };
async function originalRequest(config, prompt, references) {
  const source = readFileSync(join(图片原来源, 'src/canvas/services/api/image.ts'), 'utf8');
  const file = ts.createSourceFile('old.ts', source, ts.ScriptTarget.Latest, true);
  const mediaSource = readFileSync(join(图片原来源, 'src/canvas/lib/media-size.ts'), 'utf8');
  const mediaFile = ts.createSourceFile('media.ts', mediaSource, ts.ScriptTarget.Latest, true);
  const media = mediaFile.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations[0].name.text === 'imageSizePresets').getText(mediaFile);
  const context = commonContext(), requests = [];
  context.imageSizePresets = evaluateTS(media).imageSizePresets;
  context.axios = { post: async (url, body) => { requests.push({ url, body }); return { data: config.apiFormat === 'gemini' ? { candidates: [{ content: { parts: [{ inlineData: { data: 'aXNvbGF0ZWQ=', mimeType: 'image/png' } }] } }] } : { data: [{ b64_json: 'aXNvbGF0ZWQ=' }] } }; } };
  const old = evaluateTS(file.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(file)).join('\n'), context);
  if (references.length) await old.requestEdit(config, prompt, references); else await old.requestGeneration(config, prompt);
  assert.equal(requests.length, 1); return requests[0];
}
const jsonBody = value => JSON.parse(Buffer.from(value.body, 'base64').toString());
for (const patch of [ {}, { model: 'dall-e-3', quality: 'xhigh', size: '512x512' }, { model: 'gpt-image-2.5-flare', quality: 'max', size: '16:9' }, { size: 'auto', background: '', moderation: 'auto' }, { apiFormat: 'gemini', model: 'gemini-3-pro-image', size: '2048x2048' }, { apiFormat: 'gemini', model: 'gemini-3-pro-image', baseUrl: 'https://api.example.com/v1' } ]) {
  test('原版真实请求对照：' + JSON.stringify(patch), async () => {
    const config = { ...baseConfig, ...patch }, expected = await originalRequest(config, '尺寸展示', []);
    const actual = await prepared.prepareOriginalImageRequest(config, '尺寸展示', []);
    assert.deepEqual(jsonBody(actual), JSON.parse(JSON.stringify(expected.body)));
    assert.equal(actual.path, new URL(expected.url).pathname);
    assert.ok(!Buffer.from(actual.body, 'base64').includes(Buffer.from(baseConfig.apiKey)));
  });
}
test('原版参考图编辑字段、二进制文件和稳定multipart身份一致', async () => {
  const refs = [{ id: 'ref-A', name: '产品.png', type: 'image/png', dataUrl: 'data:image/png;base64,aXNvbGF0ZWQ=' }];
  const old = await originalRequest(baseConfig, '材质展示', refs), actual = await prepared.prepareOriginalImageRequest(baseConfig, '材质展示', refs);
  const form = await new Response(Buffer.from(actual.body, 'base64'), { headers: { 'Content-Type': actual.contentType } }).formData();
  // 比较旧表单实际线上编码，原生multipart会将字段换行规范为CRLF。
  const oldForm = await new Request('http://encoding.invalid', { method: 'POST', body: old.body }).formData();
  for (const [name, value] of oldForm.entries()) {
    const next = form.get(name);
    if (typeof value === 'string') assert.equal(next, value);
    else { assert.equal(next.name, value.name); assert.deepEqual(Buffer.from(await next.arrayBuffer()), Buffer.from(await value.arrayBuffer())); }
  }
  assert.equal(actual.path, '/v1/images/edits');
  assert.deepEqual(await prepared.prepareOriginalImageRequest(baseConfig, '材质展示', refs), actual);
});
for (const field of ['data', 'images', 'results']) test('继承原版响应字段：' + field, () => {
  const result = prepared.parseOriginalImageResponse(baseConfig, Buffer.from(JSON.stringify({ [field]: [{ b64_json: 'aXNvbGF0ZWQ=' }] })).toString('base64'));
  assert.equal(result[0].dataUrl, 'data:image/png;base64,aXNvbGF0ZWQ='); assert.equal(result[0].deliverySize, '1024x1024');
});
test('继承Gemini inline_data与fileData解析，错误响应不冒充成功', () => {
  const config = { ...baseConfig, apiFormat: 'gemini' };
  const result = prepared.parseOriginalImageResponse(config, Buffer.from(JSON.stringify({ candidates: [{ content: { parts: [{ inline_data: { data: 'aXNvbGF0ZWQ=', mime_type: 'image/webp' } }] } }] })).toString('base64'));
  assert.equal(result[0].dataUrl, 'data:image/webp;base64,aXNvbGF0ZWQ=');
  assert.throws(() => prepared.parseOriginalImageResponse(config, Buffer.from('{"error":{"message":"合成错误"}}').toString('base64')), /合成错误/);
});
test('无效尺寸和超过允许上游比例的尺寸在提交前拒绝', async () => {
  for (const size of ['-1x200', 'hello', '4000x1']) await assert.rejects(prepared.prepareOriginalImageRequest({ ...baseConfig, size }, '测试', []));
});
test('多参考图保留image[]字段，Gemini参考图与原版请求一致', async () => {
  const refs = [1, 2].map(index => ({ id: 'ref-' + index, name: '产品' + index + '.png', type: 'image/png', dataUrl: 'data:image/png;base64,aXNvbGF0ZWQ=' }));
  const request = await prepared.prepareOriginalImageRequest(baseConfig, '测试', refs);
  const form = await new Response(Buffer.from(request.body, 'base64'), { headers: { 'Content-Type': request.contentType } }).formData();
  assert.equal(form.getAll('image[]').length, 2); assert.equal(form.get('image'), null);
  const config = { ...baseConfig, apiFormat: 'gemini', model: 'gemini-3-image' };
  assert.deepEqual(jsonBody(await prepared.prepareOriginalImageRequest(config, '测试', refs)),
    JSON.parse(JSON.stringify((await originalRequest(config, '测试', refs)).body)));
});
function canvasAdapter(host, onRun) {
  const source = readFileSync(join(根目录, '扩展功能/画布生成/原画布图片调用.ts'), 'utf8');
  const localHost = { bind: async () => ({ binding }), describe: async id => ({ binding: id, kind: 'openai', endpoint: baseConfig.baseUrl }),
    createPlan: async () => ({ binding }), ...host };
  return evaluateTS(source, { ...commonContext(), window: { __guanGenerationHost: localHost } }, {
    './原版图片协议': prepared,
    './图片任务衔接.mjs': { imageRequestHash, runCanvasImageTask: onRun },
    '../故障切换/图片路由请求': {
      prepareRoutedImageRequest: async (config, prompt, references, bind) => ({
        request: await prepared.prepareOriginalImageRequest(config, prompt, references),
        plan: { mode: 'single', capability: 'image', revision: 0, candidates: [{ binding: await bind(config) }] },
      }),
      parseRoutedImageResponse: (_config, bytes) => {
        const value = JSON.parse(Buffer.from(bytes, 'base64').toString('utf8'));
        const item = value.data?.[0] || value.results?.[0] || value.images?.[0] || {};
        return [{ dataUrl: item.url || String.fromCharCode(100,97,116,97,58,105,109,97,103,101,47,112,110,103,59,98,97,115,101,54,52,44) + (item.b64_json || item.b64 || '') }];
      },
    },
    '../生成网关/渠道绑定客户端': {
      bindConfiguredChannel: bindChannelConfiguration,
    },
    './参考图数量限制': evaluateTS(readFileSync(join(根目录, '扩展功能/画布生成/参考图数量限制.ts'), 'utf8')),
    '../产品配置/模型配置门禁': { requireModelConfigured() {} },
  });
}
test('画布适配器只向本机bind交付当前渠道，缓存不跨密钥/地址/协议复用', async () => {
  const profiles = [], host = { bind: async profile => { profiles.push(profile); return { binding }; } };
  const adapter = canvasAdapter(host, async value => { await value.prepare(); return value.bind(); });
  const options = { config: baseConfig, prompt: '测试', scope: { productId: 'A', nodeId: 'N', slotId: 'S' }, recordTask: async () => {}, applyAndSave: async () => {} };
  await adapter.requestCanvasImage(options); await adapter.requestCanvasImage(options);
  assert.equal(profiles.length, 1);
  for (const config of [{ ...baseConfig, apiKey: 'synthetic-other' }, { ...baseConfig, baseUrl: 'https://other.example.com' }, { ...baseConfig, apiFormat: 'gemini' }])
    await adapter.requestCanvasImage({ ...options, config });
  assert.equal(profiles.length, 4);
  assert.equal(profiles[0].value, baseConfig.apiKey); assert.equal(profiles[0].endpoint, baseConfig.baseUrl);
});
test('旧secret与旧代理引用不能作为API Key；已绑定渠道引用不能跨地址使用', async () => {
  const adapter = canvasAdapter({ bind: async () => assert.fail('不得绑定凭据引用'),
    describe: async id => ({ binding: id, kind: 'openai', endpoint: 'https://other.example.com' }) },
    async value => { await value.prepare(); return value.bind(); });
  for (const apiKey of ['secret:abc', binding, 'guan-vault:abc'])
    await assert.rejects(adapter.requestCanvasImage({ config: { ...baseConfig, apiKey }, prompt: '测试', scope: { productId: 'A', nodeId: 'N', slotId: 'S' }, recordTask: async () => {}, applyAndSave: async () => {} }), /旧凭据|渠道地址或协议已改变/);
});
test('适配器固定请求快照，外部修改配置不改变在途任务', async () => {
  let run;
  const gate = deferred(), adapter = canvasAdapter({}, async value => { run = value; await gate.promise; return value.prepare(); });
  const config = { ...baseConfig }, pending = adapter.requestCanvasImage({ config, prompt: '原提示词', scope: { productId: 'A', nodeId: 'N', slotId: 'S' }, recordTask: async () => {}, applyAndSave: async () => {} });
  config.model = 'new-model'; config.systemPrompt = '新系统'; gate.resolve(); await pending;
  assert.equal(jsonBody(await run.prepare()).model, baseConfig.model);
});
test('远程URL保留为未应用任务，不能绕过受限媒体接入假装已保存', async () => {
  const adapter = canvasAdapter({}, async value => value.applyAndSave({ bytes: Buffer.from('{"data":[{"url":"https://never-contact.invalid/image.png"}]}').toString('base64') }, {}));
  await assert.rejects(adapter.requestCanvasImage({ config: baseConfig, prompt: '测试', scope: { productId: 'A', nodeId: 'N', slotId: 'S' }, recordTask: async () => {}, applyAndSave: async () => assert.fail('不能保存网址') }), /远程图片地址/);
});

test('当前HTTP检查点复用页面授权，仅交付真实保存证明并拒绝跨站和额外字段', async () => {
  let calls = 0, authorized = 0;
  const origin = 'http://localhost:53291', checkpoint = { rootRevision: 7, rootHash: 'f'.repeat(64) };
  const handler = createGenerationHTTPHandler({ origin, gateway: { bind() {} }, tasks: { submit() {} },
    authorize(req) { authorized++; if (req.headers.authorization !== 'Bearer ' + 'synthetic-capability') throw new StorageError('authorization_denied', '合成拒绝', 401); },
    readCanvasCheckpoint: async () => { calls++; return checkpoint; },
  });
  async function invoke(headers = {}, value = { operation: 'checkpoint', id: randomUUID() }) {
    const request = { method: 'POST', url: '/__guan-local/generation', resume() {},
      headers: { host: new URL(origin).host, origin, authorization: 'Bearer ' + 'synthetic-capability', 'content-type': 'application/json', 'x-guan-generation-protocol': GENERATION_PROTOCOL, ...headers },
      async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(value)); } };
    const response = { destroyed: false, writableEnded: false, setHeader() {}, writeHead(status) { this.status = status; }, end(value) { this.value = JSON.parse(value); } };
    await handler(request, response); return response;
  }
  assert.equal((await invoke()).status, 200); assert.equal(calls, 1); assert.equal(authorized, 3);
  for (const headers of [{ origin: 'http://evil.invalid' }, { authorization: '' }, { 'x-guan-generation-protocol': 'unknown' }, { 'sec-fetch-site': 'cross-site' }])
    assert.ok((await invoke(headers)).status >= 400);
  assert.equal(calls, 1);
  assert.ok((await invoke({}, { operation: 'checkpoint', id: randomUUID(), saved: true })).status >= 400);
  assert.equal(calls, 1);
});
