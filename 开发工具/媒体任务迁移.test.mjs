import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { transformWithEsbuild } from '../.运行/3100源/画布副本/web/node_modules/vite/dist/node/index.js';
import { runCanvasImageTask } from '../扩展功能/画布生成/图片任务衔接.mjs';
import { clearConfirmedImageErrors, imageConfirmationTargets, imageConfirmationErrorKey } from '../扩展功能/画布生成/图片任务确认恢复.mjs';

async function load(file, dependencies = {}) {
    const { code } = await transformWithEsbuild(readFileSync(file, 'utf8'), file, { loader: 'ts', format: 'cjs', target: 'es2022', tsconfigRaw: '{}' });
    const module = { exports: {} };
    new Function('require', 'module', 'exports', code)(id => { assert.ok(Object.hasOwn(dependencies, id), '未注入依赖：' + id); return dependencies[id]; }, module, module.exports);
    return module.exports;
}
const hooks = { useCallback: fn => fn, useRef: value => ({ current: value }) };
const config = { apiFormat: 'openai', model: 'channel::tts', audioModel: 'channel::tts', audioVoice: 'alloy', audioFormat: 'mp3', audioSpeed: '1', audioInstructions: '温柔', baseUrl: 'https://provider.example/v1' };
const audioFormat = { normalizeAudioFormatValue: value => value, normalizeAudioVoiceValue: value => value, normalizeAudioSpeedValue: value => value, audioMimeType: () => 'audio/mpeg' };
const binding = 'provider:' + 'a'.repeat(64), hash = 'b'.repeat(64);

