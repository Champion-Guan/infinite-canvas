import test from 'node:test';
import assert from 'node:assert/strict';
import { variantFixture, variantModules } from './产品变体生成夹具.mjs';
const jsx = (type, props) => ({ type, props });
const all = tree => Array.isArray(tree) ? tree.flatMap(all) : tree && typeof tree === 'object' ? [tree, ...all(tree.props?.children)] : [];
function fixture() {
    const data = variantFixture(), ops = [];
    const loader = variantModules({ react: { useRef: current => ({ current }), useEffect() {}, useLayoutEffect() {} },
        'react/jsx-runtime': { jsx, jsxs: jsx }, antd: { Checkbox: 'Checkbox', Tooltip: 'Tooltip' } });
    const ui = loader.load('Excel画布/提示词变体选择.tsx');
    const ctx = { node: { id: 'prompt' }, getNode: id => data.nodes.find(node => node.id === id), applyOps(items) {
        ops.push(...items);
        for (const item of items) {
            const node = data.nodes.find(node => node.id === item.id);
            node.metadata = { ...node.metadata, ...item.metadata };
        }
    } };
    return { data, loader, ui, ctx, ops };
}
test('默认全选，单个勾选写回参数卡并产生半选，另一个提示词卡读取同一状态', () => {
    const f = fixture(), props = { ctx: f.ctx, parameterId: f.data.parameter.id, ids: ['red', 'blue'] };
    const checkbox = () => all(f.ui.PromptVariantSelectAll(props)).find(item => item.type === 'Checkbox');
    assert.equal(checkbox().props.checked, true);
    const tabs = all(f.ui.PromptVariantTabs({ ...props, value: 'red', onChange() {} }));
    tabs.find(item => item.props?.['aria-label'] === '生成变体 red' || item.props?.['aria-label'] === '生成变体 红色').props.onChange({ target: { checked: false } });
    assert.equal(f.data.parameter.metadata.productVariants[0].enabled, false);
    assert.equal(f.data.parameter.metadata.productVariants[1].enabled, true);
    assert.equal(checkbox().props.checked, false); assert.equal(checkbox().props.indeterminate, true);
    const other = all(f.ui.PromptVariantTabs({ ...props, value: 'blue', onChange() {} }));
    assert.equal(other.find(item => item.props?.['aria-label'] === '生成变体 红色').props.checked, false);
    assert.deepEqual(f.ops.map(op => op.id), ['parameter']);
    checkbox().props.onChange({ target: { checked: true } });
    assert.ok(f.data.parameter.metadata.productVariants.every(variant => variant.enabled));
});
test('点击居中考虑画布缩放、边缘范围和减少动态效果，不滚动页面', () => {
    const { ui } = fixture(), calls = [];
    const container = { offsetWidth: 400, clientWidth: 400, scrollWidth: 1200, scrollLeft: 100,
        getBoundingClientRect: () => ({ left: 200, width: 200 }), scrollTo: value => calls.push(value) };
    ui.centerPromptVariant(container, { getBoundingClientRect: () => ({ left: 410, width: 40 }) });
    assert.deepEqual(calls.pop(), { left: 360, behavior: 'smooth' });
    ui.centerPromptVariant(container, { getBoundingClientRect: () => ({ left: 0, width: 40 }) }, true);
    assert.deepEqual(calls.pop(), { left: 0, behavior: 'instant' });
    ui.centerPromptVariant(container, { getBoundingClientRect: () => ({ left: 1400, width: 40 }) });
    assert.equal(calls.pop().left, 800);
    container.offsetWidth = 0;
    ui.centerPromptVariant(container, { getBoundingClientRect: () => ({ left: 410, width: 40 }) });
    assert.equal(calls.length, 0);
});
test('切换查看变体不修改勾选；全不选后批量跳过，普通无变体配置仍可执行', () => {
    const f = fixture(), selected = [], props = { ctx: f.ctx, parameterId: f.data.parameter.id, ids: ['red', 'blue'] };
    all(f.ui.PromptVariantTabs({ ...props, value: 'red', onChange: id => selected.push(id) }))
        .find(item => item.props?.role === 'tab' && item.props.children === '蓝色').props.onClick();
    assert.deepEqual(selected, ['blue']); assert.equal(f.ops.length, 0);
    f.ui.updatePromptVariantSelection(f.ctx, f.data.parameter.id, props.ids, false);
    const generator = f.loader.load('画布生成/产品变体生成.ts');
    assert.deepEqual(generator.planProductGenerationJobs([f.data.config], f.data.nodes, f.data.connections, 'none'), []);
    assert.deepEqual(generator.productVariantExecutions(f.data.config.id, f.data.nodes, f.data.connections, 'red').map(item => item.snapshot.id), ['red']);
    assert.equal(all(f.ui.PromptVariantSelectAll(props)).find(item => item.type === 'Checkbox').props.indeterminate, false);
    const saved = JSON.parse(JSON.stringify(f.data.parameter));
    assert.ok(saved.metadata.productVariants.every(variant => variant.enabled === false));
});
test('已有选择不因显示或切换重置，无选择标记的旧变体默认勾选；部分勾选决定生成数量', () => {
    const f = fixture(), rules = f.loader.load('Excel画布/产品变体规则.ts');
    delete f.data.parameter.metadata.productVariants[0].enabled;
    assert.equal(rules.productVariants(f.data.parameter.metadata)[0].enabled, true);
    f.data.parameter.metadata.productVariants[1].enabled = false;
    const generator = f.loader.load('画布生成/产品变体生成.ts');
    const jobs = generator.planProductGenerationJobs([f.data.config], f.data.nodes, f.data.connections, 'partial');
    assert.equal(jobs.length, 1); assert.equal(jobs[0].placement.productVariant.snapshot.id, 'red');
    const before = f.ops.length;
    f.ui.updatePromptVariantSelection(f.ctx, f.data.parameter.id, ['blue'], false);
    assert.equal(f.ops.length, before);
    f.ui.updatePromptVariantSelection({ ...f.ctx, getNode: () => undefined }, f.data.parameter.id, ['red'], false);
    assert.equal(f.ops.length, before);
});
test('文字先切换查看，再次点击当前文字反选；连续点击读取最新状态，方向键仅切换', () => {
    const f = fixture(), selected = [];
    let value = 'red';
    const props = { ctx: f.ctx, parameterId: f.data.parameter.id, ids: ['red', 'blue'],
        onChange(id) { selected.push(id); value = id; } };
    const render = () => all(f.ui.PromptVariantTabs({ ...props, value }));
    const tab = name => render().find(item => item.props?.role === 'tab' && item.props.children === name);
    tab('蓝色').props.onClick();
    assert.equal(value, 'blue'); assert.equal(f.ops.length, 0);
    const current = tab('蓝色');
    current.props.onClick();
    assert.equal(f.data.parameter.metadata.productVariants[1].enabled, false);
    assert.deepEqual(selected, ['blue']);
    current.props.onClick();
    assert.equal(f.data.parameter.metadata.productVariants[1].enabled, true);
    assert.equal(f.ops.length, 2);
    current.props.onKeyDown({ key: 'ArrowLeft', preventDefault() {}, currentTarget: { closest: () => null } });
    assert.equal(value, 'red'); assert.equal(f.ops.length, 2);
    const red = tab('红色');
    f.ctx.getNode = () => undefined;
    red.props.onClick();
    assert.equal(f.ops.length, 2);
});
