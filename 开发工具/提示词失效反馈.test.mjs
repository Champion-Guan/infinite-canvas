import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { variantModules, variantFixture } from './产品变体生成夹具.mjs';

const require = createRequire(new URL('../.运行/3100源/画布副本/web/package.json', import.meta.url));
const ts = require('typescript');
function motionFixture(reduced = false) {
    const source = readFileSync(new URL('../扩展功能/Excel画布/商品提示词阻止反馈.ts', import.meta.url), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const module = { exports: {} }, animations = [];
    let translate = 'none';
    new Function('module', 'exports', 'window', 'getComputedStyle', code)(module, module.exports,
        { matchMedia: () => ({ matches: reduced }) }, () => ({ translate }));
    const element = { isConnected: true, animate(frames, options) {
        const animation = { frames, options, cancelled: false, cancel() { this.cancelled = true; } };
        animations.push(animation); return animation;
    } };
    return { ...module.exports, element, animations, setTranslate(value) { translate = value; } };
}

test('常驻框只接收自己提示词的拒绝反馈，普通错误或已经卸载的提示保持原错误路径', () => {
    const f = motionFixture(), calls = [];
    const unregister = f.registerProductPromptWarning(['prompt-a'], () => { calls.push('a'); return true; });
    assert.equal(f.pulseProductPromptWarning(new Error('其他错误')), false);
    assert.equal(f.pulseProductPromptWarning(new f.ProductPromptBlockedError('无关提示词', ['prompt-b'])), false);
    const error = new f.ProductPromptBlockedError('已失效', ['prompt-a']);
    assert.equal(f.pulseProductPromptWarning(error), true);
    assert.equal(f.pulseProductPromptWarning(error), true);
    assert.deepEqual(calls, ['a', 'a']);
    unregister();
    assert.equal(f.pulseProductPromptWarning(error), false);
    const release = f.registerProductPromptWarning(['prompt-a'], () => false);
    assert.equal(f.pulseProductPromptWarning(error), false);
    release();
});

test('左右弹动递减并回原位，连续点击从当前值开始，卸载取消动画，不覆盖原transform', () => {
    const f = motionFixture(), motion = f.createPromptWarningMotion(f.element);
    assert.equal(motion.play(), true);
    const first = f.animations[0];
    assert.equal(first.options.duration, 420);
    assert.deepEqual(first.frames.map(frame => frame.translate), ['0px', '-8px', '7px', '-5px', '3px', '-1px', '0px']);
    assert.ok(first.frames.every(frame => !Object.hasOwn(frame, 'transform')));
    f.setTranslate('-3px');
    motion.play();
    assert.equal(first.cancelled, true);
    assert.equal(f.animations[1].frames[0].translate, '-3px');
    first.onfinish();
    motion.dispose();
    assert.equal(f.animations[1].cancelled, true);
    f.element.isConnected = false;
    assert.equal(motion.play(), false);
});

test('减少动态效果使用短促透明度反馈，不横向移动，也不会添加循环动画', () => {
    const f = motionFixture(true), motion = f.createPromptWarningMotion(f.element);
    motion.play();
    assert.deepEqual(f.animations[0].frames, [{ opacity: .72 }, { opacity: 1 }]);
    assert.equal(f.animations[0].options.duration, 160);
    assert.equal(f.animations[0].options.iterations, undefined);
    motion.dispose();
});

function blockedFixture() {
    const loader = variantModules({
        '@/lib/canvas/node-registry': { getNodeDefinition: type => type === 'guan:product-prompt'
            ? { resource: () => ({ kind: 'text', text: '商品完整英文提示词' }) } : undefined },
    }), fixture = variantFixture();
    const rules = loader.load('Excel画布/商品提示词规则.ts');
    const pair = { english: 'Photograph the actual red travel bag, preserving all product details and the real sale contents.',
        chinese: '拍摄实物红色旅行包，保留商品细节与真实销售清单。', translatedChinese: '拍摄实物红色旅行包，保留商品细节与真实销售清单。' };
    const fingerprint = rules.planningFingerprint(fixture.parameter.metadata);
    fixture.text.type = 'guan:product-prompt';
    fixture.text.metadata = { productPromptSourceFingerprint: fingerprint, productImagePrompt: {
        parameterId: fixture.parameter.id, key: 'main', kind: 'main', name: '主图', variantId: 'red', prompt: pair, variants: { red: pair },
    } };
    fixture.parameter.metadata.productPlatform = '亚马逊';
    const messages = [], calls = [];
    const message = Object.fromEntries(['info', 'success', 'warning', 'error'].map(kind => [kind, text => messages.push([kind, text])]));
    const port = {
        projectId: 'product', nodesRef: { current: fixture.nodes }, connectionsRef: { current: fixture.connections }, effectiveConfig: {},
        setNodes: () => assert.fail('被拒绝时不能改画布'), setConnections: () => assert.fail('被拒绝时不能改连线'),
        setSelectedNodeIds() {}, setSelectedConnectionId() {},
        execute: async (...args) => calls.push(args), handleGenerateNode: async (...args) => calls.push(args),
        saveCanvas: async () => assert.fail('被拒绝时不能创建保存任务'), message, generationRequestsRef: { current: new Map() },
    };
    return { loader, fixture, messages, calls, port, feedback: loader.load('Excel画布/商品提示词阻止反馈.ts') };
}

test('单张开始生成及一键执行均只反馈原常驻框，重复点击不提交任务、不增加提示或改动画布', async () => {
    const f = blockedFixture(), original = structuredClone({ nodes: f.fixture.nodes, connections: f.fixture.connections });
    let pulses = 0;
    const release = f.feedback.registerProductPromptWarning([f.fixture.text.id], () => { pulses++; return true; });
    try {
        const single = f.loader.load('画布生成/产品变体执行.ts').useProductVariantGeneration(f.port);
        const batch = f.loader.load('画布生成/批量生成操作.ts').useCanvasBatchGeneration(f.port);
        await single(f.fixture.config.id, 'image', '');
        await single(f.fixture.config.id, 'image', '');
        await batch.generateAllConfigNodes();
        await batch.generateAllConfigNodes();
        assert.equal(pulses, 4);
        assert.deepEqual(f.messages, []);
        assert.deepEqual(f.calls, []);
        assert.deepEqual({ nodes: f.fixture.nodes, connections: f.fixture.connections }, original);
    } finally { release(); }
});

test('对应常驻框不可见时，单张与批量仍给出具体错误，不能静默吞掉执行失败', async () => {
    const f = blockedFixture();
    const single = f.loader.load('画布生成/产品变体执行.ts').useProductVariantGeneration(f.port);
    const batch = f.loader.load('画布生成/批量生成操作.ts').useCanvasBatchGeneration(f.port);
    await single(f.fixture.config.id, 'image', '');
    await batch.generateAllConfigNodes();
    assert.equal(f.messages.length, 2);
    assert.ok(f.messages.every(([kind, text]) => kind === 'error' && /上架平台已从“Wildberries”改为“亚马逊”/.test(text)));
    assert.deepEqual(f.calls, []);
});
