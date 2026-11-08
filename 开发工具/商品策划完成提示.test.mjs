import test from 'node:test';
import assert from 'node:assert/strict';
import { variantModules } from './产品变体生成夹具.mjs';

function hooks() {
    const cells = []; let cursor = 0;
    const react = {
        useState(initial) {
            const index = cursor++;
            if (!(index in cells)) cells[index] = { value: typeof initial === 'function' ? initial() : initial };
            return [cells[index].value, value => { cells[index].value = value; }];
        },
        useRef(initial) { const [ref] = react.useState(() => ({ current: initial })); return ref; },
        useEffect(callback, deps) {
            const index = cursor++, old = cells[index];
            if (!old || deps.some((value, i) => value !== old.deps[i])) {
                old?.cleanup?.(); cells[index] = { deps, cleanup: callback() };
            }
        },
    };
    return { react, render(callback) { cursor = 0; return callback(); },
        unmount() { for (const cell of cells) cell.cleanup?.(); } };
}
function fixture() {
    const runtime = hooks(), opened = [], destroyed = [], errors = [], calls = [];
    const message = { open: item => opened.push(item), destroy: key => destroyed.push(key), error: value => errors.push(value) };
    const loader = variantModules({
        react: runtime.react,
        'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
        'lucide-react': { Play: 'Play', X: 'X' },
        antd: { App: { useApp: () => ({ message }) } },
    });
    const notice = loader.load('Excel画布/商品策划完成通知.ts');
    const { useProductPlanningSuccessNotice } = loader.load('Excel画布/商品策划完成提示.tsx');
    const port = { projectId: 'product-a', active: true, hasNode: () => true, assertActive() {},
        generateAllConfigNodes: async () => { calls.push('old'); } };
    const render = () => runtime.render(() => useProductPlanningSuccessNotice(port));
    render();
    return { ...runtime, opened, destroyed, errors, calls, port, notice, render,
        success: () => notice.notifyProductPlanning(port.projectId, 'parameter', true),
        content: () => opened.at(-1).content.props };
}

test('策划成功才打开60秒提示；到期仅关闭，陈旧按钮不能启动生图', t => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 });
    const api = fixture();
    try {
        api.notice.notifyProductPlanning('product-a', 'parameter', false);
        api.notice.notifyProductPlanning('other-product', 'parameter', true);
        assert.equal(api.opened.length, 0);
        api.success();
        const { deadline, generate } = api.content();
        assert.equal(api.notice.planningNoticeSeconds(deadline), 60);
        assert.equal(api.opened[0].type, 'success');
        t.mock.timers.tick(59_001);
        assert.equal(api.notice.planningNoticeSeconds(deadline), 1);
        assert.equal(api.destroyed.length, 0);
        t.mock.timers.tick(999);
        assert.deepEqual(api.destroyed, [api.opened[0].key]);
        generate();
        assert.deepEqual(api.calls, []);
    } finally { api.unmount(); }
});

test('一键生图只执行一次并使用当前配置入口，关闭旧提示不影响新提示', async t => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 });
    const api = fixture();
    try {
        api.success(); const old = api.content();
        t.mock.timers.tick(10_000);
        api.success(); const current = api.content(), key = api.opened.at(-1).key;
        assert.notEqual(key, api.opened[0].key);
        old.generate(); old.close();
        assert.deepEqual(api.calls, []);
        api.port.generateAllConfigNodes = async () => { api.calls.push('current-all-configs'); };
        api.render();
        current.generate(); current.generate();
        await Promise.resolve();
        assert.deepEqual(api.calls, ['current-all-configs']);
        assert.equal(api.destroyed.filter(item => item === key).length, 1);
        t.mock.timers.tick(60_000);
        assert.equal(api.destroyed.filter(item => item === key).length, 1);
    } finally { api.unmount(); }
});

test('重新策划、关闭、离开产品和卸载均撤销按钮，不在返回时重放成功通知', t => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 });
    const api = fixture();
    try {
        api.success(); const replanning = api.content();
        api.notice.notifyProductPlanning('product-a', 'parameter', false);
        replanning.generate();
        api.success(); const manual = api.content(); manual.close(); manual.generate();
        api.success(); const leaving = api.content();
        api.port.active = false; api.render(); leaving.generate();
        api.success(); assert.equal(api.opened.length, 3);
        api.port.active = true; api.render(); assert.equal(api.opened.length, 3);
        api.success(); const unmounting = api.content(); api.unmount(); unmounting.generate();
        assert.deepEqual(api.calls, []);
        assert.equal(api.destroyed.length, 4);
    } finally { api.unmount(); }
});

test('切换产品后的旧回调及后台过期回调拒绝执行，参数卡删除和提交异常有明确反馈', async t => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 });
    const api = fixture();
    try {
        api.success(); const old = api.content();
        api.port.projectId = 'product-b'; api.render(); old.generate();
        api.success(); api.port.hasNode = () => false; api.content().generate();
        assert.match(api.errors.at(-1), /参数卡已移除/);
        api.port.hasNode = () => true;
        api.success(); const expired = api.content();
        t.mock.timers.setTime(Date.now() + 61_000);
        expired.generate();
        assert.deepEqual(api.calls, []);
        api.success();
        api.port.generateAllConfigNodes = async () => { throw Error('批量预检查失败'); };
        api.render(); api.content().generate();
        await Promise.resolve();
        assert.equal(api.errors.at(-1), '批量预检查失败');
    } finally { api.unmount(); }
});

test('倒计时按真实截止时间更新，页面恢复可见不会延长；卸载清理定时器和事件', t => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: 1000 });
    const api = fixture(), contentRuntime = hooks(), events = new Map();
    const previous = globalThis.document;
    globalThis.document = { addEventListener: (event, fn) => events.set(event, fn), removeEventListener: event => events.delete(event) };
    try {
        api.success();
        const element = api.opened[0].content;
        const originalHooks = api.react;
        Object.assign(originalHooks, contentRuntime.react);
        const render = () => contentRuntime.render(() => element.type(element.props));
        let tree = render();
        assert.equal(tree.props.children[1].props.children[0], 60);
        t.mock.timers.tick(1000); tree = render();
        assert.equal(tree.props.children[1].props.children[0], 59);
        t.mock.timers.setTime(Date.now() + 45_000);
        events.get('visibilitychange')(); tree = render();
        assert.equal(tree.props.children[1].props.children[0], 14);
        assert.ok(tree.props.children.some(child => child.props?.['aria-label'] === '关闭策划完成提示'));
        contentRuntime.unmount(); assert.equal(events.size, 0);
        assert.deepEqual(api.calls, []);
    } finally { contentRuntime.unmount(); api.unmount(); globalThis.document = previous; }
});
