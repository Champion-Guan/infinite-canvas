import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { variantModules, variantFixture } from './产品变体生成夹具.mjs';

const require = createRequire(resolve('.运行/3100源/画布副本/web/package.json'));
const ts = require('typescript');
const rules = variantModules().load('系统提示词/分类提示词规则.ts');

test('旧系统提示词继续作用于图片和文本，视频及音频保持原行为，显式清空与默认值可区分', () => {
    const legacy = { systemPrompt: '旧的角色', audioInstructions: '温柔旁白' };
    assert.equal(rules.systemPromptForCapability(legacy, 'image'), '旧的角色');
    assert.equal(rules.systemPromptForCapability(legacy, 'text'), '旧的角色');
    assert.equal(rules.systemPromptForCapability(legacy, 'video'), '');
    assert.equal(rules.systemPromptForCapability(legacy, 'audio'), '温柔旁白');
    assert.equal(rules.systemPromptForCapability({ ...legacy, imageSystemPrompt: '' }, 'image'), '');
    assert.equal(rules.systemPromptForCapability({ ...legacy, imageSystemPrompt: null }, 'image'), '旧的角色');
    assert.equal(rules.imagePlanningSystemPrompt({ imagePlanningSystemPrompt: '' }), '');
    assert.match(rules.imagePlanningSystemPrompt({}), /^你是一名电商商品视觉策划总监/);
});

test('四类系统提示词隔离，多次解析渠道不会把上一个能力的指令带到另一个能力', () => {
    const config = { systemPrompt: '旧的公共值', imageSystemPrompt: '图片', textSystemPrompt: '文本', videoSystemPrompt: '视频', audioInstructions: '音频' };
    const before = structuredClone(config);
    for (const [capability, expected] of [['image', '图片'], ['text', '文本'], ['video', '视频'], ['audio', '音频']]) {
        const other = rules.withCapabilitySystemPrompt(config, 'image');
        assert.equal(rules.withCapabilitySystemPrompt(other, capability).systemPrompt, expected);
    }
    assert.deepEqual(config, before);
    const legacy = rules.withCapabilitySystemPrompt({ systemPrompt: '旧的公共值' }, 'video');
    assert.equal(legacy.systemPrompt, '');
    assert.equal(rules.withCapabilitySystemPrompt(legacy, 'text').systemPrompt, '旧的公共值');
});

test('真实渠道解析函数按模型能力选择提示词，不更改认证及模型身份', () => {
    const path = '.运行/3100源/画布副本/web/src/stores/use-config-store.ts';
    const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
    const names = new Set(['resolveModelRequestConfig', 'resolveModelChannel', 'modelOptionName', 'decodeChannelModel', 'findChannelModel', 'modelCapabilityOf', 'guessCapability']);
    const code = source.statements.filter(node => ts.isFunctionDeclaration(node) && names.has(node.name?.text)).map(node => node.getText(source)).join('\n');
    const compiled = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const module = { exports: {} };
    new Function('module', 'exports', 'withCapabilitySystemPrompt', 'CHANNEL_MODEL_SEPARATOR', 'VIDEO_KEYWORDS', 'AUDIO_KEYWORDS', 'IMAGE_KEYWORDS', compiled)(module, module.exports, rules.withCapabilitySystemPrompt, '::', ['video'], ['audio'], ['image']);
    const models = ['image', 'text', 'video', 'audio'].map(capability => ({ name: capability + '-model', capability }));
    const config = { channels: [{ id: 'channel', models, baseUrl: 'https://synthetic.invalid', apiKey: 'synthetic', apiFormat: 'openai' }],
        systemPrompt: '旧值', imageSystemPrompt: '图片', textSystemPrompt: '文本', videoSystemPrompt: '视频', audioInstructions: '音频' };
    for (const [capability, expected] of [['image', '图片'], ['text', '文本'], ['video', '视频'], ['audio', '音频']]) {
        const resolved = module.exports.resolveModelRequestConfig(config, `channel::${capability}-model`);
        assert.equal(resolved.systemPrompt, expected);
        assert.equal(resolved.model, capability + '-model');
        assert.equal(resolved.baseUrl, config.channels[0].baseUrl);
        assert.equal(resolved.apiKey, 'synthetic');
    }
});

test('AI写提示词实际请求使用用户角色并保留固定输出约定，不混入文本角色', async () => {
    const fixture = variantFixture();
    let captured;
    const stop = Error('合成请求边界');
    const config = { imagePlanningSystemPrompt: '用户自定义商品摄影策划背景', textSystemPrompt: '普通文本背景', systemPrompt: '旧值' };
    const loader = variantModules({
        '@/stores/use-config-store': { useConfigStore: { getState: () => ({ config, isAiConfigReady: () => true }) } },
        '@/lib/canvas/canvas-generation-helpers': { buildGenerationConfig: value => ({ ...value, model: 'text-model' }) },
        './商品策划完成通知': { notifyProductPlanning() {} },
        '../产品/产品操作': { saveProductCanvas: async () => ({ persisted: true }) },
        '../画布生成/原画布文本调用': { requestCanvasText: async options => { captured = options; throw stop; } },
    });
    const ctx = { node: fixture.parameter, getNode: id => fixture.nodes.find(node => node.id === id),
        getNodes: () => fixture.nodes, getConnections: () => fixture.connections };
    await assert.rejects(loader.load('Excel画布/商品策划请求.ts').planProductImages(ctx, 'product', new AbortController().signal), error => error === stop);
    assert.match(captured.messages[0].content, /^用户自定义商品摄影策划背景\n\n输出约定/);
    assert.match(captured.messages[0].content, /仅输出 JSON 对象/);
    assert.equal(captured.config.systemPrompt, '');
    assert.equal(captured.config.textSystemPrompt, '');
    assert.equal(config.textSystemPrompt, '普通文本背景');
});

