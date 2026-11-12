import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { canvasTaskSummary } from '../扩展功能/产品/产品任务摘要.js';
import { readCanvasCapsuleStatus } from '../扩展功能/产品/旧版产品胶囊状态.js';

const require = createRequire(new URL('../.运行/3100源/画布副本/web/package.json', import.meta.url));
const ts = require('typescript');
function load(file, dependencies, globals = {}) {
    const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
    } }).outputText;
    const module = { exports: {} };
    new Function('require', 'module', 'exports', ...Object.keys(globals), code)(name => {
        assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name];
    }, module, module.exports, ...Object.values(globals));
    return module.exports;
}
const image = (id, status) => ({ id, status, content: status === 'success' ? `media:${id}` : '',
    naturalWidth: 800, naturalHeight: 600, bytes: 100, mimeType: 'image/png' });
const task = (slotId, taskId = `task-${slotId}`) => ({ slotId, taskId });
const node = (id, status, time = 100) => ({ id, type: 'image', title: id, width: 400, height: 300,
    position: { x: 0, y: 0 }, metadata: { generationStartedAt: time, status } });
function batch() {
    return { ...node('batch', 'success'), metadata: {
        generationType: 'generation', generationStartedAt: 100, status: 'success', content: 'media:a', primaryImageId: 'a',
        images: [image('a', 'success'), image('b', 'error')], gatewayGenerationTasks: [task('a'), task('b')],
    } };
}
function fixture() {
    const values = new Map();
    const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
    return {
        values, storage,
        publish(nodes) { values.set('guan-canvas-status:p', JSON.stringify(canvasTaskSummary(nodes, [], true))); },
        clear: () => readCanvasCapsuleStatus('p', true, storage),
        read: () => readCanvasCapsuleStatus('p', true, storage, true, false),
    };
}

test('只重试a时b的已读错误身份稳定，新成功不会被旧失败覆盖', () => {
    const f = fixture(), original = batch();
    f.publish([original]); f.clear();
    const before = canvasTaskSummary([original], [], true).events.find(event => event.id.includes('image:b')).id;
    const retry = structuredClone(original);
    retry.metadata.generationStartedAt = 200;
    retry.metadata.gatewayGenerationTasks[0] = task('a', 'retry-a');
    retry.metadata.status = 'loading'; retry.metadata.images[0].status = 'loading';
    f.publish([retry]); assert.equal(f.read(), 'loading');
    const after = canvasTaskSummary([retry], [], true).events.find(event => event.id.includes('image:b')).id;
    assert.equal(after, before);
    retry.metadata.status = 'success'; retry.metadata.images[0].status = 'success';
    f.publish([retry]); assert.equal(f.read(), 'success');
    f.clear();
    retry.metadata.gatewayGenerationTasks.reverse();
    retry.metadata.generationStartedAt = 300;
    f.publish([retry]); assert.equal(f.read(), 'idle', '仅节点时间或任务排列改变不是新结果');
});

test('单张完成、同卡重试和旧槽位首次接入任务均仍产生新通知', () => {
    const f = fixture(), original = batch();
    original.metadata.gatewayGenerationTasks = [];
    f.publish([original]); f.clear();
    original.metadata.generationStartedAt = 200;
    original.metadata.gatewayGenerationTasks = [task('a', 'first-modern-a')];
    f.publish([original]); assert.equal(f.read(), 'success');
    f.clear();
    original.metadata.gatewayGenerationTasks = [task('a', 'second-modern-a')];
    original.metadata.images[0].status = 'error';
    f.publish([original]); assert.equal(f.read(), 'error');
});

test('生成中清空只确认已有终态，保留黄色，之后完成的新任务仍提醒', () => {
    const f = fixture(), failed = node('old', 'error'), running = node('running', 'loading', 200);
    f.publish([failed, running]);
    assert.equal(f.clear(), 'loading');
    running.metadata.status = 'success';
    f.publish([failed, running]);
    assert.equal(f.read(), 'success');
});

test('旧v2已读批次记录能识别新槽位身份，不会吞掉同槽的新任务', () => {
    const f = fixture(), original = batch();
    const oldEvents = original.metadata.images.map(slot => JSON.stringify([
        original.id, 100, `image:${slot.id}`, '', ['task-a', 'task-b'], slot.status,
    ]));
    f.values.set('guan-canvas-status-seen:p', JSON.stringify({ version: 2, events: oldEvents }));
    f.publish([original]); assert.equal(f.read(), 'idle');
    original.metadata.generationStartedAt = 200;
    original.metadata.gatewayGenerationTasks[0] = task('a', 'new-a');
    f.publish([original]); assert.equal(f.read(), 'success');
    f.clear();
    original.metadata.images = original.metadata.images.filter(slot => slot.id !== 'a');
    f.publish([original]); assert.equal(f.read(), 'idle');
});

