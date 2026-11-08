import test from 'node:test';
import assert from 'node:assert/strict';
import { variantModules, variantFixture } from './产品变体生成夹具.mjs';

const rulesFor = (overrides = {}) => {
    const loader = variantModules(overrides);
    return { loader, rules: loader.load('提示词/提示词优化规则.ts') };
};
function textFixture() {
    const fixture = variantFixture();
    fixture.text.metadata.content = 'Photograph [COLOR] cotton bag. Keep width 3.2cm and height 6cm. No extra text.';
    return fixture;
}
function apply(nodes, ops) {
    return nodes.map(node => {
        const op = ops.find(op => op.type === 'update_node' && op.id === node.id);
        return op ? { ...node, ...op.patch, metadata: { ...node.metadata, ...op.metadata } } : node;
    });
}
function bilingualFixture(loader) {
    const fixture = variantFixture(), rules = loader.load('Excel画布/商品提示词规则.ts');
    const pair = { chinese: '拍摄真实旅行包，保留宽3.2cm、高6cm，不得改变商品，不加文字。',
        english: 'Photograph the actual travel bag with width 3.2cm and height 6cm. Preserve the actual product and add no text.',
        translatedChinese: '拍摄真实旅行包，保留宽3.2cm、高6cm，不得改变商品，不加文字。' };
    const document = { parameterId: fixture.parameter.id, generatedSignature: 'original', key: 'main', kind: 'main',
        name: '红色 · 主图', variantId: 'red', variants: { red: pair }, prompt: pair, buyerQuestion: '外观是什么',
        evidence: '实物图', composition: '柔光', constraints: '不改商品', copyLayout: '不加文字', checks: '核实',
        delivery: { width: 1800, height: 2400, format: 'png', maxMB: 10 } };
    const node = { ...fixture.text, type: 'guan:product-prompt', metadata: { productImagePrompt: document,
        productPromptSourceFingerprint: rules.planningFingerprint(fixture.parameter.metadata) } };
    fixture.nodes = [fixture.parameter, node, fixture.config];
    return { ...fixture, node, pair };
}

test('普通文本与双语商品卡均支持，其他卡片不显示优化入口，空白和生成中禁止提交', () => {
    const { rules } = rulesFor(), fixture = textFixture();
    assert.equal(rules.canOptimizePrompt(fixture.text), true);
    assert.equal(rules.canOptimizePrompt(fixture.config), false);
    const source = rules.readPromptOptimizationSource(fixture.text, fixture.nodes);
    assert.equal(source.kind, 'text');
    assert.throws(() => rules.readPromptOptimizationSource({ ...fixture.text, metadata: { content: ' ' } }, []), /先填写/);
    assert.throws(() => rules.readPromptOptimizationSource({ ...fixture.text, metadata: { status: 'loading', content: 'old' } }, []), /仍在生成/);
});

test('模型结果改动变量、数字、单位、引用或参考文件名时拒绝，合法润色保留', () => {
    const { rules } = rulesFor(), fixture = textFixture();
    fixture.text.metadata.content += ' Use "数字0__原图.png", reference aa65f1b0-eefe-475f-af68-d7200bf1483e, @[node:source].';
    const source = rules.readPromptOptimizationSource(fixture.text, fixture.nodes);
    const candidate = text => JSON.stringify({ text, changes: ['明确构图'] });
    for (const text of [
        source.text.replace('[COLOR]', 'red'), source.text.replace('3.2cm', '4.2cm'),
        source.text.replace('3.2cm', '3.2in'), source.text + ' Include 7 gifts.',
        source.text.replace('@[node:source]', ''), source.text.replace('数字0__原图.png', '数字0__另一图.png'),
        source.text.replace('bf1483e', 'bf1483f'),
    ]) assert.throws(() => rules.parseOptimizedPrompt(candidate(text), source), /优化结果/);
    assert.equal(rules.parseOptimizedPrompt(candidate(source.text + ' Use a clear composition.'), source).text,
        source.text + ' Use a clear composition.');
    assert.throws(() => rules.parseOptimizedPrompt('not json', source), /有效/);
});