test('视频与音频的协议输入保留原文，系统背景进入对应指令位置', async () => {
    assert.equal(rules.prependSystemPrompt('  镜头背景  ', '商品旋转'), '镜头背景\n\n商品旋转');
    assert.equal(rules.prependSystemPrompt('', '商品旋转'), '商品旋转');
    const loader = variantModules({
        '@/stores/use-config-store': {},
        '@/lib/audio-generation': { normalizeAudioFormatValue: x => x, normalizeAudioSpeedValue: x => x, normalizeAudioVoiceValue: x => x },
        './原画布图片调用': {}, './图片任务衔接.mjs': {},
    });
    const { prepareAudioRequest } = loader.load('画布生成/原画布音频调用.ts');
    const request = prepareAudioRequest({ apiFormat: 'openai', model: 'tts', audioInstructions: '温暖但克制', audioVoice: 'alloy', audioFormat: 'mp3', audioSpeed: '1' }, '只朗读这句话');
    const body = JSON.parse(Buffer.from(request.body, 'base64').toString());
    assert.equal(body.input, '只朗读这句话');
    assert.equal(body.instructions, '温暖但克制');
});

test('视频实际创建入口将视频角色写入OpenAI和Gemini请求，不发出网络请求', async () => {
    const deny = () => assert.fail('验收不得调用真实渠道');
    const loader = variantModules({
        '@/stores/use-config-store': {
            resolveModelRequestConfig: config => ({ ...rules.withCapabilitySystemPrompt(config, 'video'), model: 'video-model' }),
            resolveModelScript: () => '', modelOptionName: value => value.split('::').at(-1),
            boolConfig: (value, fallback) => value ? value === 'true' : fallback,
        },
        '@/扩展功能/产品配置/模型配置门禁': { requireModelConfigured() {} },
        '@/扩展功能/产品配置/精简与离线策略': { requireGenerationMode() {} },
        '@/扩展功能/网络代理/本地转发请求': { 本地转发Axios: { post: deny, get: deny }, 本地转发请求: deny },
        '@/lib/media-size': { clampVideoSeconds: value => value, computeVideoSize: () => '1280x720', inferVideoRatio: () => '16:9' },
        './model-plugin': { runModelPlugin: deny },
    });
    const api = loader.load('services/api/video.ts', true);
    for (const provider of ['openai', 'gemini']) {
        let sent;
        const config = { apiFormat: provider, model: 'channel::video-model', videoModel: 'channel::video-model', baseUrl: 'https://synthetic.invalid', apiKey: 'synthetic',
            videoSystemPrompt: '用户的分镜背景', textSystemPrompt: '其他类别不得混入', videoMode: 'frames', size: '16:9', videoSeconds: '6', vquality: '720' };
        await api.createVideoGenerationTask(config, '商品缓慢旋转', [], { dispatch: async (path, body) => { sent = { path, body }; return { id: 'synthetic', provider, model: config.model }; } });
        const prompt = provider === 'openai' ? sent.body.get('prompt') : sent.body.instances[0].prompt;
        assert.equal(prompt, '用户的分镜背景\n\n商品缓慢旋转');
    }
});

test('分类编辑界面保留各自内容，AI写提示词默认原文可编辑并可恢复', () => {
    let category = 'image';
    const config = { systemPrompt: '旧文本', audioInstructions: '原有音频' }, changes = [];
    const jsx = (type, props) => ({ type, props: props || {} });
    const flatten = value => Array.isArray(value) ? value.flatMap(flatten) : value && typeof value === 'object' ? [value, ...flatten(value.props?.children)] : [];
    const loader = variantModules({
        react: { useState: () => [category, next => { category = next; }], useId: () => 'synthetic-role' },
        'react/jsx-runtime': { jsx, jsxs: jsx },
        antd: { Form: { Item: 'FormItem' }, Input: { TextArea: 'Textarea' }, Segmented: 'Segmented' },
        'lucide-react': Object.fromEntries(['AudioLines', 'FileText', 'Image', 'RotateCcw', 'Video'].map(name => [name, name])),
        '../主题/苹果交互按钮': { AppleAntButton: 'Button' },
        '../主题/页签内容过渡': { TabContentTransition: 'Transition' },
    });
    const { SystemPromptSettings } = loader.load('系统提示词/系统提示词设置.tsx');
    const render = () => flatten(SystemPromptSettings({ config, onChange: (key, value) => { changes.push([key, value]); config[key] = value; } }));
    let tree = render();
    assert.equal(tree.find(node => node.type === 'Segmented').props.options.length, 4);
    assert.equal(tree.filter(node => node.type === 'Textarea').length, 1);
    const role = tree.find(node => node.props['aria-label'] === '生图系统提示词');
    assert.match(role.props.value, /^你是一名电商商品视觉策划总监/);
    role.props.onChange({ target: { value: '自定义角色' } });
    tree = render(); tree.find(node => node.type === 'Segmented').props.onChange('video');
    tree = render(); tree.find(node => node.props['aria-label'] === '视频系统提示词').props.onChange({ target: { value: '镜头角色' } });
    assert.equal(config.imagePlanningSystemPrompt, '自定义角色');
    assert.equal(config.videoSystemPrompt, '镜头角色');
    assert.equal(config.audioInstructions, '原有音频');
    tree.find(node => node.type === 'Segmented').props.onChange('image');
    tree = render(); tree.find(node => node.type === 'Button').props.onClick();
    assert.equal(config.imagePlanningSystemPrompt, null);
    assert.match(render().find(node => node.props['aria-label'] === '生图系统提示词').props.value, /^你是一名电商商品视觉策划总监/);
});