const sizing = load('.运行/3100源/画布副本/web/src/lib/canvas/canvas-node-size.ts', {});
const batchOps = load('扩展功能/媒体交付/图片批次操作.ts', {
    react: { useCallback: fn => fn }, nanoid: { nanoid: () => 'copy' },
    '@/lib/canvas/canvas-node-size': sizing, '@/types/canvas': { CanvasNodeType: { Image: 'image', Text: 'text' } },
    './生成图片命名': { generatedImageName: () => '副本' },
});
const copyOps = load('扩展功能/画布布局/节点复制操作.ts', {
    react: { useCallback: fn => fn, useRef: current => ({ current }) }, nanoid: { nanoid: () => 'copy' },
    '@/types/canvas': { CanvasNodeType: { Image: 'image', Text: 'text', Group: 'group' } },
    '../Excel画布/Excel卡片事务': { remapCopiedExcelRelations: value => value },
});

test('批次图片复制、整卡复制与粘贴均不产生新完成通知，副本仍可真正生成', () => {
    const f = fixture(), original = batch();
    f.publish([original]); f.clear();
    const selected = batchOps.copyBatchImage(original, 'a', 'selected-copy');
    const copied = copyOps.prepareCopiedNodes({ nodes: [original], connections: [] }, { x: 0, y: 0 }, [original], () => 'whole-copy').nodes[0];
    f.publish([original, selected, copied]);
    assert.equal(f.read(), 'idle');
    assert.equal(selected.metadata.generationType, 'generation');
    assert.equal(copied.metadata.content, original.metadata.content);
    copied.metadata.generationStartedAt = 300;
    copied.metadata.gatewayGenerationTasks = [task('a', 'copy-new-a')];
    copied.metadata.images[0].status = 'loading'; copied.metadata.status = 'loading';
    f.publish([original, copied]); assert.equal(f.read(), 'loading');
    copied.metadata.images[0].status = 'success'; copied.metadata.status = 'success';
    f.publish([original, copied]); assert.equal(f.read(), 'success', '复制的旧失败b不能覆盖新成功a');
});

function capsuleFixture() {
    const cells = [], effects = [], values = new Map(), writes = [], navigations = [];
    let cursor = 0, dirty = false, active = 'A', visibility = 'visible', busy = false, tree;
    let projects = ['A', 'B'].map(id => ({ id, title: id, createdAt: id, nodes: [], connections: [] }));
    const jsx = (type, props) => ({ type, props });
    const react = {
        useState(initial) { const index = cursor++; if (!(index in cells)) cells[index] = initial;
            return [cells[index], value => { if (cells[index] !== value) { cells[index] = value; dirty = true; } }]; },
        useMemo(fn, deps) { const index = cursor++, old = cells[index];
            if (!old || deps.some((v, i) => v !== old.deps[i])) cells[index] = { deps, value: fn() }; return cells[index].value; },
        useLayoutEffect(fn, deps) { const index = cursor++, old = cells[index];
            if (!old || deps.some((v, i) => v !== old.deps[i])) { cells[index] = { deps }; effects.push(fn); } },
        useSyncExternalStore: (_subscribe, read) => read(),
    };
    const doc = { get visibilityState() { return visibility; }, addEventListener() {}, removeEventListener() {} };
    const module = load('扩展功能/产品/顶部产品胶囊.tsx', {
        react, 'react/jsx-runtime': { jsx, jsxs: jsx },
        '@/stores/canvas/use-canvas-store': { useCanvasStore: select => select({ projects }) },
        '../本机存储/上游浏览器存储桥': { sqlitePreferences: {
            getItem: key => values.get(key), setItem: (key, value) => { values.set(key, value); writes.push(key); },
        } },
        '../Excel/Excel产品归属': { orderedWorkbookProjects: items => items, visibleWorkbookId: () => 'book' },
        './产品规则': { orderedProducts: items => items },
        './产品操作': { useProductNavigation: () => ({ activeId: active, busy, selectProduct: async id => { navigations.push(id); active = id; } }) },
        './产品任务摘要.js': { canvasTaskSummary },
        './旧版产品显示名.js': { productDisplayName: project => project.title },
        './旧版产品胶囊状态.js': { readCanvasCapsuleStatus },
        './产品胶囊.module.css': { default: {} }, './产品回收面板': {},
        'motion/react': { AnimatePresence: 'Presence', motion: { button: 'Button' }, useReducedMotion: () => true },
        '../主题/苹果动效': {}, './胶囊滑动动效': { useCapsuleSlide: () => ({
            navigation: { current: null }, track: { current: null }, indicator: { current: null },
        }) }, './胶囊鼠标拖动': { useCapsuleMouseDrag() {} }, 'lucide-react': {}, '../主题/苹果交互按钮': {},
    }, { document: doc });
    const elements = value => Array.isArray(value) ? value.flatMap(elements) : value && typeof value === 'object'
        ? [value, ...elements(value.props?.children)] : [];
    return {
        values, writes, navigations,
        active(value) { active = value; }, visibility(value) { visibility = value; },
        busy(value) { busy = value; },
        nodes(id, nodes) { projects = projects.map(project => project.id === id ? { ...project, nodes } : project); },
        projects: () => structuredClone(projects),
        clickCurrent() { elements(tree).find(item => item.props?.['data-product-id'] === active).props.onClick(); },
        render() {
            let limit = 10;
            do { dirty = false; cursor = 0; effects.length = 0; tree = module.ProductCapsules();
                effects.forEach(fn => fn()); assert.ok(--limit > 0); } while (dirty);
            return elements(tree).find(item => item.props?.['data-product-id'] === active).props.className;
        },
    };
}