test('应用只更新原卡片，保留ID位置尺寸连线模型以及Excel导入基线，并拒绝旧结果覆盖新编辑', () => {
    const { rules } = rulesFor(), fixture = textFixture();
    fixture.text.metadata.excelPromptKey = '主图';
    fixture.text.metadata.excelPromptRaw = 'original workbook template';
    const source = rules.readPromptOptimizationSource(fixture.text, fixture.nodes);
    const result = rules.parseOptimizedPrompt(JSON.stringify({ text: source.text + ' Use soft light.' }), source);
    const before = structuredClone(fixture.nodes);
    const ops = rules.promptOptimizationOps(source, result, fixture.nodes), after = apply(fixture.nodes, ops);
    assert.equal(ops.length, 1);
    assert.deepEqual(after.map(node => [node.id, node.position, node.width, node.height]), before.map(node => [node.id, node.position, node.width, node.height]));
    assert.deepEqual(after.find(node => node.id === 'config'), fixture.config);
    assert.equal(after.find(node => node.id === 'prompt').metadata.excelPromptRaw, 'original workbook template');
    assert.equal(after.find(node => node.id === 'prompt').metadata.content, result.text);
    fixture.text.metadata.content += ' New edit.';
    assert.throws(() => rules.promptOptimizationOps(source, result, fixture.nodes), /已更改/);
});

test('双语一次写回并同步，保留原失效指纹，变体资料不混入其他变体或存储路径', () => {
    const { loader, rules } = rulesFor(), fixture = bilingualFixture(loader);
    fixture.parameter.metadata.productPlatform = 'OZON';
    const source = rules.readPromptOptimizationSource(fixture.node, fixture.nodes);
    assert.ok(source.problems.length);
    assert.equal(source.context.variables['[COLOR]'], '红色');
    assert.doesNotMatch(JSON.stringify(source.context), /stored-red|stored-blue|stored-shared/);
    const result = rules.parseOptimizedPrompt(JSON.stringify({ chinese: fixture.pair.chinese + '采用柔光。',
        english: fixture.pair.english + ' Use soft light.' }), source);
    const after = apply(fixture.nodes, rules.promptOptimizationOps(source, result, fixture.nodes));
    const updated = after.find(node => node.id === fixture.node.id);
    const document = updated.metadata.productImagePrompt, pair = document.variants.red;
    assert.equal(pair.chinese, result.chinese);
    assert.equal(pair.english, result.english);
    assert.equal(pair.translatedChinese, result.chinese);
    assert.equal(updated.metadata.productPromptSourceFingerprint, fixture.node.metadata.productPromptSourceFingerprint);
    assert.equal(document.parameterId, fixture.parameter.id);
    assert.deepEqual(document.delivery, fixture.node.metadata.productImagePrompt.delivery);
});

test('双语优化分段响应保留对应关系，应用和再次打开可直接高亮译文', () => {
    const { loader, rules } = rulesFor(), fixture = bilingualFixture(loader);
    const source = rules.readPromptOptimizationSource(fixture.node, fixture.nodes);
    const result = rules.parseOptimizedPrompt(JSON.stringify({ segments: [
        { chinese: '拍摄真实旅行包，', english: 'Photograph the actual travel bag. ' },
        { chinese: '保留宽3.2cm、高6cm，不得改变商品，不加文字。', english: 'Keep width 3.2cm and height 6cm. Preserve the product and add no text.' },
    ] }), source);
    assert.equal(result.alignment.length, 2);
    const after = apply(fixture.nodes, rules.promptOptimizationOps(source, result, fixture.nodes));
    const reopened = rules.readPromptOptimizationSource(after.find(node => node.id === fixture.node.id), after);
    assert.deepEqual(reopened.alignment, result.alignment);
    assert.equal(reopened.chinese, result.chinese); assert.equal(reopened.english, result.english);
});

