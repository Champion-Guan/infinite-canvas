import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { variantModules, variantFixture } from './产品变体生成夹具.mjs';

const custom = '主图1张、轮播图2张：1200 x 1600 px，WEBP，单张小于3MB。\n不制作富内容。';
async function fixture(projects = [], persisted = new Map(), flush = async () => {}) {
    const loader = variantModules(), state = loader.load('Excel画布/平台规则全局状态.ts');
    const writes = [];
    await state.globalPlatformRules.initialize({
        getItem: key => persisted.get(key) ?? null,
        setItem: (key, value) => { persisted.set(key, value); writes.push({ key, value }); },
        flush,
    }, projects);
    return { loader, state, persisted, writes, store: state.globalPlatformRules,
        rules: loader.load('Excel画布/旧版参数规则.ts'), planning: loader.load('Excel画布/商品策划任务规则.ts') };
}

test('修改一次后同平台任意卡片、产品及新卡统一使用，旧卡覆盖值不能倒灌全局', async () => {
    const f = await fixture(), platform = 'Wildberries';
    await f.store.save(platform, custom, f.store.read(platform));
    const a = { productPlatform: platform };
    const b = { productPlatform: platform, productPlatformRules: '另一张卡的旧规则',
        productPlatformRuleOverrides: { Wildberries: '旧卡覆盖' } };
    for (const card of [a, b, f.rules.buildPromptVariablesMetadata()]) {
        assert.equal(f.rules.productPlatformRules(card), custom);
        assert.equal(f.planning.productPlanningRequirements(card).channelRules, custom);
        assert.equal(f.planning.productPlanningRequirements(card).production, null);
        assert.doesNotMatch(f.rules.productParameterSupplement(card), /富内容必须制作6张/);
    }
    assert.deepEqual(f.rules.productPlatformChangePatch(b, 'Ozon'), { productPlatform: 'Ozon', productLanguage: '俄文' });
    assert.equal(f.planning.productPlanningRequirements({}).production, null, '旧卡缺平台字段时也使用WB全局规格');
    assert.equal(f.rules.productPlatformRules(a), custom);
});

test('五个平台全局独立、清空和恢复默认可持久化，刷新后不再从卡片覆盖', async () => {
    const f = await fixture();
    for (const { value } of f.rules.PRODUCT_PLATFORM_OPTIONS) await f.store.save(value, `${value}统一规则`, f.store.read(value));
    await f.store.save('Wildberries', '', f.store.read('Wildberries'));
    assert.equal(f.rules.productPlatformRules({ productPlatform: 'Wildberries' }), '');
    const restarted = await fixture([{ nodes: [{ metadata: { productPlatform: 'Wildberries', productPlatformRules: '过时规则' } }] }], f.persisted);
    assert.equal(restarted.store.read('Wildberries'), '');
    assert.equal(restarted.writes.length, 0);
    await restarted.store.save('Wildberries', restarted.rules.WILDBERRIES_RULES_TEXT, '');
    assert.equal(restarted.planning.productPlanningRequirements({ productPlatform: 'Wildberries' }).production.mainAndCarousel.count, 11);
    assert.equal(restarted.store.read('Ozon'), 'Ozon统一规则');
});

test('只在首次升级从最新产品迁移自定义内容，保留其他旧字段且不会选择旧默认文案', async () => {
    const old = { id: 'old', updatedAt: '2026-11-10', nodes: [{ metadata: {
        productPlatform: 'Wildberries', productPlatformRules: '较早的自定义规则',
        productPlatformRuleOverrides: { Ozon: '旧OZON规则' },
    } }] };
    const latest = { id: 'new', updatedAt: '2026-11-11', nodes: [{ metadata: {
        productPlatform: 'Wildberries', productPlatformRuleOverrides: { Wildberries: custom, Ozon: '' },
    } }] };
    const before = structuredClone([old, latest]), f = await fixture([old, latest]);
    assert.equal(f.store.read('Wildberries'), custom); assert.equal(f.store.read('Ozon'), '');
    assert.deepEqual([old, latest], before);
    assert.equal(f.writes.length, 1);
    const reopened = await fixture([old], f.persisted);
    assert.equal(reopened.store.read('Wildberries'), custom);
    assert.equal(reopened.writes.length, 0);
});

test('全局规则变更发布订阅，新策划立即读取并拒绝旧资料结果，恢复旧卡不隐式修改全局', async () => {
    const f = await fixture(), rules = f.loader.load('Excel画布/商品提示词规则.ts');
    const { parameter } = variantFixture();
    const old = rules.planningFingerprint(parameter.metadata), before = structuredClone(parameter);
    let notifications = 0;
    const off = f.store.subscribe(() => notifications++);
    await f.store.save('Wildberries', custom, f.store.read('Wildberries'));
    assert.equal(notifications, 1); assert.equal(rules.productPlanningFacts(parameter.metadata).channelRequirements, custom);
    assert.ok(rules.productPlanningChanges(parameter.metadata, old).includes('平台规则'));
    assert.equal(JSON.parse(rules.productPlanningParameters(parameter.metadata)).productPlatformRules, custom);
    assert.deepEqual(parameter, before);
    const prompt = { id: 'prompt', metadata: { productImagePrompt: { parameterId: parameter.id }, productPromptSourceFingerprint: old } };
    assert.throws(() => f.loader.load('Excel画布/商品提示词恢复.ts').productPromptRestoreOps([parameter, prompt], [], ['prompt']), /全局规则已更新/);
    off(); await f.store.save('Wildberries', custom, custom);
    assert.equal(notifications, 1, '未改变内容不发布，不重复写入');
});

