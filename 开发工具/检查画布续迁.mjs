import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformWithEsbuild } from '../.运行/3100源/画布副本/web/node_modules/vite/dist/node/index.js';
import { runCanvasImageTask } from '../扩展功能/画布生成/图片任务衔接.mjs';
import { imageConfirmationTargets, clearConfirmedImageErrors, imageConfirmationErrorKey } from '../扩展功能/画布生成/图片任务确认恢复.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
async function load(name, dependencies = {}) {
    const file = resolve(root, name.startsWith('lib/') ? '.运行/3100源/画布副本/web/src/' + name : '扩展功能/' + name);
    const { code } = await transformWithEsbuild(readFileSync(file, 'utf8'), file, { loader: 'ts', format: 'cjs', target: 'es2022', tsconfigRaw: '{}' });
    const module = { exports: {} };
    new Function('require', 'module', 'exports', code)(id => {
        assert.ok(Object.hasOwn(dependencies, id), `未注入依赖 ${id}`);
        return dependencies[id];
    }, module, module.exports);
    return module.exports;
}
const protocol = await load('画布生成/文本生成协议.ts');
const { themeCalibrationInput, themeCalibrationOps } = await load('Excel画布/主题校准规则.ts');
const config = { apiFormat: 'openai', model: '文本模型', baseUrl: 'https://provider.example/v1', systemPrompt: '保留变量', reasoningEffort: 'high' };
const decode = value => JSON.parse(Buffer.from(value, 'base64').toString('utf8'));
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64');

test('Responses文本请求保留中文、变量、多模态内容、推理参数且不夹带密钥', () => {
    const request = protocol.prepareTextRequest({ ...config, apiKey: '不应进入正文' }, [{ role: 'user', content: [{ type: 'text', text: '翻译 [PRODUCT NAME]：缝纫包' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }] }]);
    assert.equal(request.path, '/v1/responses');
    const body = decode(request.body);
    assert.equal(body.input[0].content, '保留变量');
    assert.equal(body.input[1].content[0].text, '翻译 [PRODUCT NAME]：缝纫包');
    assert.equal(body.input[1].content[1].type, 'input_image');
    assert.deepEqual(body.reasoning, { effort: 'high' });
    assert.equal(body.stream, false);
    assert.ok(!JSON.stringify(request).includes('不应进入正文'));
});

