import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as previews from '../扩展功能/画布生成/文本临时显示.mjs';

const require = createRequire(new URL('../.运行/3100源/画布副本/web/package.json', import.meta.url));
const ts = require('typescript');
function load(file, dependencies = {}) {
    const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
    } }).outputText;
    const module = { exports: {} };
    new Function('require', 'module', 'exports', code)(name => {
        assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name];
    }, module, module.exports);
    return module.exports;
}
const rules = load('扩展功能/Excel画布/商品策划预览规则.ts', { 'partial-json': require('partial-json') });
const data = {
    overview: { buyers: '家庭用户', sellingPoints: '真实结构', concerns: '尺寸', consistency: '保留三层', sequence: '主图、尺寸、场景' },
    style: '柔和日光', assumptions: ['参考照片为销售款'], pendingFacts: ['承重待确认'],
    images: [
        { key: 'main', kind: 'main', name: '品类主视觉', composition: '中性背景与侧光',
            prompt: { segments: [{ chinese: '保留白色三层结构，', english: 'Keep the white three-tier structure, ' },
                { chinese: '显示“72cm”。', english: 'show “72cm”.' }] },
            variants: { red: { segments: [{ chinese: '只使用红款。', english: 'Use the red variant only.' }] } } },
        { key: 'detail', kind: 'carousel', name: '整体尺寸', prompt: { chinese: '尺寸准确', english: 'Accurate dimensions.' } },
        { key: 'rich', kind: 'rich', name: '浴室方案', copyLayout: '无促销承诺' },
    ],
};
const wire = JSON.stringify(data);
test('每个JSON切片均可安全预览，整体方案和半张图片先于完整结果出现', () => {
    for (let end = 0; end <= wire.length; end++) assert.doesNotThrow(() => rules.readProductPlanningPreview(wire.slice(0, end)));
    const first = rules.readProductPlanningPreview('{"overview":{"buyers":"家庭');
    assert.deepEqual(first.overview, [{ label: '目标买家', text: '家庭' }]);
    const mid = wire.indexOf('中性背景') + 3;
    const partial = rules.readProductPlanningPreview(wire.slice(0, mid));
    assert.equal(partial.images[0].name, '品类主视觉');
    assert.equal(partial.images[0].fields[0].text, '中性背');
    assert.equal(partial.images.length, 1);
    const segment = wire.indexOf('显示“72cm') + 2;
    assert.equal(rules.readProductPlanningPreview(wire.slice(0, segment)).images[0].prompt.chinese, '保留白色三层结构，显示');
});
test('完整预览保留分类、片段空格、变体和旧格式双语，不读取持久状态或应用卡片', () => {
    const value = rules.readProductPlanningPreview(wire);
    assert.deepEqual(value.images.map(image => image.kind), ['主图', '轮播图', '富内容']);
    assert.equal(value.images[0].prompt.chinese, '保留白色三层结构，显示“72cm”。');
    assert.equal(value.images[0].prompt.english, 'Keep the white three-tier structure, show “72cm”.');
    assert.equal(value.images[0].variants[0].prompt.chinese, '只使用红款。');
    assert.equal(value.images[1].prompt.chinese, '尺寸准确');
    assert.ok(value.overview.some(item => item.label === '待确认' && item.text === '承重待确认'));
});
test('Unicode转义和反斜杠切片不显示JSON语法；畸形类型不会成为界面文本', () => {
    const source = '{"overview":{"buyers":"带\\\\把手与\\u4e2d\\u6587及\\"文字\\""}';
    for (let end = 0; end <= source.length; end++) assert.doesNotThrow(() => rules.readProductPlanningPreview(source.slice(0, end)));
    assert.equal(rules.readProductPlanningPreview(source).overview[0].text, '带\\把手与中文及"文字"');
    for (const source of ['not-json', '', '[1,2,3]', '{"images":[null,1,{"name":{"bad":"value"},"prompt":[],"kind":"constructor"}]}'])
        assert.deepEqual(rules.readProductPlanningPreview(source), { overview: [], images: [] });
    const safe = rules.readProductPlanningPreview('{"overview":{"buyers":"<img src=x onerror=alert(1)>"}}');
    assert.equal(safe.overview[0].text, '<img src=x onerror=alert(1)>', '正文交给React文本节点转义');
});
test('只显示原节点当前策划任务，忽略翻译、优化和过期任务；取消或完成清除预览', () => {
    const node = { id: 'planning-test', metadata: { gatewayGenerationTasks: [{ taskId: 'current', slotId: 'product-image-plan' }] } };
    const before = structuredClone(node);
    try {
        for (const [taskId, slotId, text] of [
            ['old', 'product-image-plan', '旧策划'], ['current', 'product-prompt-translation:base', '翻译'],
        ]) {
            previews.publishTextPreview({ nodeId: node.id, taskId, slotId, text });
            assert.equal(rules.productPlanningPreviewText(node, previews.textPreviewSnapshot(node.id)), '');
        }
        previews.publishTextPreview({ nodeId: node.id, taskId: 'current', slotId: 'product-image-plan', text: wire });
        assert.equal(rules.productPlanningPreviewText(node, previews.textPreviewSnapshot(node.id)), wire);
        assert.equal(rules.productPlanningPreviewText({ id: 'other' }, previews.textPreviewSnapshot(node.id)), '');
        assert.equal(rules.productPlanningPreviewText(node, previews.textPreviewSnapshot('other')), '');
        assert.deepEqual(node, before);
        previews.clearTextPreview(node.id, 'current');
        assert.equal(rules.productPlanningPreviewText(node, previews.textPreviewSnapshot(node.id)), '');
    } finally { previews.clearTextPreview(node.id, 'old'); previews.clearTextPreview(node.id, 'current'); }
});