test('最终卡片优化真正参与生成，源卡独立保留；来源变化后回到当前组装，变量约束后缀不可改', () => {
    const { loader, rules } = rulesFor(), fixture = textFixture();
    const raw = loader.load('提示词/变量使用规则.ts');
    const supplement = loader.load('Excel画布/旧版参数规则.ts').productParameterSupplement(fixture.parameter.metadata);
    const content = raw.resolvePromptVariables(fixture.text.metadata.content, fixture.parameter.metadata.promptVariableValues, supplement);
    const preview = { ...fixture.text, id: 'final', metadata: { content, promptVariablePreviewOf: fixture.parameter.id,
        promptVariableSourceNodeId: fixture.text.id } };
    fixture.nodes.push(preview);
    const source = rules.readPromptOptimizationSource(preview, fixture.nodes);
    const text = source.text.replace('Photograph', 'Carefully photograph');
    const result = rules.parseOptimizedPrompt(JSON.stringify({ text }), source);
    const after = apply(fixture.nodes, rules.promptOptimizationOps(source, result, fixture.nodes));
    assert.equal(after.find(node => node.id === 'prompt').metadata.content, fixture.text.metadata.content);
    const read = loader.load('提示词/生成文本读取.ts').readProtectedGenerationText;
    assert.equal(read(after.find(node => node.id === 'final'), after), text);
    assert.throws(() => rules.parseOptimizedPrompt(JSON.stringify({ text: text.replace('【变量与画面约束】', '【约束】') }), source), /约束/);
    const changed = after.map(node => node.id === fixture.parameter.id
        ? { ...node, metadata: { ...node.metadata, promptVariableValues: { ...node.metadata.promptVariableValues, '[COLOR]': '绿色' } } } : node);
    assert.notEqual(read(changed.find(node => node.id === 'final'), changed), text);
});

test('英文过期时以当前中文为准修复双语，不把旧译文的尺寸重新带回', () => {
    const { loader, rules } = rulesFor(), fixture = bilingualFixture(loader);
    fixture.node.metadata.productImagePrompt.variants.red.chinese = fixture.pair.chinese.replace('6cm', '8cm');
    const source = rules.readPromptOptimizationSource(fixture.node, fixture.nodes);
    assert.equal(source.englishCurrent, false);
    const result = rules.parseOptimizedPrompt(JSON.stringify({ chinese: source.chinese,
        english: fixture.pair.english.replace('6cm', '8cm') }), source);
    const after = apply(fixture.nodes, rules.promptOptimizationOps(source, result, fixture.nodes));
    assert.equal(after.find(node => node.id === fixture.node.id).metadata.productImagePrompt.variants.red.translatedChinese, source.chinese);
    assert.ok(result.english.includes('8cm'));
});

test('优化任务通过现有文本通道，先保存任务，候选和收据落盘；应用前原文不变，不调用图片模型', async () => {
    const fixture = textFixture();
    const calls = [], config = { textModel: 'user-text', imageModel: 'user-image', model: 'image-default' };
    let resultSource;
    const { loader, rules } = rulesFor({
        '@/stores/use-config-store': { useConfigStore: { getState: () => ({ config, isAiConfigReady: () => true }) } },
        '@/lib/canvas/canvas-generation-helpers': { buildGenerationConfig: (config, node, mode) => {
            calls.push(['config', mode, node]); return { ...config, model: config.textModel };
        } },
        '../产品/产品操作': { saveProductCanvas: async id => { calls.push(['save', id]); return { persisted: true }; } },
        '../画布生成/原画布文本调用': { requestCanvasText: async options => {
            calls.push(['request', options.config.model, options.scope]);
            const payload = JSON.parse(options.messages[1].content);
            assert.match(payload.optimizationDirections, /核心卖点图/);
            assert.match(payload.optimizationDirections, /效果对比图/);
            assert.match(payload.optimizationDirections, /不编造/);
            assert.equal(payload.instruction, '精简');
            await options.recordTask({ taskId: 'task-one', slotId: 'prompt-optimization', binding: 'binding', requestHash: 'hash' });
            const text = JSON.stringify({ text: resultSource.text + ' Use soft light.' });
            await options.applyAndSave(text, { taskId: 'task-one', responseHash: 'receipt' }); return text;
        } },
    });
    resultSource = rules.readPromptOptimizationSource(fixture.text, fixture.nodes);
    const host = { getNode: id => fixture.nodes.find(node => node.id === id), updateMetadata: (id, patch) => {
        const node = fixture.nodes.find(node => node.id === id); node.metadata = { ...node.metadata, ...patch };
    } };
    const before = fixture.text.metadata.content;
    const phases = [];
    const result = await loader.load('提示词/提示词优化请求.ts').requestPromptOptimization({
        host, productId: 'product', source: resultSource, instruction: '精简', directions: ['comparison', 'selling-points'],
        signal: new AbortController().signal, assertActive() {}, onPhase: phase => phases.push(phase),
    });
    assert.equal(fixture.text.metadata.content, before);
    assert.equal(calls.filter(call => call[0] === 'request').length, 1);
    assert.equal(calls.find(call => call[0] === 'request')[1], 'user-text');
    assert.equal(calls.filter(call => call[0] === 'save').length, 2);
    assert.equal(fixture.text.metadata.promptOptimizationDraft.signature, resultSource.signature);
    assert.equal(fixture.text.metadata.gatewayGenerationReceipts[0].taskId, 'task-one');
    assert.ok(result.text.includes('soft light'));
    assert.deepEqual(fixture.text.metadata.promptOptimizationDraft.directions, ['selling-points', 'comparison']);
    assert.deepEqual(phases, ['preparing', 'requesting', 'saving-task', 'requesting', 'saving-result', 'validating', 'ready']);
});