test('Gemini文本使用既有网关路径并区分系统消息和图片内容', () => {
    const request = protocol.prepareTextRequest({ ...config, apiFormat: 'gemini', model: 'models/gemini-2.5-pro', baseUrl: 'https://provider.example/v1beta' }, [{ role: 'user', content: [{ type: 'text', text: '分析主题' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }] }]);
    assert.equal(request.path, '/v1beta/models/gemini-2.5-pro:generateContent');
    const body = decode(request.body);
    assert.equal(body.systemInstruction.parts[0].text, '保留变量');
    assert.equal(body.contents[0].parts[1].inlineData.data, 'AAAA');
    assert.throws(() => protocol.prepareTextRequest({ ...config, apiFormat: 'gemini', model: 'gemini-2.5-pro' }, [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://not-read.example/image.png' } }] }]), /必须先读取本机/);
});

test('文本响应提取Responses与Gemini内容，拒绝错误、空响应和坏编码', () => {
    assert.equal(protocol.parseTextResponse(encode({ output: [{ type: 'message', content: [{ type: 'output_text', text: '中文译文 [NAME]' }] }] })), '中文译文 [NAME]');
    assert.equal(protocol.parseTextResponse(encode({ candidates: [{ content: { parts: [{ text: '内部思考', thought: true }, { text: '主题' }] } }] })), '主题');
    assert.throws(() => protocol.parseTextResponse(encode({ error: { message: '额度不足' } })), /额度不足/);
    assert.throws(() => protocol.parseTextResponse(encode({ output: [] })), /有效内容/);
    assert.throws(() => protocol.parseTextResponse(Buffer.from([0xff]).toString('base64')));
});

test('主题校准仅应用原参数卡仍绑定且未改过的提示词；坏标签不写回', () => {
    const nodes = [
        { id: 'a', metadata: { excelPromptBindingNodeId: 'params-a', excelPromptRaw: '主图 [NAME]' } },
        { id: 'b', metadata: { excelPromptBindingNodeId: 'params-a', content: '详情' } },
        { id: 'c', metadata: { excelPromptBindingNodeId: 'params-other', content: '其他产品' } },
        { id: 'preview', metadata: { excelPromptBindingNodeId: 'params-a', promptVariablePreviewOf: 'params-a', content: '预览' } },
    ];
    const before = JSON.stringify(nodes);
    const input = themeCalibrationInput(nodes, 'params-a');
    assert.deepEqual(input.map(item => item.id), ['a', 'b']);
    const answer = JSON.stringify([{ id: 'a', theme: '完整产品' }, { id: 'b', theme: '局部细节' }]);
    const changed = structuredClone(nodes); changed[1].metadata.content = '用户刚修改';
    assert.deepEqual(themeCalibrationOps(answer, input, changed, 'params-a'), [{ type: 'update_node', id: 'a', metadata: { excelPromptTheme: '完整产品' } }]);
    assert.throws(() => themeCalibrationOps('[{"id":"c","theme":"越界"}]', input, nodes, 'params-a'), /未通过/);
    assert.throws(() => themeCalibrationOps('[{"id":"a","theme":"一"},{"id":"a","theme":"二"}]', input, nodes, 'params-a'), /未通过/);
    assert.equal(JSON.stringify(nodes), before);
    const long = [{ id: 'long', metadata: { excelPromptBindingNodeId: 'params-a', content: '字'.repeat(6100) } }];
    const longInput = themeCalibrationInput(long, 'params-a');
    assert.equal(longInput[0].prompt.length, 6000);
    const changedTail = structuredClone(long); changedTail[0].metadata.content += '改动';
    assert.deepEqual(themeCalibrationOps('[{"id":"long","theme":"主题"}]', longInput, changedTail, 'params-a'), []);
    const edited = [{ id: 'a', metadata: { excelPromptBindingNodeId: 'params-a', excelPromptRaw: '旧提示词', content: '当前编辑的提示词' } }];
    const snapshot = themeCalibrationInput(edited, 'params-a');
    assert.equal(snapshot[0].prompt, '当前编辑的提示词');
    const newer = structuredClone(edited); newer[0].metadata.content = '后来编辑的提示词';
    assert.deepEqual(themeCalibrationOps('[{"id":"a","theme":"旧任务主题"}]', snapshot, newer, 'params-a'), []);
});

test('文本任务先记录原产品身份再提交，保存失败后重试只应用已有响应', async () => {
    const scope = { productId: 'product-a', nodeId: 'text-a', slotId: 'text-slot' };
    const events = []; let task, submissions = 0, failSave = true;
    const bytes = encode({ output_text: '翻译结果' });
    const responseHash = Buffer.from(await crypto.subtle.digest('SHA-256', Buffer.from(bytes, 'base64'))).toString('hex');
    const host = {
        bind: async () => ({ binding: 'provider:' + 'a'.repeat(64) }),
        submit: async input => { submissions++; events.push('submit'); return { id: input.id, ...scope, state: 'succeeded', applied: false }; },
        get: async id => ({ id, ...scope, state: 'succeeded', applied: false }),
        checkpoint: async () => { events.push('checkpoint'); return {}; },
        deliver: async (input, { applyAndSave }) => {
            await applyAndSave({ id: input.id, ...scope, state: 'succeeded', applied: false, bytes, result: { id: responseHash } });
            return { id: input.id, ...scope, state: 'succeeded', applied: true };
        },
    };
    const { requestCanvasText } = await load('画布生成/原画布文本调用.ts', {
        '@/stores/use-config-store': { resolveModelRequestConfig: value => value },
        './原画布图片调用': { bindGenerationChannel: async value => (await value.bind()).binding },
        './图片任务衔接.mjs': { runCanvasImageTask },
        './文本生成协议': protocol,
    });
    globalThis.window = { __guanGenerationHost: host };
    const request = previous => requestCanvasText({ config, messages: [{ role: 'user', content: '翻译' }], scope, previous,
        recordTask: async value => { events.push('record'); task = value; },
        applyAndSave: async (text, receipt) => { assert.equal(text, '翻译结果'); assert.equal(receipt.responseHash, responseHash); events.push('save'); if (failSave) throw Error('保存失败'); },
    });
    try {
        await assert.rejects(request(), /保存失败/);
        assert.deepEqual(events, ['record', 'submit', 'save']);
        failSave = false;
        assert.equal(await request(task), '翻译结果');
        assert.equal(submissions, 1);
        assert.deepEqual(events.slice(-2), ['save', 'checkpoint']);
    } finally { delete globalThis.window; }
});

test('文本/主题校准收据进入既有独立确认流程，不创建新的生成请求', () => {
    const task = { taskId: crypto.randomUUID() }, responseHash = 'c'.repeat(64);
    for (const type of ['image', 'text', 'guan:prompt-variables']) {
        assert.equal(imageConfirmationTargets('product-a', [{ id: 'n', type, metadata: { gatewayGenerationTasks: [task], gatewayGenerationReceipts: [{ taskId: task.taskId, responseHash }] } }]).length, 1);
    }
});

test('文本保存错误只清理已确认原任务的成功槽位，保留其他失败内容', () => {
    const nodes = [{ id: 'text', type: 'text', metadata: { status: 'success', content: '已返回的中文', primaryTextId: 'first',
        gatewayGenerationTasks: [{ taskId: 'task-a', slotId: 'first' }], gatewayGenerationReceipts: [{ taskId: 'task-a', responseHash: 'hash-a' }],
        texts: [{ id: 'first', status: 'success', content: '已返回的中文', errorDetails: '确认失败' }, { id: 'second', status: 'error', content: '', errorDetails: '生成失败' }],
    } }];
    const target = { id: 'task-a', nodeId: 'text', responseHash: 'hash-a' };
    const key = imageConfirmationErrorKey(nodes);
    assert.equal(clearConfirmedImageErrors(nodes, { ...target, responseHash: 'other' }), nodes);
    const cleared = clearConfirmedImageErrors(nodes, target);
    assert.equal(cleared[0].metadata.texts[0].errorDetails, undefined);
    assert.equal(cleared[0].metadata.texts[0].content, '已返回的中文');
    assert.equal(cleared[0].metadata.texts[1].errorDetails, '生成失败');
    assert.notEqual(imageConfirmationErrorKey(cleared), key);
    assert.equal(nodes[0].metadata.texts[0].errorDetails, '确认失败');
});

test('节点显式自动审核覆盖全局低审核，未设置时继承全局', async () => {
    const { buildGenerationConfig } = await load('lib/canvas/canvas-generation-helpers.ts', {
        '@/stores/use-config-store': { defaultConfig: {}, FALLBACK_MODEL_OPTION: 'fallback', resolveModelForCapability: () => 'gpt-image-1' },
        '@/i18n': {}, '@/services/image-storage': {}, '@/services/file-storage': {}, '@/lib/canvas/canvas-node-factory': {},
        '@/types/canvas': { CanvasNodeType: { Image: 'image' } },
    });
    const global = { moderation: 'low', imageModel: 'gpt-image-1' };
    assert.equal(buildGenerationConfig(global, { metadata: { moderation: 'auto' } }, 'image').moderation, 'auto');
    assert.equal(buildGenerationConfig(global, { metadata: {} }, 'image').moderation, 'low');
    assert.equal(buildGenerationConfig({ ...global, moderation: 'auto' }, { metadata: { moderation: 'low' } }, 'image').moderation, 'low');
});

test('视区调度合并同帧移动，flush提交最新视图，dispose取消未完成帧', async () => {
    const { createCanvasPanScheduler } = await load('画布布局/画布平移调度.ts');
    const frames = new Map(), painted = [], committed = []; let sequence = 0;
    const scheduler = createCanvasPanScheduler({ paint: value => painted.push(value), commit: value => committed.push(value), frame: callback => { frames.set(++sequence, callback); return sequence; }, cancel: id => frames.delete(id), now: () => 0 });
    scheduler.begin({ x: 0, y: 0, k: 1 });
    scheduler.move({ x: 10, y: 20, k: 1 }); scheduler.move({ x: 30, y: 40, k: 1 });
    assert.equal(frames.size, 1);
    scheduler.flush();
    assert.deepEqual(committed, [{ x: 30, y: 40, k: 1 }]);
    assert.deepEqual(painted, committed);
    assert.equal(frames.size, 0);
    scheduler.move({ x: 50, y: 60, k: 1 }); scheduler.dispose();
    assert.equal(frames.size, 0);
});

test('手填尺寸切换比例保留宽或高，16倍对齐仅显式开启时生效', async () => {
    const { dimensionsFromAnchor } = await load('图片设置/尺寸比例锚点.ts');
    assert.deepEqual(dimensionsFromAnchor('width', 900, '3:4'), { width: 900, height: 1200 });
    assert.deepEqual(dimensionsFromAnchor('height', 1200, '3:4'), { width: 900, height: 1200 });
    assert.deepEqual(dimensionsFromAnchor('width', 900, '3:4', true), { width: 912, height: 1216 });
    assert.equal(dimensionsFromAnchor('width', 900, 'auto'), null);
});