async function audioFixture() {
    let descriptor, job, sends = 0, saves = 0, saveError = false;
    const events = [];
    const host = {
        async submit(value) { sends++; events.push('submit'); assert.equal(descriptor.taskId, value.id); job = { id: value.id, productId: value.productId, nodeId: value.nodeId, state: 'succeeded', applied: false, result: { id: hash, contentType: 'audio/mpeg' }, bytes: btoa('local-audio') }; return job; },
        async get() { events.push('get'); return job; },
        async deliver(_task, { applyAndSave }) { const checkpoint = await applyAndSave(job); assert.deepEqual(checkpoint, { saved: true }); job.applied = true; return job; },
        async checkpoint() { events.push('checkpoint'); return { saved: true }; },
        async cancel() {},
    };
    const { requestCanvasAudio, prepareAudioRequest, parseAudioResponse } = await load('扩展功能/画布生成/原画布音频调用.ts', {
        '@/stores/use-config-store': { resolveModelRequestConfig: value => ({ ...value, model: 'tts' }) },
        '@/lib/audio-generation': audioFormat,
        '../产品配置/精简与离线策略': { requireGenerationMode: mode => assert.equal(mode, 'audio') },
        './原画布图片调用': { bindGenerationChannel: async (value, current) => { assert.equal(value, host); assert.equal(current.model, config.model); events.push('bind'); return binding; } },
        './图片任务衔接.mjs': { runCanvasImageTask },
    });
    const options = { config, prompt: '你好', scope: { productId: 'product', nodeId: 'audio', slotId: 'audio' },
        recordTask: async value => { events.push('record'); descriptor = value; },
        applyAndSave: async (blob, receipt) => { saves++; events.push('save'); assert.equal(await blob.text(), 'local-audio'); assert.equal(receipt.taskId, descriptor.taskId); if (saveError) throw Error('保存失败'); },
    };
    return { host, events, options, prepareAudioRequest, parseAudioResponse, counts: () => ({ sends, saves }),
        failSave(value) { saveError = value; }, getJob: () => job,
        async run(previous = false) {
            const before = globalThis.window; globalThis.window = { __guanGenerationHost: host };
            try { return await requestCanvasAudio({ ...options, previous: previous ? descriptor : undefined }); }
            finally { if (before === undefined) delete globalThis.window; else globalThis.window = before; }
        },
    };
}
test('音频参数沿用原协议；任务身份落盘后才发送，结果保存后才确认', async () => {
    const api = await audioFixture(), before = structuredClone(config);
    const wire = api.prepareAudioRequest(config, '你好');
    assert.equal(wire.path, '/v1/audio/speech');
    assert.deepEqual(JSON.parse(Buffer.from(wire.body, 'base64').toString()), { model: config.model, input: '你好', voice: 'alloy', response_format: 'mp3', speed: 1, instructions: '温柔' });
    await api.run();
    assert.deepEqual(api.events, ['bind', 'record', 'submit', 'save', 'checkpoint']);
    assert.deepEqual(config, before); assert.equal(api.getJob().applied, true);
});
test('音频保存失败后重试原任务只重放已有响应，不再次调用渠道', async () => {
    const api = await audioFixture(); api.failSave(true);
    await assert.rejects(api.run(), /保存失败/);
    assert.equal(api.getJob().applied, false);
    api.failSave(false); await api.run(true);
    assert.deepEqual(api.counts(), { sends: 1, saves: 2 });
});
test('音频JSON、HTML、空响应不假成功；二进制音频使用实际格式', async () => {
    const api = await audioFixture();
    for (const type of ['application/json', 'text/html', 'image/png']) assert.throws(() => api.parseAudioResponse(btoa('{}'), type, 'mp3'), /没有返回音频/);
    assert.throws(() => api.parseAudioResponse('', 'audio/mpeg', 'mp3'), /空音频/);
    assert.equal(api.parseAudioResponse(btoa('audio'), 'application/octet-stream', 'mp3').type, 'audio/mpeg');
    assert.throws(() => api.prepareAudioRequest({ ...config, apiFormat: 'gemini' }, 'x'), /不支持/);
});
test('音频回写在上传前后核对原产品、卡片、槽位和取消，丢失目标不交付', async () => {
    for (const kind of ['normal', 'delete', 'replace', 'switch', 'abort', 'save']) {
        const signal = new AbortController(), taskId = randomUUID(); let request, uploads = 0, saves = 0, applies = 0;
        const port = { projectId: 'product', restoredProjectIdRef: { current: 'product' }, nodesRef: { current: [{ id: 'audio', type: 'audio', metadata: {} }] } };
        port.setNodes = update => { port.nodesRef.current = typeof update === 'function' ? update(port.nodesRef.current) : update; };
        const api = await load('扩展功能/画布生成/生成任务回执操作.ts', {
            react: hooks, './图片任务确认恢复.mjs': { clearConfirmedImageErrors }, './原画布文本调用': {},
            './原画布音频调用': { requestCanvasAudio: async options => {
                request = options; await options.recordTask({ taskId, slotId: 'audio', binding, requestHash: hash });
                await options.applyAndSave(new Blob(['audio']), { taskId, responseHash: hash });
            } },
            '@/services/api/audio': { storeGeneratedAudio: async () => {
                uploads++;
                if (kind === 'delete') port.nodesRef.current = [];
                if (kind === 'replace') port.nodesRef.current[0].metadata.gatewayGenerationTasks = [{ taskId: 'other', slotId: 'audio' }];
                if (kind === 'switch') port.restoredProjectIdRef.current = 'other';
                if (kind === 'abort') signal.abort();
                return { url: 'blob:local', storageKey: 'audio:saved' };
            } },
            '../产品/产品操作': { saveProductCanvas: async id => { assert.equal(id, 'product'); if (++saves === 2 && kind === 'save') throw Error('保存失败'); } },
        });
        const promise = api.useCanvasTaskReceipts(port).requestNodeAudio(config, '你好', uploaded => {
            applies++; port.setNodes(nodes => nodes.map(node => ({ ...node, metadata: { ...node.metadata, content: uploaded.url, storageKey: uploaded.storageKey } })));
        }, { signal: signal.signal, nodeId: 'audio', slotId: 'audio' });
        if (kind === 'normal') {
            await promise; assert.equal(applies, 1); assert.equal(saves, 2);
            assert.deepEqual(port.nodesRef.current[0].metadata.gatewayGenerationReceipts, [{ taskId, responseHash: hash }]);
        } else {
            await assert.rejects(promise); assert.equal(applies, kind === 'save' ? 1 : 0);
        }
        assert.equal(uploads, 1); assert.equal(request.scope.productId, 'product');
    }
});
test('蒙版和多角度通过原图片任务及保存端口，原节点消失时不发送', async () => {
    let requests = 0, saved;
    const nodesRef = { current: [{ id: 'result', metadata: {} }] };
    const { useCanvasImageTools } = await load('扩展功能/画布生成/图片工具任务.ts', {
        react: hooks, './原画布图片调用': { requestCanvasImage: async options => {
            requests++; assert.equal(options.scope.slotId, 'result'); await options.recordTask({ taskId: 'task' });
            await options.applyAndSave({ dataUrl: 'data:image/png;base64,eA==' }, { taskId: 'task', responseHash: hash });
        } },
    });
    const run = useCanvasImageTools({ projectId: 'product', nodesRef, recordTask: async (id, task) => { assert.equal(id, 'result'); assert.equal(task.taskId, 'task'); }, saveResult: async value => { saved = value; } });
    const signal = new AbortController().signal;
    await run('result', config, '蒙版提示词', [], signal, { generationType: 'edit' });
    assert.equal(saved.mode, 'tool'); assert.equal(saved.nodeId, 'result'); assert.equal(saved.receipt.taskId, 'task'); assert.equal(saved.signal, signal);
    nodesRef.current = []; await assert.rejects(run('result', config, 'x', [], signal, {}), /已删除/); assert.equal(requests, 1);
});
test('音频和单图工具的已有收据支持断线后确认，不重传媒体或发起生成', () => {
    for (const type of ['audio', 'image']) {
        const node = { id: 'result', type, metadata: { status: 'success', content: 'blob:local', storageKey: type + ':stored', errorDetails: '确认失败',
            gatewayGenerationTasks: [{ taskId: 'task', slotId: 'result' }], gatewayGenerationReceipts: [{ taskId: 'task', responseHash: hash }] } };
        const targets = imageConfirmationTargets('product', [node]); assert.equal(targets.length, 1);
        assert.notEqual(imageConfirmationErrorKey([node]), '[]');
        const [cleared] = clearConfirmedImageErrors([node], targets[0]);
        assert.equal(cleared.metadata.errorDetails, undefined); assert.equal(cleared.metadata.storageKey, node.metadata.storageKey);
    }
});