function componentFixture(t, defer = value => value) {
    const subscriptions = [];
    const jsx = (type, props) => typeof type === 'function' ? type(props) : { type, props };
    const react = {
        useCallback: fn => fn, useMemo: fn => fn(), useDeferredValue: defer,
        useRef: current => ({ current }), useLayoutEffect() {},
        useSyncExternalStore(subscribe, read) { subscriptions.push(subscribe(() => {})); return read(); },
    };
    const ui = load('扩展功能/Excel画布/商品策划流式预览.tsx', {
        react, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'lucide-react': { LoaderCircle: 'spinner' },
        '../画布生成/文本临时显示.mjs': previews, './商品策划预览规则': rules,
        './图片引用标签规则': { imageReferenceCatalog: () => [] },
        './图片引用标签': { ImageReferenceText: 'ImageReferenceText' },
        './商品策划恢复入口': { productPlanningRecovery: () => undefined },
        './策划自动保存': { useAutomaticPlanningSave() {} },
        './商品策划副本规则': { inheritedProductPlanningPatch: () => undefined },
    });
    t.after(() => subscriptions.forEach(unsubscribe => unsubscribe()));
    return ui;
}
test('真实预览组件随进度展示、可滚动、英文可展开，完成后隐藏且不改写原节点', t => {
    const ui = componentFixture(t), node = { id: 'stream-ui', metadata: {
        gatewayGenerationTasks: [{ taskId: 'task', slotId: 'product-image-plan' }], productVariants: [{ id: 'red', name: '红色款' }],
    } };
    const before = structuredClone(node);
    t.after(() => previews.clearTextPreview(node.id, 'task'));
    assert.equal(ui.ProductPlanningStreamPreview({ node }), null);
    previews.publishTextPreview({ nodeId: node.id, taskId: 'task', slotId: 'product-image-plan', text: wire.slice(0, wire.indexOf('dimensions')) });
    const tree = ui.ProductPlanningStreamPreview({ node }), rendered = JSON.stringify(tree);
    assert.match(rendered, /整体方案/); assert.match(rendered, /品类主视觉/); assert.match(rendered, /红色款/);
    assert.match(rendered, /英文提示词/); assert.match(rendered, /max-h-80/);
    assert.match(rendered, /未保存/); assert.match(rendered, /overflow-y-auto/);
    assert.doesNotMatch(rendered, /dangerouslySetInnerHTML/);
    assert.deepEqual(node, before);
    previews.clearTextPreview(node.id, 'task');
    assert.equal(ui.ProductPlanningStreamPreview({ node }), null);
});

test('延迟渲染旧快照时，新任务与新节点不会闪现上一轮方案', t => {
    let held;
    const ui = componentFixture(t, value => held ||= value);
    const node = taskId => ({ id: 'deferred-planning', metadata: {
        gatewayGenerationTasks: [{ taskId, slotId: 'product-image-plan' }],
    } });
    t.after(() => { previews.clearTextPreview('deferred-planning', 'old'); previews.clearTextPreview('deferred-planning', 'new'); });
    previews.publishTextPreview({ nodeId: 'deferred-planning', taskId: 'old', slotId: 'product-image-plan', text: wire });
    assert.match(JSON.stringify(ui.ProductPlanningStreamPreview({ node: node('old') })), /品类主视觉/);
    previews.publishTextPreview({ nodeId: 'deferred-planning', taskId: 'new', slotId: 'product-image-plan', text: '{"overview":{' });
    const next = JSON.stringify(ui.ProductPlanningStreamPreview({ node: node('new') }));
    assert.doesNotMatch(next, /品类主视觉|家庭用户/);
    assert.match(next, /正在接收策划内容/);
});

test('策划按钮只在收到真实正文后显示生成中，校验和保存阶段保持原状态', () => {
    let cursor = 0, currentText = '', currentPhase = 'requesting';
    const jsx = (type, props) => ({ type, props });
    const ui = load('扩展功能/Excel画布/商品策划按钮.tsx', {
        react: { useEffect() {}, useRef: current => ({ current }),
            useState(initial) { return [cursor++ === 2 ? currentPhase : initial, () => {}]; } },
        'react/jsx-runtime': { jsx, jsxs: jsx },
        'lucide-react': { LoaderCircle: 'Spinner', Sparkles: 'Sparkles', X: 'X' },
        './商品提示词画布': {},
        '../主题/苹果交互按钮': { AppleActionButton: 'Button' },
        '../主题/任务阶段反馈': { TextTaskStatus: 'Status' },
        '../主题/状态详情': { StatusDetail: 'StatusDetail' },
        './商品待确认编辑': {},
        './商品策划流式预览': { useProductPlanningText: () => currentText },
        './商品策划恢复入口': { productPlanningRecovery: () => undefined },
        './策划自动保存': { useAutomaticPlanningSave() {} },
        './商品策划副本规则': { inheritedProductPlanningPatch: () => undefined },
        './图片引用标签规则': { imageReferenceCatalog: () => [] },
        './图片引用标签': { ImageReferenceText: 'ImageReferenceText' },
    });
    const phase = () => {
        cursor = 0;
        return ui.ProductPlanningButton({ ctx: { node: { id: 'parameter' } }, productId: 'product' })
            .props.children.find(item => item?.type === 'Status').props.phase;
    };
    assert.equal(phase(), 'requesting');
    currentText = '{"overview":';
    assert.equal(phase(), 'streaming');
    for (const value of ['validating', 'saving-result', 'ready', 'stopped']) {
        currentPhase = value;
        assert.equal(phase(), value);
    }
});
