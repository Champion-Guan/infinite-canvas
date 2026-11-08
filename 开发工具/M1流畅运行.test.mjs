import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { variantModules } from './产品变体生成夹具.mjs';

const require = createRequire(new URL('../.运行/3100源/画布副本/web/package.json', import.meta.url));
const ts = require('typescript');
function load(name, dependencies = {}, globals = {}) {
    const source = readFileSync(new URL('../扩展功能/' + name, import.meta.url), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const module = { exports: {} };
    new Function('require', 'module', 'exports', ...Object.keys(globals), code)(id => {
        assert.ok(Object.hasOwn(dependencies, id), id); return dependencies[id];
    }, module, module.exports, ...Object.values(globals));
    return module.exports;
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('1000条历史核对至多读取两个命名空间索引，不读取原图，图片与视频同名键不会串用', async () => {
    const reads = [], imageKeys = Array.from({ length: 500 }, (_, i) => 'key-' + i);
    const { missingHistoryMedia } = load('生成历史/历史媒体可用性.ts', {
        '../本机存储/上游浏览器存储桥': { sqliteForage: { createInstance: ({ storeName }) => ({ keys: async () => {
            reads.push(storeName);
            return storeName === 'image_files' ? imageKeys : [];
        } }) } },
    });
    const records = Array.from({ length: 1000 }, (_, i) => ({ id: 'file-' + i, storageKey: 'key-' + (i % 500), type: i < 500 ? 'image' : 'video', remote: false }));
    records.push({ id: 'remote', type: 'image', storageKey: 'missing', remote: true });
    const missing = await missingHistoryMedia(records);
    assert.deepEqual(reads.sort(), ['image_files', 'media_files']);
    assert.equal(missing.size, 500);
    assert.ok([...missing].every(id => Number(id.slice(5)) >= 500));
    const error = new Error('暂时无法读取服务');
    await assert.rejects(missingHistoryMedia(records, async () => { throw error; }), failure => failure === error);
});

test('超长及复杂焦点网络最多96个装饰粒子，保持原速度，不为无焦点扫描整套拓扑', () => {
    const loader = variantModules(), { connectionFlowBudget, sharedNetworkFlow } = loader.load('画布连线/共享网络数据流.ts');
    for (const total of [180, 1800, 20000, 1000000]) {
        for (const segments of [0, 1, 8, 32, 96, 1000]) {
            const plan = connectionFlowBudget(total, segments);
            assert.ok(plan.count * segments <= 96);
            if (total >= 180) assert.equal(total / plan.duration, 100);
        }
    }
    const unreadable = new Proxy([], { get() { assert.fail('无焦点时不应遍历整套拓扑'); } });
    assert.deepEqual(sharedNetworkFlow([], unreadable), { total: 180, segments: [] });
    assert.deepEqual(loader.load('画布连线/圆角连线路由.ts').mergeSharedConnectionSegments([], unreadable), []);
    const junctions = loader.load('画布连线/连线交点整理.ts');
    assert.equal(junctions.softJunctionContours([], unreadable, 1, 2), '');
    assert.deepEqual(junctions.connectionJunctionDots([], unreadable), []);
});

test('慢轮询不会重叠，隐藏后无计时器，返回时立即恢复，卸载后迟到结果不能重启轮询', async () => {
    const timers = new Map(), listeners = new Set(), releases = [];
    let sequence = 0, calls = 0;
    const document = { visibilityState: 'visible',
        addEventListener: (_name, listener) => listeners.add(listener),
        removeEventListener: (_name, listener) => listeners.delete(listener) };
    const { startVisiblePolling } = load('主题/可见页面轮询.ts', { react: {} }, {
        document, setTimeout: callback => { const id = ++sequence; timers.set(id, callback); return id; },
        clearTimeout: id => timers.delete(id),
    });
    const stop = startVisiblePolling(() => { calls++; return new Promise(resolve => releases.push(resolve)); }, 2000);
    assert.equal(calls, 1); assert.equal(timers.size, 0);
    document.visibilityState = 'hidden'; listeners.forEach(listener => listener());
    document.visibilityState = 'visible'; listeners.forEach(listener => listener());
    assert.equal(calls, 1);
    releases.shift()(); await settle();
    assert.equal(timers.size, 1);
    document.visibilityState = 'hidden'; listeners.forEach(listener => listener());
    assert.equal(timers.size, 0);
    document.visibilityState = 'visible'; listeners.forEach(listener => listener());
    assert.equal(calls, 2);
    stop(); releases.shift()(); await settle();
    assert.equal(timers.size, 0); assert.equal(listeners.size, 0);
});

test('复用已有读取结果时不立即重复请求，失败后仍有下一次轮询', async () => {
    const timers = new Map(), listeners = new Set();
    let calls = 0, sequence = 0;
    const { startVisiblePolling } = load('主题/可见页面轮询.ts', { react: {} }, {
        document: { visibilityState: 'visible', addEventListener: (_name, fn) => listeners.add(fn), removeEventListener: (_name, fn) => listeners.delete(fn) },
        setTimeout: callback => { const id = ++sequence; timers.set(id, callback); return id; }, clearTimeout: id => timers.delete(id),
    });
    const stop = startVisiblePolling(async () => { calls++; throw Error('暂时失败'); }, 2000, { immediate: false });
    assert.equal(calls, 0); assert.equal(timers.size, 1);
    const [id, tick] = [...timers][0]; timers.delete(id); tick(); await settle();
    assert.equal(calls, 1); assert.equal(timers.size, 1);
    stop(); assert.equal(timers.size, 0);
});

test('统一苹果按钮保留原类型、图标与事件，按下立即反馈，禁用及减少动态效果不缩放', () => {
    const source = readFileSync(new URL('../扩展功能/主题/苹果交互按钮.tsx', import.meta.url), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    const spring = variantModules().load('主题/苹果动效.ts').APPLE_CONTROL_SPRING;
    assert.ok(spring.damping >= 2 * Math.sqrt(spring.stiffness * spring.mass));
    for (const reduced of [false, true]) {
        const module = { exports: {} }, jsx = (type, props) => ({ type, props });
        const dependencies = {
            'react/jsx-runtime': { jsx, jsxs: jsx }, antd: { Button: 'ant-button' },
            'motion/react': { useReducedMotion: () => reduced, motion: { button: 'motion.button', create: type => type } },
            './苹果动效': { APPLE_CONTROL_SPRING: spring },
        };
        new Function('require', 'module', 'exports', code)(name => dependencies[name], module, module.exports);
        let clicks = 0;
        const props = { type: 'submit', 'aria-label': '执行', children: '图标', onClick: () => clicks++ };
        const button = module.exports.AppleActionButton(props);
        assert.equal(button.props.type, 'submit'); assert.equal(button.props.children, '图标');
        button.props.onClick(); assert.equal(clicks, 1);
        assert.deepEqual(button.props.whileTap, reduced ? undefined : { scale: .96 });
        assert.equal(module.exports.AppleActionButton({ ...props, disabled: true }).props.whileTap, undefined);
        const ant = module.exports.AppleAntButton({ ...props, type: 'text' });
        assert.equal(ant.type, 'ant-button'); assert.equal(ant.props.type, 'text');
        assert.equal(module.exports.AppleAntButton({ ...props, disabled: true }).props.whileTap, undefined);
    }
});
