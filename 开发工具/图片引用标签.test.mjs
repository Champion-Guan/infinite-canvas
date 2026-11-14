import test from 'node:test';
import assert from 'node:assert/strict';
import { variantModules } from './产品变体生成夹具.mjs';

const rules = variantModules().load('Excel画布/图片引用标签规则.ts');
const first = '334599eb-507e-4064-a2d8-bcf2c3bd7023', second = '189d8614-b9f6-4b10-8a7b-1ed8f0fa49e6';
const photo = (id, name) => ({ id, name, storageKey: `stored:${id}` });
const metadata = () => ({ productMainImages: [photo(first, '商品正面.png'), photo(second, '脚轮细节.jpg')] });

test('上传顺序是编号来源，中英文同一ID共用标签，原字段不改变', () => {
    const original = metadata(), before = JSON.stringify(original), images = rules.imageReferenceCatalog(original);
    assert.deepEqual(images.map(item => item.number), [1, 2]);
    assert.match(images[0].label, /图 1 · 商品正面/);
    assert.doesNotMatch(images[0].label, /参考图/);
    for (const text of [`以${first}和${second}锁定外观。`, `Use ${second}, then ${first}.`]) {
        const view = rules.projectImageReferences(text, images);
        assert.ok(!view.text.includes(first) && !view.text.includes(second));
        assert.equal(rules.restoreImageReferences(view.text, view, images), text);
    }
    assert.equal(JSON.stringify(original), before);
});
test('重名、改名、调整图片顺序、只改普通文字均不会把引用绑定到别的图片', () => {
    const original = metadata(), images = rules.imageReferenceCatalog(original);
    const raw = `以${first}锁定商品，以${second}核对细节。`;
    const old = rules.projectImageReferences(raw, images);
    const next = rules.imageReferenceCatalog({ productMainImages: [photo(second, '商品正面.png'), photo(first, '商品正面.png')] });
    const view = rules.projectImageReferences(raw, next);
    assert.equal(view.occurrences[0].image.number, 2);
    assert.equal(view.occurrences[1].image.number, 1);
    assert.equal(rules.restoreImageReferences(view.text.replace('锁定商品', '保留实物外观'), view, next),
        raw.replace('锁定商品', '保留实物外观'));
    assert.equal(rules.restoreImageReferences(old.text, old, next), raw);
});
test('删除或重排整段标签后还原正确ID；错误标签拒绝保存，不猜测图片', () => {
    const images = rules.imageReferenceCatalog(metadata()), view = rules.projectImageReferences(`${first} ${second}`, images);
    const [a, b] = view.occurrences;
    assert.equal(rules.restoreImageReferences(`${b.label} ${a.label}`, view, images), `${second} ${first}`);
    assert.equal(rules.restoreImageReferences(b.label, view, images), second);
    assert.throws(() => rules.restoreImageReferences('【参考图 99 · 其他】', view, images), /标签需保持完整/);
});
test('移除图片显示缺失状态且不误指向剩余图片，缺失引用也能无损重排', () => {
    const raw = `${first} ${second} ${first}`;
    const view = rules.projectImageReferences(raw, []);
    assert.ok(!view.text.includes(first));
    assert.equal(view.occurrences[0].label, view.occurrences[2].label);
    assert.notEqual(view.occurrences[0].label, view.occurrences[1].label);
    assert.equal(rules.restoreImageReferences(view.text, view, []), raw);
    assert.equal(rules.restoreImageReferences(`${view.occurrences[1].label} ${view.occurrences[0].label}`, view, []), `${second} ${first}`);
});
test('旧名称和括号ID合并成一个标签，编辑普通文字仍无损保留原始绑定', () => {
    const images = rules.imageReferenceCatalog({ productMainImages: [photo(first, '参考主图.png'), photo(second, '脚轮细节.jpg')] });
    for (const raw of [`参考主图（${first}）及脚轮细节图（${second}）显示商品`,
        `参考主图.png (${first})、脚轮细节.jpg（${second}）显示商品`, `以参考图${first}为依据`]) {
        const view = rules.projectImageReferences(raw, images);
        assert.doesNotMatch(view.text, /参考主图[（(]|脚轮细节(?:图|.jpg)[（(]|参考图【/);
        assert.equal(rules.restoreImageReferences(view.text, view, images), raw);
        assert.equal(rules.restoreImageReferences(view.text + '。', view, images), raw + '。');
    }
});
test('待确认图片接续产品图编号并按ID去重，不混入其他参数卡', () => {
    const current = metadata();
    current.productConfirmations = [{ images: [photo(second, '细节.png'), photo('pending', '包装实拍.jpg')] }];
    const refs = rules.imageReferenceCatalog(current);
    assert.deepEqual(refs.map(item => [item.id, item.number]), [[first, 1], [second, 2], ['pending', 3]]);
    assert.equal(rules.imageReferenceCatalog({}).length, 0);
    assert.equal(rules.imageReferenceName(`${first}.png`), '图片');
});
test('偏移投影保留双语对齐、变量位置和引用前后的文本边界', () => {
    const images = rules.imageReferenceCatalog(metadata()), raw = `前文 ${first} 后文 {{fact:height}}`;
    const view = rules.projectImageReferences(raw, images), item = view.occurrences[0];
    assert.equal(view.position(item.rawStart), item.start);
    assert.equal(view.position(item.rawEnd), item.end);
    assert.equal(view.position(raw.length), view.text.length);
    const start = raw.indexOf('{{fact');
    assert.equal(view.text.slice(view.position(start)), '{{fact:height}}');
    assert.equal(rules.projectImageReferences(`x${first}y`, images).text, `x${first}y`);
});

test('实际商品卡编辑可读标签后只将原ID交回元数据，中英文编号一致', () => {
    const jsx = (type, props) => ({ type, props });
    const loader = variantModules({
        react: { useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
            useRef: current => ({ current }), useMemo: fn => fn(), useEffect() {} },
        'react/jsx-runtime': { jsx, jsxs: jsx },
        'lucide-react': { Languages: 'Languages', RotateCcw: 'RotateCcw' }, antd: { Segmented: 'Segmented' },
        './Excel画布上下文': { useExcelProductId: () => 'product' },
        './商品策划请求': { translateProductPrompt() { throw Error('不得触发付费翻译'); } },
        './商品待确认编辑': { ProductConfirmationDialog: 'Dialog' },
        './图片引用标签': { ImageReferenceToken: 'Reference', ImageReferenceText: 'References' },
        './商品提示词状态': { productPromptProblems: () => [] },
        '../主题/页签内容过渡': { TabContentTransition: 'Transition' },
        '../提示词/双语联动文本框': { useBilingualPromptSync: () => ({}), BilingualPromptField: 'PromptField' },
    });
    const parameter = { id: 'parameter', metadata: metadata() }, chinese = `按${first}保留商品。`;
    const pair = { chinese, translatedChinese: chinese, english: `Use ${first} to preserve the product.` };
    const node = { id: 'prompt', title: '主图', metadata: { productImagePrompt: { parameterId: parameter.id,
        key: 'main', name: '主图', prompt: pair, variants: {}, delivery: { width: 1800, height: 2400, format: 'png' } } } };
    const ctx = { node, theme: { node: { text: '#111', stroke: '#ddd' } },
        getNode: id => id === parameter.id ? parameter : node, getConnections: () => [],
        updateMetadata: patch => { node.metadata = { ...node.metadata, ...patch }; } };
    const tree = loader.load('Excel画布/商品提示词卡片.tsx').ProductPromptContent({ ctx });
    const all = [];
    const visit = value => {
        if (!value || typeof value !== 'object') return;
        if (Array.isArray(value)) { value.forEach(visit); return; }
        all.push(value); visit(value.props?.children);
    };
    visit(tree);
    const fields = all.filter(item => item.type === 'PromptField');
    assert.equal(fields.length, 2);
    for (const field of fields) assert.match(field.props.value, /图 1 · 商品正面/);
    const english = fields.find(item => item.props.language === 'english');
    english.props.onChange({ target: { value: english.props.value + ' Keep the wheels.' } });
    assert.equal(node.metadata.productImagePrompt.prompt.english, pair.english + ' Keep the wheels.');
    assert.ok(!node.metadata.productImagePrompt.prompt.english.includes('【'));
    assert.equal(node.metadata.productImagePrompt.prompt.chinese, chinese);
});

test('AI优化面板的原文及非空优化结果均按同一图片目录展示，中英文不泄露长ID', () => {
    const jsx = (type, props) => ({ type, props }), raw = `Use ${first} to preserve the product.`;
    const parameter = { id: 'parameter', metadata: metadata() }, source = { id: 'prompt', kind: 'bilingual',
        title: '主图', signature: 'original', problems: [], chinese: `以${first}为依据`, english: raw, englishCurrent: true };
    const session = { source, instruction: '', directions: [], result: { chinese: `保留${first}的轮廓`,
        english: raw + ' Use soft light.', changes: [] } };
    let state = 0;
    const loader = variantModules({
        react: { useCallback: value => value, useEffect() {}, useRef: current => ({ current }),
            useState: initial => [state++ === 0 ? session : initial, () => {}] },
        'react/jsx-runtime': { jsx, jsxs: jsx },
        antd: { App: { useApp: () => ({ message: {} }) }, Input: { TextArea: 'TextArea' }, Button: 'Button', Tooltip: 'Tooltip' },
        'motion/react': { AnimatePresence: 'Presence' }, 'lucide-react': { ChevronDown: 'ChevronDown', Sparkles: 'Sparkles' },
        '../主题/苹果弹窗': { AppleModal: 'Modal' }, '../主题/苹果交互按钮': { AppleAntButton: 'Button' },
        '../产品/产品操作': { saveProductCanvas: async () => { throw Error('不得保存'); } },
        './提示词优化请求': { requestPromptOptimization: async () => { throw Error('不得请求'); } },
        './提示词优化规则': { canOptimizePrompt: () => true, readPromptOptimizationSource: () => source },
        './提示词优化窗口.module.css': { default: {} },
        './双语联动文本框': { useBilingualPromptSync: () => ({}), BilingualPromptField: 'PromptField' },
        '../Excel画布/图片引用标签': { ImageReferenceToken: 'Reference' },
        '../主题/任务阶段反馈': { TextTaskStatus: 'Status' },
        '@/stores/use-config-store': { useConfigStore: selector => selector({ config: {} }), decodeChannelModel: () => undefined },
        '@/lib/canvas/canvas-generation-helpers': { buildGenerationConfig: () => ({ model: 'configured' }) },
    });
    const tree = loader.load('提示词/提示词优化窗口.tsx').usePromptOptimization({ productId: 'product', active: true,
        assertActive() {}, host: { getNode: id => id === 'parameter' ? parameter
            : { id: 'prompt', metadata: { productImagePrompt: { parameterId: 'parameter' } } }, getNodes: () => [] } }).optimizationDialog;
    const all = [], visit = value => {
        if (!value || typeof value !== 'object') return;
        if (Array.isArray(value)) { value.forEach(visit); return; }
        if (typeof value.type === 'function') { visit(value.type(value.props)); return; }
        all.push(value); visit(value.props?.children);
    };
    visit(tree);
    const fields = all.filter(item => item.type === 'PromptField');
    assert.equal(fields.length, 4);
    assert.deepEqual(fields.map(item => item.props['aria-label']), ['原提示词 · 中文','原提示词 · 英文','优化结果 · 中文','优化结果 · 英文']);
    for (const field of fields) {
        assert.match(field.props.value, /图 1 · 商品正面/);
        assert.ok(!field.props.value.includes(first));
        assert.equal(field.props.inlineReferences.length, 1);
    }
    assert.equal(session.source.english, raw);
});
