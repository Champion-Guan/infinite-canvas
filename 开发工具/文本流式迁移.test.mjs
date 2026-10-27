import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { transformWithEsbuild } from '../.运行/3100源/画布副本/web/node_modules/vite/dist/node/index.js';
import { createProviderTextStream, credentialVariants, textStreamKind, MAX_TEXT_BYTES } from '../扩展功能/生成网关/文本流式协议.mjs';
import { createGenerationHTTPHandler } from '../扩展功能/生成网关/生成HTTP入口.mjs';
import { createRoutedImageGateway } from '../扩展功能/故障切换/渠道切换网关.mjs';
import { openGenerationTasks } from '../扩展功能/生成任务/SQLite生成任务.mjs';
import { readTextProgress } from '../扩展功能/生成任务/文本进度客户端.mjs';
import { authorizeLocalStorage } from '../扩展功能/本机存储/本机授权客户端.mjs';
import { StorageError } from '../扩展功能/本机存储/协议.mjs';
import { GENERATION_PROTOCOL } from '../扩展功能/生成网关/生成协议.mjs';
import { runCanvasImageTask } from '../扩展功能/画布生成/图片任务衔接.mjs';
import * as preview from '../扩展功能/画布生成/文本临时显示.mjs';
import { generationFixture, listen, closeServer } from './生成网关隔离夹具.mjs';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const event = value => 'data: ' + JSON.stringify(value) + '\r\n\r\n';
const delta = text => event({ type: 'response.output_text.delta', delta: text });
const complete = text => event({ type: 'response.completed', response: { status: 'completed', output_text: text } });
const request = (body = { model: 'synthetic', stream: true }, path = '/v1/responses') => ({ method: 'POST', path, contentType: 'application/json', body: Buffer.from(JSON.stringify(body)).toString('base64') });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate) { for (let i = 0; i < 100; i++) { if (await predicate()) return; await pause(10); } assert.fail('没有收到预期进度'); }
async function load(file, dependencies = {}) {
  const { code } = await transformWithEsbuild(readFileSync(file, 'utf8'), file, { loader: 'ts', format: 'cjs', target: 'es2022', tsconfigRaw: '{}' });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(id => { assert.ok(Object.hasOwn(dependencies, id), '未注入：' + id); return dependencies[id]; }, module, module.exports);
  return module.exports;
}

