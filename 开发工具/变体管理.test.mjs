import test from 'node:test';
import assert from 'node:assert/strict';
import { variantModules } from './产品变体生成夹具.mjs';

const image = id => ({ id, name: `${id}.png`, storageKey: `file-${id}` });
const metadata = () => ({ productMainImages: ['red', 'blue', 'green', 'shared'].map(image), productSharedImageIds: ['shared'],
    productVariantAttributes: ['颜色', '尺寸'], productVariants: [{ id: 'original', name: '原款', enabled: true,
        attributes: { 颜色: '原色' }, imageIds: ['red'], primaryImageId: 'red', brief: { material: '保留原材质' }, variableValues: { '[A]': '保留变量' } }] });
const load = () => variantModules().load('Excel画布/变体管理规则.ts');
test('打开草稿深拷贝已有资料，取消或编辑草稿不修改原变体、共用图片及旧差异字段', () => {
    const rules = load(), source = metadata(), before = structuredClone(source);
    const draft = rules.createVariantManagerDraft(source, source.productVariantAttributes);
    draft.variants[0].name = '编辑'; draft.variants[0].attributes.颜色 = '蓝'; draft.sharedImageIds.push('blue');
    assert.deepEqual(source, before);
    assert.equal(draft.variants[0].brief.material, '保留原材质');
    assert.equal(draft.variants[0].variableValues['[A]'], '保留变量');
});
test('一图模式每次勾选即生成独立变体并分配主图，重复选择撤回本次项，原款及共用图不能重复生成', () => {
    const rules = load(), source = metadata(); let draft = rules.createVariantManagerDraft(source, source.productVariantAttributes);
    draft = rules.toggleSingleVariantImage(draft, 'blue', source);
    assert.equal(draft.variants.length, 2); assert.equal(draft.variants[1].name, 'blue');
    assert.deepEqual(draft.variants[1].imageIds, ['blue']); assert.equal(draft.variants[1].primaryImageId, 'blue');
    const id = draft.variants[1].id;
    draft = rules.toggleSingleVariantImage(draft, 'green', source);
    assert.notEqual(draft.variants[2].id, id);
    for (const key of ['red', 'shared', 'missing']) assert.equal(rules.toggleSingleVariantImage(draft, key, source), draft);
    draft = rules.toggleSingleVariantImage(draft, 'blue', source);
    assert.equal(draft.variants.some(variant => variant.id === id), false);
    assert.equal(draft.variants[0].id, 'original');
});
test('多图模式点击添加时创建一个分组，按勾选顺序指定主参考，跳过重复及已分配图', () => {
    const rules = load(), source = metadata(), draft = rules.createVariantManagerDraft(source, source.productVariantAttributes);
    const next = rules.addVariantGroup(draft, ['green', 'blue', 'green', 'red', 'shared'], source);
    assert.equal(next.variants.length, 2); assert.deepEqual(next.variants[1].imageIds, ['green', 'blue']);
    assert.equal(next.variants[1].primaryImageId, 'green'); assert.deepEqual(next.addedByImage, {});
    assert.equal(rules.addVariantGroup(next, ['blue', 'green'], source), next);
    assert.equal(draft.variants.length, 1);
});
test('同名文件自动避免重名，保存只提交变体字段且保留已有ID及隐藏差异资料', () => {
    const rules = load(), source = metadata(); source.productMainImages[1].name = '原款.png';
    const revision = rules.variantManagerRevision(source);
    const draft = rules.addVariantGroup(rules.createVariantManagerDraft(source, source.productVariantAttributes), ['blue'], source);
    assert.equal(draft.variants[1].name, '原款 2');
    const patch = rules.variantManagerPatch(draft, source, revision);
    assert.deepEqual(Object.keys(patch).sort(), ['productSharedImageIds', 'productVariantAttributes', 'productVariants']);
    assert.deepEqual(patch.productVariants[0], source.productVariants[0]);
    assert.deepEqual(patch.productSharedImageIds, ['shared']);
});
test('保存前校验并发编辑、删除图片、重名和空名称，不覆盖原状态', () => {
    const rules = load(), source = metadata(), revision = rules.variantManagerRevision(source);
    const draft = rules.addVariantGroup(rules.createVariantManagerDraft(source, source.productVariantAttributes), ['blue'], source);
    assert.throws(() => rules.variantManagerPatch(draft, { ...source, productVariants: [] }, revision), /其他位置修改/);
    assert.throws(() => rules.variantManagerPatch(draft, { ...source, productMainImages: [image('red')] }, revision), /图片已被移除/);
    draft.variants[1].name = '原款';
    assert.throws(() => rules.variantManagerPatch(draft, source, revision), /不同的名称/);
    draft.variants[1].name = '';
    assert.throws(() => rules.variantManagerPatch(draft, source, revision), /不同的名称/);
    draft.variants[1].attributes = { 颜色: '蓝色' };
    assert.doesNotThrow(() => rules.variantManagerPatch(draft, source, revision));
});