test('缺少配置、取消、已移除卡片与未决任务条件改变均不提交新的优化', async () => {
    for (const scenario of ['unconfigured', 'aborted', 'missing', 'pending-changed', 'pending-directions']) {
        const fixture = textFixture(); let requested = 0, opened = 0;
        const { loader, rules } = rulesFor({
            '@/stores/use-config-store': { useConfigStore: { getState: () => ({
                config: {}, isAiConfigReady: () => scenario !== 'unconfigured', openConfigDialog: () => opened++,
            }) } },
            '@/lib/canvas/canvas-generation-helpers': { buildGenerationConfig: () => ({ model: 'text' }) },
            '../产品/产品操作': { saveProductCanvas: async () => ({ persisted: true }) },
            '../画布生成/原画布文本调用': { requestCanvasText: async () => { requested++; } },
        });
        const source = rules.readPromptOptimizationSource(fixture.text, fixture.nodes);
        if (scenario.startsWith('pending')) {
            fixture.text.metadata.gatewayGenerationTasks = [{ taskId: 'old', slotId: 'prompt-optimization' }];
            fixture.text.metadata.promptOptimizationRequest = { taskId: 'old',
                signature: scenario === 'pending-directions' ? source.signature : 'older',
                instruction: '', model: 'text', directions: ['comparison'] };
            globalThis.window = { __guanGenerationHost: { get: async () => ({ state: 'running' }) } };
        }
        const controller = new AbortController(); if (scenario === 'aborted') controller.abort();
        try {
            await assert.rejects(loader.load('提示词/提示词优化请求.ts').requestPromptOptimization({
                host: { getNode: () => scenario === 'missing' ? undefined : fixture.text }, productId: 'product',
                source, instruction: '', signal: controller.signal, assertActive() {},
            }));
            assert.equal(requested, 0);
            assert.equal(opened, scenario === 'unconfigured' ? 1 : 0);
        } finally { delete globalThis.window; }
    }
});

test('十四个快捷方向可多选、去重并保持稳定顺序，涉及效果、工艺、售后与赠品时不编造资料', () => {
    const { loader } = rulesFor(), directions = loader.load('提示词/快捷优化方向.ts');
    assert.equal(directions.OPTIMIZATION_DIRECTIONS.length, 14);
    assert.deepEqual(directions.normalizeOptimizationDirections(['comparison', 'main-visual', 'comparison']), ['main-visual', 'comparison']);
    assert.equal(directions.optimizationDirectionInstruction([]), '');
    assert.throws(() => directions.normalizeOptimizationDirections(['invented']), /无效/);
    const text = directions.optimizationDirectionInstruction(['comparison', 'craft', 'after-sales', 'accessories']);
    for (const term of ['不编造', '不根据外观猜测', '不自行添加保修期限', '不得增加赠品', '不拆成多张图片']) assert.ok(text.includes(term));
});