test('OpenAI真流式：UTF-8逐字节拆片、CRLF、跨事件凭据均先消毒再显示', () => {
  const key = 'synthetic-密钥:/+"', variants = credentialVariants(key), output = [];
  const parts = ['中文开始：', ...variants.flatMap(value => [value.slice(0, 3), value.slice(3), '；']), '完成'];
  const text = parts.join(''), stream = createProviderTextStream({ kind: 'responses', credential: key, onProgress: value => output.push(value) });
  const bytes = Buffer.from(': heartbeat\r\n\r\n' + parts.map(delta).join('') + complete(text) + 'data: [DONE]\r\n\r\n');
  for (const byte of bytes) stream.push(Buffer.from([byte]));
  const final = JSON.parse(stream.finish(bytes)).output_text;
  assert.ok(output.some(value => value === '中文开始：'), '终态之前已交付文字');
  for (const value of output) for (const secret of variants) assert.equal(value.includes(secret), false);
  assert.equal(final, '中文开始：' + '[credential-redacted]；'.repeat(variants.length) + '完成');
  assert.equal(output.at(-1), final);
});
test('Gemini和Chat流式只显示正文，终态缺失、错误或截断不能保存成功', () => {
  const gemini = createProviderTextStream({ kind: 'gemini', credential: 'synthetic-secret' });
  gemini.push(Buffer.from(event({ candidates: [{ index: 0, content: { parts: [{ text: '隐藏思考', thought: true }, { text: '你好' }] } }] })));
  gemini.push(Buffer.from(event({ candidates: [{ content: { parts: [{ text: '后半' }] }, finishReason: 'STOP' }] })));
  assert.equal(JSON.parse(gemini.finish(Buffer.alloc(0))).output_text, '你好后半');
  const chat = createProviderTextStream({ kind: 'chat', credential: 'synthetic-secret' });
  const wire = event({ choices: [{ index: 0, delta: { content: '真实文字' }, finish_reason: null }] }) + event({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + 'data: [DONE]\n\n';
  assert.equal(JSON.parse(chat.finish(Buffer.from(wire))).output_text, '真实文字');
  for (const wire of [delta('半份'), delta('半份') + event({ type: 'response.failed', response: {} }), 'data: {bad}\n\n', event({ error: { message: 'synthetic-secret' } })]) {
    assert.throws(() => createProviderTextStream({ kind: 'responses', credential: 'synthetic-secret' }).finish(Buffer.from(wire)));
  }
  assert.throws(() => createProviderTextStream({ kind: 'responses', credential: 'synthetic-secret' }).finish(Buffer.from([0xff])));
  assert.throws(() => createProviderTextStream({ kind: 'responses', credential: 'synthetic-secret' }).finish(Buffer.from(delta('x'.repeat(MAX_TEXT_BYTES + 1)))));
});
test('流式规划只识别明确流式正文；普通图片、音频和旧文本请求不被改变', () => {
  assert.equal(textStreamKind(request()), 'responses'); assert.equal(textStreamKind(request({}, '/v1beta/models/gemini:streamGenerateContent?alt=sse')), 'gemini');
  for (const wire of [request({ stream: false }), request({ stream: true }, '/v1/images/generations'), request({}, '/v1/responses')]) assert.equal(textStreamKind(wire), null);
});

async function streamingFixture() {
  const ready = deferred(), finish = deferred(); let response;
  const f = await generationFixture({ respond: async (_req, res) => {
    response = res; res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write(delta('第一段文字'));
    ready.resolve(); await finish.promise;
    if (!res.destroyed) res.end(delta('与结尾') + complete('第一段文字与结尾'));
  } });
  const binding = await f.bind(), input = f.submit(binding.binding, { request: request() });
  return { ...f, input, ready, finish, send: text => response.write(delta(text)), disconnect: () => response.destroy(),
    async close() { finish.resolve(); await f.close(); },
  };
}
test('真实直连传输先交付进度，逐字不写SQLite，完整结果只保存在原任务', async () => {
  const f = await streamingFixture();
  try {
    await f.tasks.submit(f.input); await f.ready.promise;
    await until(() => f.tasks.textProgress(f.input.id).progress?.text === '第一段文字');
    const before = f.workspace.readDocument('extension', 'guan-generation-ledger-v1').revision;
    f.send('进度'); await until(() => f.tasks.textProgress(f.input.id).progress?.text.includes('进度'));
    assert.equal(f.workspace.readDocument('extension', 'guan-generation-ledger-v1').revision, before);
    assert.throws(() => f.tasks.result(f.input.id));
    f.finish.resolve(); await f.tasks.drain();
    assert.equal(f.tasks.get(f.input.id).state, 'succeeded');
    assert.equal(JSON.parse(f.tasks.result(f.input.id).bytes).output_text, '第一段文字与结尾');
    assert.equal(f.tasks.textProgress(f.input.id).progress, null);
    assert.equal(f.requests.length, 1); assert.equal(JSON.parse(f.requests[0].bytes).stream, true);
  } finally { await f.close(); }
});
test('正式路由网关向原文本任务转发实时回调，图片Fallback不会截断文本流', async () => {
  const f = await streamingFixture(); let tasks;
  try {
    const gateway = createRoutedImageGateway({ workspace: f.workspace, base: f.gateway, proxied: f.gateway,
      networkProxy: { getStatus: () => ({ enabled: false }) }, runTrustedWrite: operation => f.coordinator.runWrite(operation),
    });
    tasks = await openGenerationTasks({ workspace: f.workspace, gateway, coordinator: f.coordinator, verifyApplied: f.verifyApplied });
    await tasks.submit(f.input); await f.ready.promise;
    await until(() => tasks.textProgress(f.input.id).progress?.text === '第一段文字');
    f.finish.resolve(); await tasks.drain(); assert.equal(tasks.get(f.input.id).state, 'succeeded'); assert.equal(f.requests.length, 1);
  } finally { f.finish.resolve(); await tasks?.drain(); await tasks?.close(); await f.close(); }
});
test('Gemini原消息协议、流式端点与本机凭据完整贯通，返回规范最终文字', async () => {
  const f = await generationFixture();
  try {
    const { prepareTextRequest } = await load('扩展功能/画布生成/文本生成协议.ts');
    const wire = prepareTextRequest({ apiFormat: 'gemini', model: 'gemini-synthetic', baseUrl: f.providerOrigin, systemPrompt: '系统文字', reasoningEffort: 'auto' }, [{ role: 'user', content: '用户文字' }]);
    assert.equal(wire.path, '/v1beta/models/gemini-synthetic:streamGenerateContent?alt=sse');
    const body = JSON.parse(Buffer.from(wire.body, 'base64'));
    assert.equal(body.systemInstruction.parts[0].text, '系统文字'); assert.equal(body.contents[0].parts[0].text, '用户文字');
    f.reply.type = 'text/event-stream'; f.reply.bytes = Buffer.from(event({ candidates: [{ content: { parts: [{ text: '真实' }] } }] }) + event({ candidates: [{ content: { parts: [{ text: '完成' }] }, finishReason: 'STOP' }] }));
    const binding = await f.bind('gemini'), input = f.submit(binding.binding, { request: wire });
    await f.tasks.submit(input); await f.tasks.drain();
    assert.equal(f.tasks.get(input.id).state, 'succeeded'); assert.equal(JSON.parse(f.tasks.result(input.id).bytes).output_text, '真实完成');
    assert.equal(f.requests[0].headers['x-goog-api-key'], binding.value); assert.ok(!f.requests[0].path.includes('key='));
  } finally { await f.close(); }
});
test('上游流中断保留待核实状态；同任务查询和再次submit均不会重新生成', async () => {
  const f = await streamingFixture();
  try {
    await f.tasks.submit(f.input); await f.ready.promise; f.disconnect(); f.finish.resolve(); await f.tasks.drain();
    assert.equal(f.tasks.get(f.input.id).state, 'uncertain'); assert.equal(f.tasks.textProgress(f.input.id).progress, null);
    await f.tasks.submit(f.input); assert.equal(f.requests.length, 1); assert.throws(() => f.tasks.result(f.input.id));
  } finally { await f.close(); }
});

async function authorizedFixture() {
  const f = await streamingFixture(); let live = true, handler, origin; const capability = 'a'.repeat(64), commands = [];
  const server = createServer(async (req, res) => {
    if (req.url === '/__guan-local/authorize' || req.url === '/__guan-local/session') {
      for await (const _chunk of req) { /* 消费原JSON请求 */ }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ protocol: 'guan-local-authorization.v1', origin, dataURL: 'http://127.0.0.1:1234', capability, expiresAt: Date.now() + 60_000, session: {} })); return;
    }
    commands.push(req.url); if (!await handler(req, res)) { res.writeHead(404); res.end(); }
  });
  origin = await listen(server);
  handler = createGenerationHTTPHandler({ origin, tasks: f.tasks, gateway: f.gateway, authorize(req) {
    if (!live || req.headers.authorization !== 'Bearer ' + capability) throw new StorageError('authorization_denied', '合成授权已撤销。', 401);
  } });
  const auth = await authorizeLocalStorage({ code: 'b'.repeat(64), origin, fetchImpl: (url, options) => fetch(url, { ...options, headers: { ...options.headers, origin } }) });
  return { ...f, auth, origin, commands, revoke: () => { live = false; }, async close() { await closeServer(server); await f.close(); } };
}
test('真实HTTP及原授权客户端：终态前多次显示，同步查询不被观察连接占满', async () => {
  const f = await authorizedFixture(), first = deferred(), texts = [];
  try {
    await f.auth.generationPort.submit(f.input);
    const watch = f.auth.generationPort.observeText(f.input, { onProgress(text) { texts.push(text); first.resolve(); } });
    await first.promise;
    assert.equal(texts[0], '第一段文字'); assert.equal((await f.auth.generationPort.get(f.input.id)).state, 'running');
    f.send('第二段'); await until(() => texts.some(text => text.includes('第二段')));
    f.finish.resolve(); assert.equal((await watch).state, 'succeeded');
    assert.equal(f.requests.length, 1);
  } finally { await f.close(); }
});
test('观察取消和页面能力撤销均只断开观察，不重新生成，也不假成功', async () => {
  for (const mode of ['abort', 'revoke']) {
    const f = await authorizedFixture(), first = deferred(), controller = new AbortController();
    try {
      await f.auth.generationPort.submit(f.input);
      const watch = f.auth.generationPort.observeText(f.input, { signal: controller.signal, onProgress() { first.resolve(); } }); watch.catch(() => {});
      await first.promise;
      if (mode === 'abort') controller.abort(); else { f.revoke(); f.send('不可再交付'); }
      await assert.rejects(watch);
      assert.equal(f.tasks.get(f.input.id).state, 'running'); assert.equal(f.requests.length, 1);
      f.finish.resolve(); await f.tasks.drain(); assert.equal(f.tasks.get(f.input.id).state, 'succeeded');
    } finally { await f.close(); }
  }
});
test('观察客户端验证原任务归属和序号，半份终态或伪造结果均不交付', async () => {
  const task = { id: randomUUID(), productId: 'product', nodeId: 'text' }, job = { ...task, state: 'running', applied: false };
  const response = values => new Response(values.map(value => JSON.stringify({ protocol: GENERATION_PROTOCOL, ...value }) + '\n').join(''), { headers: { 'content-type': 'application/x-ndjson' } });
  for (const values of [
    [{ job: { ...job, nodeId: 'other' }, progress: { text: 'x', revision: 1 }, done: false }],
    [{ job, progress: { text: 'x', revision: 2 }, done: false }, { job, progress: { text: 'y', revision: 1 }, done: false }],
    [{ job, done: true }], [{ job, done: false }],
  ]) await assert.rejects(readTextProgress(response(values), task));
});
test('临时显示隔离原节点、槽位和任务；生成进度不进入原数据对象', async () => {
  const hooks = { useCallback: fn => fn, useMemo: fn => fn(), useSyncExternalStore: (_subscribe, read) => read() };
  const { useCanvasTextPreview } = await load('扩展功能/画布生成/文本显示接线.ts', { react: hooks, './文本临时显示.mjs': preview });
  const node = { id: 'text-preview', type: 'text', metadata: { status: 'loading', content: '', texts: [{ id: 'slot', content: '', status: 'loading' }], gatewayGenerationTasks: [{ taskId: 'task', slotId: 'slot' }] } };
  const before = structuredClone(node); let notices = 0; const unsubscribe = preview.subscribeTextPreview(node.id, () => notices++);
  try {
    preview.publishTextPreview({ nodeId: node.id, taskId: 'task', slotId: 'slot', text: '正在生成' });
    assert.equal(useCanvasTextPreview(node).metadata.content, '正在生成'); assert.deepEqual(node, before);
    const other = { ...node, metadata: { ...node.metadata, gatewayGenerationTasks: [{ taskId: 'other', slotId: 'slot' }] } };
    assert.equal(useCanvasTextPreview(other), other);
    preview.clearTextPreview(node.id, 'task'); assert.equal(useCanvasTextPreview(node), node); assert.equal(notices, 2);
  } finally { unsubscribe(); preview.clearTextPreview(node.id, 'task'); }
});
test('原画布文本调用仅临时展示进度，最终保存一次，观察失败后只查询原任务', async () => {
  for (const disconnect of [false, true]) {
    let job, descriptor, sends = 0, saves = 0, progressSeen = false;
    const scope = { productId: 'p', nodeId: 'text-root', slotId: 'slot' };
    const host = {
      async submit(value) { sends++; return job = { ...value, state: 'running', applied: false }; },
      async get() { return job; },
      async observeText(_task, options) {
        options.onProgress('真实前半段');
        assert.equal(preview.textPreviewSnapshot(scope.nodeId).get(descriptor.taskId).text, '真实前半段');
        assert.equal(saves, 0); progressSeen = true;
        job = { ...job, state: 'succeeded', result: { id: 'a'.repeat(64) }, bytes: Buffer.from('{"output_text":"完整结果"}').toString('base64') };
        if (disconnect) throw Error('仅观察断线'); return job;
      },
      async deliver(_task, { applyAndSave }) { await applyAndSave(job); return { ...job, applied: true }; },
      async checkpoint() { return {}; }, async cancel() {},
    };
    const configPort = { resolveModelRequestConfig: value => value };
    const protocol = await load('扩展功能/画布生成/文本生成协议.ts');
    const { requestCanvasText } = await load('扩展功能/画布生成/原画布文本调用.ts', {
      '@/stores/use-config-store': configPort, './原画布图片调用': { bindGenerationChannel: async () => 'provider:' + 'a'.repeat(64) },
      './图片任务衔接.mjs': { runCanvasImageTask }, './文本生成协议': protocol, './文本临时显示.mjs': preview,
    });
    const previous = globalThis.window; globalThis.window = { __guanGenerationHost: host };
    try {
      const text = await requestCanvasText({ config: { apiFormat: 'openai', model: 'synthetic', systemPrompt: '', reasoningEffort: 'auto' }, scope, messages: [{ role: 'user', content: 'hello' }],
        recordTask: async value => { descriptor = value; }, applyAndSave: async value => { assert.equal(value, '完整结果'); saves++; },
      });
      assert.equal(text, '完整结果'); assert.equal(sends, 1); assert.equal(saves, 1); assert.equal(progressSeen, true); assert.equal(preview.textPreviewSnapshot(scope.nodeId), null);
    } finally { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; }
  }
});
test('文本最终回写在原产品、节点、槽位和取消核验后才应用，保存失败不确认', async () => {
  for (const mode of ['normal', 'switch', 'delete', 'replace', 'abort', 'save']) {
    const controller = new AbortController(), taskId = randomUUID(); let finalCallbacks = 0, saves = 0;
    const port = { projectId: 'product', restoredProjectIdRef: { current: 'product' }, nodesRef: { current: [{ id: 'text', type: 'text', metadata: { status: 'loading', texts: [{ id: 'slot', content: '', status: 'loading' }] } }] } };
    port.setNodes = update => { port.nodesRef.current = typeof update === 'function' ? update(port.nodesRef.current) : update; };
    const { useCanvasTaskReceipts } = await load('扩展功能/画布生成/生成任务回执操作.ts', {
      react: { useCallback: fn => fn, useRef: current => ({ current }) }, './图片任务确认恢复.mjs': {}, './原画布音频调用': {}, '@/services/api/audio': {},
      '../产品/产品操作': { saveProductCanvas: async () => { if (++saves === 2 && mode === 'save') throw Error('保存未确认'); } },
      './原画布文本调用': { requestCanvasText: async options => {
        await options.recordTask({ taskId, slotId: 'slot', binding: 'provider:' + 'a'.repeat(64), requestHash: 'b'.repeat(64) });
        if (mode === 'switch') port.restoredProjectIdRef.current = 'other';
        if (mode === 'delete') port.nodesRef.current = [];
        if (mode === 'replace') port.nodesRef.current[0].metadata.gatewayGenerationTasks[0].taskId = 'other';
        if (mode === 'abort') controller.abort();
        await options.applyAndSave('完整结果', { taskId, responseHash: 'c'.repeat(64) }); return '完整结果';
      } },
    });
    const pending = useCanvasTaskReceipts(port).requestNodeText({}, [], () => finalCallbacks++, { signal: controller.signal, nodeId: 'text', slotId: 'slot' });
    if (mode === 'normal') { await pending; assert.equal(saves, 2); assert.equal(finalCallbacks, 1); }
    else { await assert.rejects(pending); assert.equal(finalCallbacks, mode === 'save' ? 1 : 0); }
  }
});