test('并发编辑冲突拒绝覆盖，保存等待ACK，失败不回退成默认，损坏全局数据明确失败', async () => {
    let rejectAck, resolveAck, pending = false;
    const f = await fixture([], new Map(), () => pending ? new Promise((yes, no) => { resolveAck = yes; rejectAck = no; }) : Promise.resolve());
    pending = true;
    let settled = false;
    const operation = f.store.save('Wildberries', custom, f.store.read('Wildberries')).finally(() => { settled = true; });
    assert.equal(settled, false); assert.equal(f.store.read('Wildberries'), custom);
    await assert.rejects(f.store.save('Wildberries', '迟到编辑', '旧文案'), /其他操作修改/);
    rejectAck(Error('保存未确认')); await assert.rejects(operation, /保存未确认/);
    assert.equal(f.store.read('Wildberries'), custom);
    const retry = f.store.save('Wildberries', custom, custom); resolveAck(); await retry;
    const bad = new Map([[f.state.GLOBAL_PLATFORM_RULES_KEY, '{"version":1,"rules":{"Wildberries":1}}']]);
    await assert.rejects(fixture([], bad), /全局平台规则格式异常/);
});

const require = createRequire(new URL('../.运行/3100源/画布副本/web/package.json', import.meta.url)), ts = require('typescript');
const all = value => Array.isArray(value) ? value.flatMap(all) : value && typeof value === 'object'
    ? [value, ...all(value.props?.children), ...all(value.props?.footer)] : [];
async function editorFixture() {
    const f = await fixture(), cells = [], effects = [];
    let cursor = 0, active = true;
    const node = { id: 'parameter', metadata: f.rules.buildPromptVariablesMetadata() };
    const jsx = (type, props) => ({ type, props });
    const react = {
        useId: () => 'edit-platform-rules',
        useRef: current => { const i = cursor++; return cells[i] ||= { current }; },
        useState: initial => { const i = cursor++; if (!(i in cells)) cells[i] = initial;
            return [cells[i], next => { cells[i] = next; }]; },
        useEffect: (fn, deps) => { const i = cursor++, old = cells[i];
            if (!old || deps.some((v, j) => v !== old.deps[j])) { cells[i] = { deps }; effects.push(fn); } },
    };
    const dependencies = {
        react, 'react/jsx-runtime': { jsx, jsxs: jsx }, antd: { Input: { TextArea: 'TextArea' }, Tooltip: 'Tooltip' },
        'motion/react': { AnimatePresence: 'Presence' }, 'lucide-react': { Pencil: 'Pencil', RotateCcw: 'Reset' },
        '../主题/苹果弹窗': { AppleModal: 'Modal' }, '../主题/苹果交互按钮': { AppleActionButton: 'Trigger', AppleAntButton: 'Button' },
        '../产品/产品界面边界': { useProductActive: () => active }, './旧版参数规则': f.rules,
        './平台规则全局状态': f.state, './平台规则订阅': { useGlobalPlatformRules() {} },
    };
    const code = ts.transpileModule(readFileSync('扩展功能/Excel画布/平台规则编辑.tsx', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    const mod = { exports: {} };
    new Function('require', 'module', 'exports', code)(id => { assert.ok(Object.hasOwn(dependencies, id), id); return dependencies[id]; }, mod, mod.exports);
    const render = () => {
        cursor = 0; effects.length = 0;
        const tree = mod.exports.ProductPlatformRuleEditor({ ctx: { node, getNode: () => node } });
        effects.forEach(fn => fn()); return all(tree);
    };
    return { ...f, node, render,
        button: label => render().find(item => item.type === 'Button' && item.props.children === label),
        open() { render().find(item => item.type === 'Trigger').props.onClick(); },
        input(value) { render().find(item => item.type === 'TextArea').props.onChange({ target: { value } }); },
        cancel() { render().find(item => item.type === 'Modal').props.onCancel(); },
        deactivate() { active = false; render(); },
    };
}

test('编辑弹窗保存全局而不写参数卡，取消或恢复后取消均不应用，恢复默认也全局生效', async () => {
    const f = await editorFixture(), before = structuredClone(f.node);
    f.open(); f.input(custom); f.cancel();
    assert.equal(f.store.read('Wildberries'), f.rules.WILDBERRIES_RULES_TEXT);
    f.open(); f.input(custom); await f.button('保存').props.onClick();
    assert.equal(f.store.read('Wildberries'), custom);
    assert.deepEqual(f.node, before, '保存全局规则不能改写当前卡');
    f.open(); f.button('恢复默认').props.onClick(); f.cancel();
    assert.equal(f.store.read('Wildberries'), custom);
    f.open(); f.button('恢复默认').props.onClick(); await f.button('保存').props.onClick();
    assert.equal(f.store.read('Wildberries'), f.rules.WILDBERRIES_RULES_TEXT);
});

test('编辑期间平台或全局规则变化不覆盖新值，切走产品关闭草稿', async () => {
    const f = await editorFixture();
    f.open(); f.input(custom); f.node.metadata.productPlatform = 'Ozon';
    await f.button('保存').props.onClick();
    assert.ok(f.render().some(item => item.props.role === 'alert'));
    f.cancel(); f.open(); f.input(custom);
    await f.store.save('Ozon', '其他操作保存的规则', f.store.read('Ozon'));
    await f.button('保存').props.onClick();
    assert.equal(f.store.read('Ozon'), '其他操作保存的规则');
    assert.ok(f.render().some(item => item.props.role === 'alert'));
    f.deactivate(); assert.equal(f.render().some(item => item.type === 'Modal'), false);
});
