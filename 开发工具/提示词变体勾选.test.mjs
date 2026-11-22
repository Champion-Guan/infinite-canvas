import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import { variantFixture, variantModules } from './产品变体生成夹具.mjs';
const jsx = (type, props) => ({ type, props });
const all = tree => Array.isArray(tree) ? tree.flatMap(all) : tree && typeof tree === 'object' ? [tree, ...all(tree.props?.children)] : [];
function fixture() {
    const data = variantFixture(), ops = [];
    const loader = variantModules({ react: { useRef: current => ({ current }), useEffect() {}, useLayoutEffect() {} },
        'react/jsx-runtime': { jsx, jsxs: jsx }, antd: { Checkbox: 'Checkbox', Tooltip: 'Tooltip' } });
    const ui = loader.load('Excel画布/提示词变体选择.tsx');
    const ctx = { node: { id: 'prompt' }, getNode: id => data.nodes.find(node => node.id === id),
        updateNodeMetadata(id, patch) {
            ops.push({ type: 'update_node_metadata', id, metadata: patch });
            const node = data.nodes.find(node => node.id === id);
            node.metadata = { ...node.metadata, ...patch };
        } };
    const props = { ctx, parameterId: data.parameter.id, ids: ['red', 'blue'], queueSelection: ui.usePromptVariantSelectionQueue(ctx, data.parameter.id) };
    return { data, loader, ui, ctx, ops, props };
}
test('默认全选，单个勾选写回参数卡并产生半选，另一个提示词卡读取同一状态', async () => {
    const f = fixture(), { props } = f;
    const checkbox = () => all(f.ui.PromptVariantSelectAll(props)).find(item => item.props?.label === '全选提示词变体');
    assert.equal(checkbox().props.checked, true);
    const tabs = all(f.ui.PromptVariantTabs({ ...props, value: 'red', onChange() {} }));
    const red = tabs.find(item => item.props?.label === '生成变体 红色');
    const input = red.type(red.props);
    assert.equal(input.type, 'input');
    assert.equal(input.props.defaultChecked, true);
    assert.equal(input.props.checked, undefined);
    input.props.onChange({ currentTarget: { checked: false } });
    assert.equal(f.ops.length, 0);
    await new Promise(resolve => setTimeout(resolve, 60));
    assert.equal(f.data.parameter.metadata.productVariants[0].enabled, false);
    assert.equal(f.data.parameter.metadata.productVariants[1].enabled, true);
    assert.equal(checkbox().props.checked, false); assert.equal(checkbox().props.mixed, true);
    const other = all(f.ui.PromptVariantTabs({ ...props, value: 'blue', onChange() {} }));
    assert.equal(other.find(item => item.props?.label === '生成变体 红色').props.checked, false);
    assert.deepEqual(f.ops.map(op => op.id), ['parameter']);
    checkbox().props.onChange(true);
    await new Promise(resolve => setTimeout(resolve, 60));
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
    const f = fixture(), selected = [], { props } = f;
    all(f.ui.PromptVariantTabs({ ...props, value: 'red', onChange: id => selected.push(id) }))
        .find(item => item.props?.role === 'tab' && item.props.children === '蓝色').props.onClick();
    assert.deepEqual(selected, ['blue']); assert.equal(f.ops.length, 0);
    f.ui.updatePromptVariantSelection(f.ctx, f.data.parameter.id, props.ids, false);
    const generator = f.loader.load('画布生成/产品变体生成.ts');
    assert.deepEqual(generator.planProductGenerationJobs([f.data.config], f.data.nodes, f.data.connections, 'none'), []);
    assert.deepEqual(generator.productVariantExecutions(f.data.config.id, f.data.nodes, f.data.connections, 'red').map(item => item.snapshot.id), ['red']);
    assert.equal(all(f.ui.PromptVariantSelectAll(props)).find(item => item.props?.label === '全选提示词变体').props.mixed, false);
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
test('文字先切换查看，再次点击当前文字反选；连续点击读取最新状态，方向键仅切换', async () => {
    const f = fixture(), selected = [];
    let value = 'red';
    const props = { ...f.props,
        onChange(id) { selected.push(id); value = id; } };
    const render = () => all(f.ui.PromptVariantTabs({ ...props, value }));
    const tab = name => render().find(item => item.props?.role === 'tab' && item.props.children === name);
    tab('蓝色').props.onClick();
    assert.equal(value, 'blue'); assert.equal(f.ops.length, 0);
    const current = tab('蓝色');
    current.props.onClick();
    await new Promise(resolve => setTimeout(resolve, 60));
    assert.equal(f.data.parameter.metadata.productVariants[1].enabled, false);
    assert.deepEqual(selected, ['blue']);
    current.props.onClick();
    await new Promise(resolve => setTimeout(resolve, 60));
    assert.equal(f.data.parameter.metadata.productVariants[1].enabled, true);
    assert.equal(f.ops.length, 2);
    current.props.onKeyDown({ key: 'ArrowLeft', preventDefault() {}, currentTarget: { closest: () => null } });
    assert.equal(value, 'red'); assert.equal(f.ops.length, 2);
    const red = tab('红色');
    f.ctx.getNode = () => undefined;
    red.props.onClick();
    assert.equal(f.ops.length, 2);
});
test('高频勾选只定点写入参数元数据，最终状态始终跟随最后一次点击', () => {
    const f = fixture();
    for (let index = 0; index < 1000; index++) {
        const current = f.ctx.getNode(f.data.parameter.id).metadata.productVariants[0].enabled;
        f.ui.updatePromptVariantSelection(f.ctx, f.data.parameter.id, ['red'], !current);
    }
    assert.equal(f.data.parameter.metadata.productVariants[0].enabled, true);
    assert.equal(f.ops.length, 1000);
    assert.ok(f.ops.every(op => op.type === 'update_node_metadata' && op.id === f.data.parameter.id));
});

test('高频复选框变更合并为每个变体的最后状态并一次提交', () => {
    const f = fixture(), updates = new Map();
    for (let index = 0; index < 1000; index++) {
        f.ui.mergePromptVariantSelection(updates, ['red'], index % 2 === 0);
    }
    assert.deepEqual([...updates], [['red', false]]);
    f.ui.mergePromptVariantSelection(updates, ['blue'], true);
    f.ui.applyPromptVariantSelectionBatch(f.ctx, f.data.parameter.id, updates);
    assert.equal(f.data.parameter.metadata.productVariants[0].enabled, false);
    assert.equal(f.data.parameter.metadata.productVariants[1].enabled, true);
    assert.equal(f.ops.length, 1);
});

test('全选与单项交错变更按实际点击顺序一次提交', async () => {
    const f = fixture();
    const selectAll = all(f.ui.PromptVariantSelectAll(f.props)).find(item => item.props?.label === '全选提示词变体');
    const red = all(f.ui.PromptVariantTabs({ ...f.props, value: 'red', onChange() {} })).find(item => item.props?.label === '生成变体 红色');
    selectAll.props.onChange(false);
    red.props.onChange(true);
    selectAll.props.onChange(true);
    red.props.onChange(false);
    assert.equal(f.ops.length, 0);
    await new Promise(resolve => setTimeout(resolve, 60));
    assert.equal(f.ops.length, 1);
    assert.deepEqual(f.data.parameter.metadata.productVariants.map(variant => variant.enabled), [false, true]);
});

test('真实装配的按下捕获不会因提示词勾选或点击文字重复选中卡片', () => {
    const canvas = readFileSync(new URL('../.运行/3100源/画布副本/web/src/components/canvas/canvas-node.tsx', import.meta.url), 'utf8');
    const capture = canvas.match(/onMouseDownCapture=\{(\(event\) => \{[\s\S]*?\n\s*\})\}/)?.[1];
    assert.ok(capture, '装配卡片应该保留按下捕获入口');
    const selected = [];
    const data = { id: 'prompt', type: 'guan:product-prompt' };
    const handler = runInNewContext(stripTypeScriptTypes(capture), { data, performance, pointerFocusUntilRef: { current: 0 },
        referenceSelectionState: null, onSelectCapture: (_event, id) => selected.push(id) });
    const click = (...matches) => handler({ target: { closest: selector => matches.some(match => selector.includes(match)) } });
    for (let i = 0; i < 100; i++) {
        click("input[type='checkbox']");
        click('label:has(');
        click('button');
    }
    assert.deepEqual(selected, []);
    click();
    data.type = 'text';
    click("input[type='checkbox']");
    assert.deepEqual(selected, ['prompt', 'prompt'], '卡片空白与其他节点保留原选中逻辑');
});