const jsx = (type, props) => ({ type, props });
const all = tree => Array.isArray(tree) ? tree.flatMap(all) : tree && typeof tree === 'object' ? [tree, ...all(tree.props?.children)] : [];
function uiFixture() {
    const states = [], refs = []; let cursor = 0, refCursor = 0;
    const calls = [], source = metadata();
    const react = { useEffect() {}, useRef(value) { return refs[refCursor++] ||= { current: value }; }, useState(initial) {
        const index = cursor++;
        if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
        return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }];
    } };
    const loader = variantModules({ react, 'react/jsx-runtime': { jsx, jsxs: jsx },
        antd: { Button: 'Button', Checkbox: 'Checkbox', Popconfirm: 'Popconfirm', Segmented: 'Segmented', Tooltip: 'Tooltip' },
        'lucide-react': { Check: 'Check', Plus: 'Plus', Trash2: 'Trash', X: 'X' },
        '../主题/苹果弹窗': { AppleModal: 'Modal' }, '../媒体交付/媒体缩略图': { MediaThumbnail: 'Thumbnail' },
        '../产品/产品界面边界': { useProductActive: () => true },
        '../媒体交付/图片上传编号': { ImageUploadNumber: 'Number' }, './变体管理面板.module.css': { default: {} },
    });
    const ctx = { node: { id: 'parameter', metadata: source }, getNode: () => ctx.node, theme: { node: {}, toolbar: {} } };
    const component = loader.load('Excel画布/变体管理面板.tsx').ProductVariantManager;
    return { source, calls, ctx, render() { cursor = 0; refCursor = 0; return all(component({ ctx,
        onChange: patch => calls.push(patch), onClose: () => calls.push('close') })); } };
}
test('面板组件一图即时出现在右侧；多图仅选图不建卡，添加后形成一个变体，保存统一提交', () => {
    const f = uiFixture(); let tree = f.render();
    const button = label => tree.find(item => item.type === 'button' && item.props['aria-label'] === label);
    button('选择产品图片 2 blue.png').props.onClick(); tree = f.render();
    assert.equal(tree.filter(item => item.type === 'article').length, 2); assert.deepEqual(f.calls, []);
    const name = tree.find(item => item.type === 'input' && item.props['aria-label'].startsWith('变体管理名称 ') && item.props.value === 'blue');
    name.props.onChange({ target: { value: '蓝色款' } }); tree = f.render();
    tree.find(item => item.type === 'Segmented').props.onChange('group'); tree = f.render();
    button('选择产品图片 3 green.png').props.onClick(); tree = f.render();
    assert.equal(tree.filter(item => item.type === 'article').length, 2);
    tree.find(item => item.type === 'Button' && item.props.children === '保存').props.onClick(); tree = f.render();
    assert.match(tree.find(item => item.props?.role === 'alert').props.children, /尚未添加/);
    assert.deepEqual(f.calls, []);
    tree.find(item => item.type === 'Button' && String(item.props.children).startsWith('添加变体')).props.onClick(); tree = f.render();
    assert.equal(tree.filter(item => item.type === 'article').length, 3);
    tree.find(item => item.type === 'Button' && item.props.children === '保存').props.onClick();
    assert.equal(f.calls.length, 2); assert.equal(f.calls[0].productVariants[1].name, '蓝色款'); assert.equal(f.calls[1], 'close');
    assert.equal(f.source.productVariants.length, 1);
});
test('面板取消不提交，原卡已删除时拒绝保存且显示错误', () => {
    const f = uiFixture(); let tree = f.render();
    tree.find(item => item.type === 'Button' && item.props.children === '取消').props.onClick(); assert.deepEqual(f.calls, ['close']);
    f.ctx.getNode = () => undefined;
    tree.find(item => item.type === 'Button' && item.props.children === '保存').props.onClick(); tree = f.render();
    assert.match(tree.find(item => item.props?.role === 'alert').props.children, /已移除/);
    assert.deepEqual(f.calls, ['close']);
});

test('产品变体标题内提供管理入口，旧差异字段与文件名分组入口不再渲染', () => {
    const source = metadata(), variantsBefore = structuredClone(source.productVariants);
    const loader = variantModules({
        react: { useState: value => [value, () => {}] }, 'react/jsx-runtime': { jsx, jsxs: jsx },
        antd: { Button: 'Button', Checkbox: 'Checkbox', Tooltip: 'Tooltip' },
        'motion/react': { AnimatePresence: 'Presence' }, 'lucide-react': {},
        '../主题/苹果弹窗': { AppleModal: 'Modal' }, '../媒体交付/媒体缩略图': { MediaThumbnail: 'Thumbnail' },
        './参数图片预览': { ParameterImageThumbnail: 'ParameterThumbnail' },
        './变体管理面板': { ProductVariantManager: 'Manager' },
        '../画布生成/产品变体生成': { generationProductParameters: () => [], generationPromptVariantId: () => undefined },
        '../媒体交付/图片上传编号': { ImageUploadNumber: 'Number' },
    });
    const ctx = { node: { id: 'parameter', metadata: source }, getNode: () => ctx.node, getNodes: () => [], getConnections: () => [], theme: { node: {} } };
    const tree = all(loader.load('Excel画布/产品变体编辑.tsx').ProductVariantEditor({ ctx, onChange() { assert.fail('渲染不写入'); }, tokens: [] }));
    assert.ok(tree.some(node => node.type === 'Button' && node.props.children === '变体管理'));
    const text = JSON.stringify(tree);
    assert.doesNotMatch(text, /差异资料与 Excel 变量|按文件名分组|变体商品名称/);
    assert.deepEqual(source.productVariants, variantsBefore);
});