test('真实胶囊进入运行中产品时确认旧通知，任务结束后只显示新结果且不在render写入', () => {
    const f = capsuleFixture();
    f.render();
    f.nodes('B', [node('old-failure', 'error'), node('new-task', 'loading', 200)]);
    f.active('B'); assert.match(f.render(), /capsule-loading/);
    assert.ok(f.values.has('guan-canvas-status-seen:B'));
    f.nodes('B', [node('old-failure', 'error'), node('new-task', 'success', 200)]);
    assert.match(f.render(), /capsule-success/);
    const writes = f.writes.length;
    f.render(); assert.equal(f.writes.length, writes);
});

test('页面隐藏时不提前确认通知，重新可见时完成尚未执行的产品进入确认', () => {
    const f = capsuleFixture(); f.render();
    f.nodes('B', [node('done', 'success')]);
    f.visibility('hidden'); f.active('B');
    assert.match(f.render(), /capsule-success/);
    assert.equal(f.values.has('guan-canvas-status-seen:B'), false);
    f.visibility('visible'); assert.match(f.render(), /capsule-idle/);
    assert.ok(f.values.has('guan-canvas-status-seen:B'));
});

test('再次点击当前胶囊清空成功或失败提醒，不切换、不修改画布且连续点击不重复保存', () => {
    for (const status of ['success', 'error']) {
        const f = capsuleFixture(); f.render();
        f.nodes('A', [node('done', status)]);
        assert.match(f.render(), new RegExp(`capsule-${status}`));
        const before = f.projects(), writes = f.writes.length;
        f.clickCurrent();
        assert.equal(f.writes.length, writes, '点击只触发原确认流程，写入在提交阶段进行');
        assert.match(f.render(), /capsule-idle/);
        assert.deepEqual(f.projects(), before);
        assert.deepEqual(f.navigations, []);
        assert.equal(f.writes.length, writes + 1);
        f.clickCurrent(); assert.match(f.render(), /capsule-idle/);
        assert.equal(f.writes.length, writes + 1, '重复确认相同状态不重复落盘');
        f.nodes('A', [...before[0].nodes, node('next', 'success', 200)]);
        assert.match(f.render(), /capsule-success/, '新完成任务仍正常提醒');
    }
});

test('再次点击运行中的当前胶囊只清空旧终态，保持黄色且不取消任务', () => {
    const f = capsuleFixture(); f.render();
    const running = node('running', 'loading', 200), old = node('old-failure', 'error');
    f.nodes('A', [old, running]); assert.match(f.render(), /capsule-loading/);
    const before = f.projects();
    f.clickCurrent(); assert.match(f.render(), /capsule-loading/);
    assert.deepEqual(f.projects(), before);
    assert.deepEqual(f.navigations, []);
    f.nodes('A', [old, { ...running, metadata: { ...running.metadata, status: 'success' } }]);
    assert.match(f.render(), /capsule-success/, '未取消的任务完成后显示新成功，旧错误不重现');
});

test('切换忙碌时忽略当前胶囊点击，隐藏页面不会提前确认结果', () => {
    const f = capsuleFixture(); f.render();
    f.nodes('A', [node('done', 'success')]); assert.match(f.render(), /capsule-success/);
    const writes = f.writes.length;
    f.busy(true); f.render(); f.clickCurrent();
    assert.match(f.render(), /capsule-success/); assert.equal(f.writes.length, writes);
    f.busy(false); f.visibility('hidden'); f.render(); f.clickCurrent();
    assert.match(f.render(), /capsule-success/); assert.equal(f.writes.length, writes);
    f.visibility('visible');
    assert.match(f.render(), /capsule-idle/); assert.equal(f.writes.length, writes + 1);
});

test('真实顶部胶囊汇总AI策划状态，当前和后台产品均响应，点击清空后旧完成不复活', () => {
    const f = capsuleFixture(); f.render();
    const parameter = status => ({ id: 'parameter', type: 'guan:prompt-variables',
        metadata: { status: 'success', productPlanningTask: { id: 'planning-one', startedAt: 100, status } } });
    f.nodes('A', [parameter('loading')]); assert.match(f.render(), /capsule-loading/);
    f.nodes('A', [parameter('success')]); assert.match(f.render(), /capsule-success/);
    f.clickCurrent(); assert.match(f.render(), /capsule-idle/);
    f.nodes('A', [{ ...parameter('success'), metadata: { ...parameter('success').metadata, productImagePlan: { imageCount: 17 } } }]);
    assert.match(f.render(), /capsule-idle/);
    f.nodes('B', [parameter('loading')]); f.active('B'); assert.match(f.render(), /capsule-loading/);
    f.nodes('B', [parameter('error')]); assert.match(f.render(), /capsule-error/);
    f.clickCurrent(); assert.match(f.render(), /capsule-idle/);
});
