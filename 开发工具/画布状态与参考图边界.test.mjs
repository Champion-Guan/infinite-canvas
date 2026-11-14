import assert from 'node:assert/strict';
import { platformState } from './全局平台规则夹具.mjs';
import { variantModules } from './产品变体生成夹具.mjs';
import * as deferredMedia from '../扩展功能/本机存储/画布媒体延迟恢复.mjs';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Linter } from 'eslint';
import ts from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import { transformWithEsbuild } from '../.运行/3100源/画布副本/web/node_modules/vite/dist/node/index.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const names = ['画布生成/画布节点事务.ts', '产品/画布保存接线.ts', '画布生成/全局参考图操作.ts'];
async function load(name, dependencies = {}, globals = {}) {
    dependencies = { '@/扩展功能/画布交互/节点工具栏定位': variantModules().load('画布交互/节点工具栏定位.ts'), ...dependencies };
    dependencies = { 'react-dom': { createPortal: children => children }, '@/扩展功能/画布交互/画布浮层容器': { CanvasFloatingBoundary: 'CanvasFloatingBoundary' }, './平台规则全局状态': platformState, '../本机存储/画布媒体延迟恢复.mjs': deferredMedia, ...dependencies };
    const file = resolve(root, '扩展功能', name);
    const { code } = await transformWithEsbuild(readFileSync(file, 'utf8'), file,
        { loader: file.endsWith('.tsx') ? 'tsx' : 'ts', jsx: 'automatic', format: 'cjs', target: 'es2022', tsconfigRaw: '{}' });
    const module = { exports: {} };
    new Function('require', 'module', 'exports', ...Object.keys(globals), code)(id => {
        assert.ok(Object.hasOwn(dependencies, id), '未声明依赖：' + id);
        return dependencies[id];
    }, module, module.exports, ...Object.values(globals));
    return module.exports;
}
const placement = await load('画布布局/卡片自动避让.ts');
const themes = await load('Excel画布/旧版主题翻译.js');
const variables = await load('提示词/变量使用规则.ts');
const confirmationRules = await load('Excel画布/商品待确认规则.ts');
const rules = await load('Excel画布/旧版参数规则.ts', { './旧版主题翻译.js': themes, '../提示词/变量使用规则': variables, './商品待确认规则': confirmationRules });
const contexts = await load('Excel画布/Excel卡片上下文.ts', { './旧版参数规则': rules });
const titles = await load('Excel画布/旧版最终提示词标题.ts');
const parameterLinks = await load('Excel画布/产品参数联动.ts', { '../提示词/变量使用规则': variables, './旧版最终提示词标题': titles, './旧版参数规则': rules });
const domain = await load('Excel画布/Excel卡片事务.ts', {
    './旧版参数规则': rules, './产品参数联动': parameterLinks, './旧版最终提示词标题': titles, './Excel卡片上下文': contexts,
});
const save判定 = await load('产品/画布保存判定.ts');
const node = (id, type = 'text', metadata = {}) => ({ id, type, title: id, position: { x: 0, y: 0 }, width: 340, height: 240, metadata });
async function transactions() {
    const renders = [];
    const { useCanvasNodeTransactions } = await load(names[0], {
        react: { useState: value => [value, next => renders.push(next)], useRef: value => ({ current: value }), useCallback: value => value },
        '../Excel画布/Excel卡片事务': domain, '../画布布局/卡片自动避让': placement,
    });
    return { ...useCanvasNodeTransactions(), renders };
}
test('节点连续更新使用最新事务，恢复保持原位；新增避让不移动既有卡片', async () => {
    const api = await transactions(), old = node('old');
    api.setRawNodes([old]);
    api.setNodes(previous => [...previous, node('new')]);
    api.setNodes(previous => [...previous, node('third')]);
    assert.deepEqual(api.nodesRef.current.map(item => item.id), ['old', 'new', 'third']);
    assert.equal(api.nodesRef.current, api.nodeTransactionRef.current);
    assert.equal(api.renders.at(-1), api.nodesRef.current);
    assert.equal(api.getCurrentNode('old'), old);
    assert.deepEqual(old.position, { x: 0, y: 0 });
    assert.notDeepEqual(api.getCurrentNode('new').position, old.position);
    assert.notDeepEqual(api.getCurrentNode('third').position, api.getCurrentNode('new').position);
    const restored = [old, node('overlap')];
    api.setRawNodes(restored);
    assert.equal(api.nodesRef.current, restored);
    assert.deepEqual(restored[1].position, old.position, '原始恢复不能被重新避让');
});
test('节点事务仍调用真实Excel预览规则，源文更新后空变量保持未填写', async () => {
    const api = await transactions();
    const source = node('source', 'text', { content: '[LENGTH]', excelPromptBindingNodeId: 'parameter' });
    const parameter = node('parameter', 'guan:prompt-variables', { promptVariableValues: { LENGTH: '' } });
    const preview = node('preview', 'text', { promptVariablePreviewOf: 'parameter', promptVariableSourceNodeId: 'source', content: '[LENGTH]' });
    api.setRawNodes([source, parameter, preview]);
    api.setNodes(previous => previous.map(item => item.id === 'source' ? { ...item, metadata: { ...item.metadata, content: '长度：[LENGTH]' } } : item));
    const resolved = api.getCurrentNode('preview').metadata.content;
    assert.ok(resolved.startsWith('长度：[LENGTH]'));
    assert.match(resolved, /未填写变量：\[LENGTH\]。保持未提供，不填默认值/);
    assert.match(resolved, /不得.*猜测、补齐或编造/);
    assert.equal(api.getCurrentNode('source').metadata.excelPromptResolved, resolved);
    assert.equal(source.metadata.content, '[LENGTH]');
});
test('指定拖放位置只跳过本次自动布局，重叠坐标与原节点事务保持，后续普通新增仍避让', async () => {
    const api = await transactions(), old = node('old');
    api.setRawNodes([old]);
    api.setNodes(previous => [...previous, node('drop')], 'exact');
    const dropped = api.getCurrentNode('drop');
    assert.deepEqual(dropped.position, old.position, '松手位置有卡片时也不向下避让');
    assert.equal(api.nodesRef.current, api.nodeTransactionRef.current);
    assert.equal(api.renders.at(-1), api.nodesRef.current);
    api.setNodes(previous => previous.map(item => item.id === 'drop' ? { ...item, title: '已编辑' } : item));
    assert.deepEqual(api.getCurrentNode('drop').position, old.position, '后续编辑不能重新推走拖入的卡片');
    api.setNodes(previous => [...previous, node('automatic')]);
    assert.notDeepEqual(api.getCurrentNode('automatic').position, old.position, '本次指定位置不能关闭其他入口的自动布局');
    assert.equal(api.getCurrentNode('old'), old);
    assert.equal(Object.hasOwn(dropped.metadata, 'placement'), false, '落点策略不写入画布数据');
});

async function persistence(options = {}) {
    const effects = [], updates = [], pendingTimers = new Map(), cleared = [], activeCleanups = new Set();
    const windowEvents = new EventTarget(), documentEvents = new EventTarget();
    documentEvents.visibilityState = 'visible';
    let registration, timerId = 0, flushed = 0;
    const nodes = [node('original')], viewport = { x: 10, y: 20, k: 1.14 };
    const port = { projectId: 'original-product', nodes, connections: [], chatSessions: [], activeChatId: null,
        backgroundMode: 'lines', showImageInfo: false, viewport, projectLoaded: true,
        restoredProjectIdRef: { current: 'original-product' }, nodeTransactionRef: { current: nodes }, historyPausedRef: { current: false },
        dragRef: { current: { isDraggingNode: false } }, isNodeDragging: false, isNodeResizing: false,
        isCanvasPanning: false, canvasPanningRef: { current: false }, nodeResizingRef: { current: false }, focusAnimRef: { current: null },
        viewportRef: { current: viewport }, viewportSaveTimerRef: { current: null }, generationRequestsRef: { current: new Map() }, runningNodeId: null,
        updateProject: (id, patch) => {
            updates.push({ id, patch });
            if (options.applyUpdates) store.projects = store.projects.map(project => project.id === id ? { ...project, ...patch } : project);
        }, ...options.port };
    const store = { projects: [{ id: 'original-product', ...options.project }] };
    const { useCanvasPersistence } = await load(names[1], {
        react: { useEffect: effect => effects.push(() => {
            const cleanup = effect();
            if (typeof cleanup !== 'function') return cleanup;
            const dispose = () => { activeCleanups.delete(dispose); cleanup(); };
            activeCleanups.add(dispose); return dispose;
        }), useMemo: callback => callback() },
        '@/stores/canvas/use-canvas-store': { useCanvasStore: { getState: () => store } },
        './产品操作': { useProductCanvasSave: (...args) => { registration = args; } },
        './画布保存判定': save判定,
        '../画布生成/批量保存协调': { isBatchCanvasSaveActive: () => options.batchActive ?? false, markBatchCanvasDirty: () => options.markDirty?.() },
        '../本机存储/上游浏览器存储桥': { flushSQLiteStorage: async () => { flushed++; await options.flush?.(); } },
    }, { setTimeout: (callback, delay) => { const id = ++timerId; pendingTimers.set(id, { callback, delay }); return id; },
        clearTimeout: id => { cleared.push(id); pendingTimers.delete(id); },
        window: windowEvents, document: documentEvents });
    const render = (changes = {}) => {
        for (const cleanup of activeCleanups) cleanup();
        Object.assign(port, changes);
        effects.length = 0;
        useCanvasPersistence(port);
    };
    render();
    return { port, store, get id() { return registration[0]; }, get snapshot() { return registration[1]; },
        ready: () => registration[2](), persist: () => registration[3](registration[1]), canDelete: () => registration[4](),
        retiring: () => registration[6], canRelease: () => registration[7](),
        render, effects, updates, pendingTimers, cleared, windowEvents, documentEvents, flushed: () => flushed };
}
test('删除交接背景停止自动保存和视区计时，不把回收画布写回活动列表', async () => {
    const api = await persistence();
    api.effects.forEach(effect => effect());
    assert.ok(api.pendingTimers.size > 0);
    api.render({ retiring: true });
    const cleanups = api.effects.map(effect => effect());
    assert.equal(api.retiring(), true);
    assert.equal(api.ready(), false);
    assert.equal(api.pendingTimers.size, 0);
    const previousWrites = api.updates.length;
    api.windowEvents.dispatchEvent(new Event('beforeunload', { cancelable: true }));
    api.documentEvents.visibilityState = 'hidden';
    api.documentEvents.dispatchEvent(new Event('visibilitychange'));
    await assert.rejects(api.persist(), /删除交接/);
    assert.equal(api.updates.length, previousWrites);
    assert.equal(api.flushed(), 0);
    cleanups.forEach(cleanup => cleanup?.());
});
test('平移后未到两秒就关闭时先提交最终视区并阻止未确认退出，卸载后不遗留监听', async () => {
    const api = await persistence({ applyUpdates: true });
    api.store.projects[0] = { id: api.id, ...api.snapshot, viewport: { x: 0, y: 0, k: 1 } };
    const cleanups = api.effects.map(effect => effect());
    assert.equal(api.updates.length, 0);
    const leave = new Event('beforeunload', { cancelable: true });
    api.windowEvents.dispatchEvent(leave);
    assert.equal(api.updates.length, 1, '两秒计时器尚未触发时也必须提交视区');
    assert.equal(api.updates[0].patch.viewport, api.port.viewportRef.current);
    assert.equal(leave.defaultPrevented, true, '不能在异步SQLite回执之前静默允许退出');
    assert.equal(api.flushed(), 1);
    assert.equal(api.port.viewportSaveTimerRef.current, null);
    cleanups.forEach(cleanup => cleanup?.());
    api.port.viewportRef.current = { x: 80, y: 90, k: 2 };
    api.windowEvents.dispatchEvent(new Event('beforeunload', { cancelable: true }));
    assert.equal(api.updates.length, 1, '卸载监听必须移除');
});
test('切到后台先保存最终视区，未完成手势和批量生成仍遵守保存门控', async () => {
    const api = await persistence({ applyUpdates: true });
    api.store.projects[0] = { id: api.id, ...api.snapshot, viewport: { x: 0, y: 0, k: 1 } };
    const cleanups = api.effects.map(effect => effect());
    api.documentEvents.visibilityState = 'hidden';
    api.documentEvents.dispatchEvent(new Event('visibilitychange'));
    assert.equal(api.updates.length, 1);
    cleanups.forEach(cleanup => cleanup?.());
    const panning = await persistence({ port: { canvasPanningRef: { current: true } } });
    const blockedCleanups = panning.effects.map(effect => effect());
    panning.windowEvents.dispatchEvent(new Event('beforeunload', { cancelable: true }));
    assert.equal(panning.updates.length, 0, '手势中的预览不能当作最终视区提交');
    blockedCleanups.forEach(cleanup => cleanup?.());
    let dirty = 0;
    const batch = await persistence({ batchActive: true, markDirty: () => { dirty++; } });
    batch.store.projects[0] = { id: batch.id, ...batch.snapshot, viewport: { x: 0, y: 0, k: 1 } };
    const batchCleanups = batch.effects.map(effect => effect());
    const leave = new Event('beforeunload', { cancelable: true });
    batch.windowEvents.dispatchEvent(leave);
    assert.equal(batch.updates.length, 0); assert.equal(dirty, 1);
    assert.equal(leave.defaultPrevented, true);
    batchCleanups.forEach(cleanup => cleanup?.());
});
test('保存票据只在节点、产品身份和交互稳定时就绪，未决生成阻止删除', async () => {
    const api = await persistence();
    assert.equal(api.id, 'original-product'); assert.equal(api.snapshot.nodes, api.port.nodes);
    assert.equal(api.ready(), true); assert.equal(api.canDelete(), true);
    for (const change of [
        api => { api.port.restoredProjectIdRef.current = 'other'; }, api => { api.port.nodeTransactionRef.current = []; },
        api => { api.port.historyPausedRef.current = true; }, api => { api.port.dragRef.current.isDraggingNode = true; },
        api => { api.port.focusAnimRef.current = 1; }, api => { api.port.canvasPanningRef.current = true; },
        api => { api.port.nodeResizingRef.current = true; },
    ]) { const changed = await persistence(); change(changed); assert.equal(changed.ready(), false); }
    for (const port of [{ projectLoaded: false }, { isNodeDragging: true }, { isNodeResizing: true }, { isCanvasPanning: true }]) {
        const blocked = await persistence({ port }); assert.equal(blocked.ready(), false);
        blocked.effects[0](); assert.equal(blocked.updates.length, 0);
    }
    api.port.generationRequestsRef.current.set('task', {}); assert.equal(api.canDelete(), false);
    const running = await persistence({ port: { runningNodeId: 'node' } }); assert.equal(running.canDelete(), false);
});
test('未完成编辑窗口单独阻止休眠，关闭窗口后恢复资格，不禁用正常内容保存', async () => {
    const api = await persistence({ port: { pendingEditor: true } });
    assert.equal(api.canRelease(), false); assert.equal(api.ready(), true);
    api.render({ pendingEditor: false }); assert.equal(api.canRelease(), true);
});
test('过期提交或已删除产品在写入和SQLite刷新之前拒绝', async () => {
    for (const change of [
        api => { api.port.restoredProjectIdRef.current = 'other'; },
        api => { api.port.nodeTransactionRef.current = []; }, api => { api.store.projects = []; },
    ]) {
        const api = await persistence(); change(api);
        await assert.rejects(api.persist(), /invalidated|unavailable/);
        assert.deepEqual(api.updates, []); assert.equal(api.flushed(), 0);
    }
});
test('完整快照先等保存确认，再取消同一视区延迟写入', async () => {
    let release; const api = await persistence({ flush: () => new Promise(resolve => { release = resolve; }) });
    api.effects[1](); const timer = api.port.viewportSaveTimerRef.current;
    const saving = api.persist();
    assert.equal(api.updates.length, 1); assert.equal(api.updates[0].patch.viewport, api.port.viewport);
    assert.equal(api.updates[0].id, 'original-product');
    assert.equal(api.port.viewportSaveTimerRef.current, timer, '保存未确认前不能取消');
    release(); await saving;
    assert.equal(api.port.viewportSaveTimerRef.current, null); assert.deepEqual(api.cleared, [timer]);
});
test('保存失败保留延迟写入；保存期间产生新视区时保留其计时器', async () => {
    const failed = await persistence({ flush: async () => { throw Error('保存失败'); } });
    failed.effects[1](); const timer = failed.port.viewportSaveTimerRef.current;
    await assert.rejects(failed.persist(), /保存失败/);
    assert.equal(failed.port.viewportSaveTimerRef.current, timer); assert.deepEqual(failed.cleared, []);
    let release; const newer = await persistence({ flush: () => new Promise(resolve => { release = resolve; }) });
    newer.effects[1](); const saving = newer.persist();
    newer.port.viewportRef.current = { x: 100, y: 200, k: 2 };
    const latestTimer = newer.port.viewportSaveTimerRef.current;
    release(); await saving;
    assert.equal(newer.port.viewportSaveTimerRef.current, latestTimer); assert.deepEqual(newer.cleared, []);
});
test('视区延迟写入读取最新引用并在卸载时取消，未加载不调度', async () => {
    const api = await persistence(), cleanup = api.effects[1]();
    const timer = api.port.viewportSaveTimerRef.current;
    assert.equal(api.pendingTimers.get(timer).delay, 2000);
    const newest = { x: 40, y: 50, k: 2 }; api.port.viewportRef.current = newest;
    api.pendingTimers.get(timer).callback();
    assert.deepEqual(api.updates, [{ id: 'original-product', patch: { viewport: newest } }]);
    const secondCleanup = api.effects[1](), second = api.port.viewportSaveTimerRef.current; cleanup();
    assert.equal(api.port.viewportSaveTimerRef.current, second, '旧effect清理不能覆盖新计时器引用');
    secondCleanup();
    assert.equal(api.pendingTimers.has(second), false);
    const unloaded = await persistence({ port: { projectLoaded: false } }); unloaded.effects[1]();
    assert.equal(unloaded.pendingTimers.size, 0);
});
test('定位与平移只改变视角时不误报内容待保存，实际内容变更仍显示待保存', () => {
    const current = { nodes: [], connections: [], chatSessions: [], activeChatId: null, backgroundMode: 'lines', showImageInfo: false, viewport: { x: 0, y: 0, k: 1 } };
    const next = { ...current, viewport: { x: 40, y: 20, k: 1.2 } };
    assert.equal(save判定.canvasSavePending(current, next, true), false, '平移/缩放预览期间不显示保存中');
    assert.equal(save判定.canvasSavePending(current, next, false), false, '视角等待合并保存时不误报内容待保存');
    assert.equal(save判定.canvasHasPendingChanges(current, next), true, '视角仍需持久化，不能为了状态提示取消保存');
    const edited = { ...next, nodes: [node('edited')] };
    assert.equal(save判定.canvasSavePending(current, edited, false), true, '卡片内容尚未提交时仍显示待保存');
    assert.equal(save判定.canvasSavePending(current, { ...next, backgroundMode: 'dots' }), true, '画布外观仍属于真实修改');
    assert.equal(save判定.canvasSavePending(current, current, true), false, '无变化的手势不显示保存中');
});
test('拖动、平移、尺寸调整与聚焦动画期间不提交快照，也不创建视区保存计时器', async () => {
    for (const port of [
        { isNodeDragging: true }, { isNodeResizing: true }, { isCanvasPanning: true },
        { dragRef: { current: { isDraggingNode: true } } }, { nodeResizingRef: { current: true } },
        { canvasPanningRef: { current: true } }, { focusAnimRef: { current: 7 } },
        { historyPausedRef: { current: true } },
    ]) {
        const api = await persistence({ port });
        api.effects.forEach(effect => effect());
        assert.equal(api.ready(), false);
        assert.deepEqual(api.updates, [], JSON.stringify(port));
        assert.equal(api.pendingTimers.size, 0);
    }
});
test('按住不动超过保存延迟，新手势的同步ref仍阻止旧视区计时器保存', async () => {
    for (const begin of [
        api => { api.port.dragRef.current.isDraggingNode = true; },
        api => { api.port.nodeResizingRef.current = true; },
        api => { api.port.canvasPanningRef.current = true; },
        api => { api.port.focusAnimRef.current = 7; },
    ]) {
        const api = await persistence();
        api.effects[1]();
        const timer = api.port.viewportSaveTimerRef.current;
        begin(api);
        api.pendingTimers.get(timer).callback();
        assert.deepEqual(api.updates, []);
        assert.equal(api.port.viewportSaveTimerRef.current, null);
    }
});
test('连续拖动或尺寸调整结束后只提交最终节点和视区，等值重放不重复保存', async () => {
    for (const flag of ['isNodeDragging', 'isNodeResizing']) {
        const api = await persistence({ applyUpdates: true });
        api.store.projects[0] = { id: api.id, ...api.snapshot };
        api.render({ [flag]: true });
        for (let step = 1; step <= 20; step++) {
            const nodes = [{ ...api.port.nodes[0], position: { x: step * 10, y: step * 20 }, width: 340 + step }];
            const viewport = { x: step, y: step * 2, k: 1.2 };
            api.port.nodeTransactionRef.current = nodes;
            api.port.viewportRef.current = viewport;
            api.render({ nodes, viewport });
            api.effects.forEach(effect => effect());
        }
        assert.deepEqual(api.updates, [], '中间帧不进入存储');
        api.render({ [flag]: false });
        api.effects.forEach(effect => effect());
        assert.equal(api.updates.length, 1);
        assert.equal(api.updates[0].patch.nodes, api.port.nodes);
        assert.equal(api.updates[0].patch.viewport, api.port.viewport);
        assert.equal(api.pendingTimers.size, 0, '最终节点与视区不拆成两次保存');
        assert.equal(api.snapshot.viewport, api.port.viewport, '切换产品时使用最新视区');
        api.render({ nodes: structuredClone(api.port.nodes), viewport: { ...api.port.viewport } });
        api.effects.forEach(effect => effect());
        assert.equal(api.updates.length, 1, '等值节点及空手势不再次提交');
    }
});
test('平移与滚轮缩放中不保存，结束后合并为一个最终视区写入', async () => {
    const api = await persistence({ applyUpdates: true });
    api.store.projects[0] = { id: api.id, ...api.snapshot };
    for (let step = 1; step <= 20; step++) {
        const viewport = { x: step * 10, y: step * 20, k: 1 + step / 20 };
        api.port.viewportRef.current = viewport;
        api.render({ isCanvasPanning: true, viewport });
        api.effects.forEach(effect => effect());
    }
    assert.deepEqual(api.updates, []);
    assert.equal(api.pendingTimers.size, 0);
    api.render({ isCanvasPanning: false });
    api.effects.forEach(effect => effect());
    assert.equal(api.pendingTimers.size, 1);
    const timer = api.port.viewportSaveTimerRef.current;
    api.pendingTimers.get(timer).callback();
    assert.deepEqual(api.updates, [{ id: api.id, patch: { viewport: api.port.viewport } }]);
    api.effects.forEach(effect => effect());
    assert.equal(api.updates.length, 1);
});
test('完整快照已覆盖最新视区时，原计时器不重复提交；旧画布计时器不能写新画布', async () => {
    for (const change of [
        api => { api.store.projects[0].viewport = api.port.viewport; },
        api => { api.port.restoredProjectIdRef.current = 'other'; },
    ]) {
        const api = await persistence();
        api.effects[1]();
        const timer = api.port.viewportSaveTimerRef.current;
        change(api);
        api.pendingTimers.get(timer).callback();
        assert.deepEqual(api.updates, []);
    }
});

async function references(nodes, connections = []) {
    const written = [], messages = []; let serial = 0;
    const port = { nodesRef: { current: nodes }, connectionsRef: { current: connections },
        setConnections: value => written.push(value), message: { info: text => messages.push(text), success: text => messages.push(text) } };
    const { useGlobalImageReference } = await load(names[2], {
        react: { useCallback: callback => callback }, nanoid: { nanoid: () => 'edge-' + ++serial },
        '@/types/canvas': { CanvasNodeType: { Image: 'image', Config: 'config' } },
    });
    return { port, run: useGlobalImageReference(port), written, messages };
}
test('全局参考只补缺失的配置连线，连续点击不重复，后加配置可继续补齐', async () => {
    const image = node('image', 'image', { content: '原图' });
    const existing = [{ id: 'old-edge', fromNodeId: 'image', toNodeId: 'config-a' }];
    const api = await references([image, node('config-a', 'config'), node('config-b', 'config'), node('text')], existing);
    api.run(image); api.run(image);
    assert.equal(api.written.length, 1); assert.equal(api.written[0][0], existing[0]);
    assert.deepEqual(api.written[0].slice(1).map(edge => edge.toNodeId), ['config-b']);
    assert.equal(api.port.connectionsRef.current, api.written[0]);
    api.port.nodesRef.current.push(node('config-c', 'config')); api.run(image);
    assert.equal(api.written.length, 2); assert.equal(api.written.at(-1).at(-1).toNodeId, 'config-c');
    assert.equal(existing.length, 1, '既有连线数组不能就地修改');
});
test('参考图操作按当前节点校验，空图、已删除图或非图片不写入', async () => {
    for (const live of [[], [node('image', 'image')], [node('image', 'text', { content: '文本' })]]) {
        const api = await references([...live, node('config', 'config')]);
        api.run(node('image', 'image', { content: '过时旧图' })); assert.deepEqual(api.written, []);
    }
    const image = node('image', 'image', { content: '图' }), api = await references([image]);
    api.run(image); assert.deepEqual(api.written, []); assert.match(api.messages[0], /没有生成配置/);
});
test('新模块Hook顺序与依赖合法', () => {
    const linter = new Linter();
    for (const name of names) {
        const file = resolve(root, '扩展功能', name);
        const messages = linter.verify(readFileSync(file, 'utf8'), [{ files: ['**/*.ts'],
            languageOptions: { parser: ts.parser, parserOptions: { ecmaVersion: 2022, sourceType: 'module' } },
            plugins: { 'react-hooks': reactHooks }, rules: { 'react-hooks/rules-of-hooks': 'error', 'react-hooks/exhaustive-deps': 'error' } }], { filename: file });
        assert.deepEqual(messages, [], name);
    }
});

test('视区覆盖层保持穿透，节点与多选胶囊恢复命中并只触发自己的操作', async () => {
    const jsx = (type, props) => ({ type, props });
    const descendants = value => Array.isArray(value) ? value.flatMap(descendants)
        : value && typeof value === 'object' ? [value, ...descendants(value.props?.children)] : [];
    const common = {
        'react/jsx-runtime': { jsx, jsxs: jsx },
        react: { useState: value => [value, () => {}], useEffect: () => {} },
        antd: { App: { useApp: () => ({ message: {} }) }, Tooltip: 'Tooltip' },
        '@/扩展功能/主题/原生可关闭浮层': { OutsideDropdown: 'NativeDropdown' },
        '@/扩展功能/主题/苹果弹窗': { AppleModal: 'Modal' },
        'react-i18next': { useTranslation: () => ({ t: key => key }) },
        'lucide-react': new Proxy({}, { get: (_, key) => key }),
        '@/lib/canvas-theme': { canvasThemes: { light: { canvas: {} } } },
        '@/stores/use-theme-store': { useThemeStore: select => select({ theme: 'light' }) },
        '@/types/canvas': { CanvasNodeType: { Image: 'image', Config: 'config', Text: 'text' } },
    };
    const source = resolve(root, '.运行/3100源/画布副本/web/src');
    const toolbar = await load(resolve(source, 'components/canvas/canvas-node-hover-toolbar.tsx'), {
        ...common,
        '@/扩展功能/画布交互/节点工具栏定位': await load('画布交互/节点工具栏定位.ts'),
        '@/扩展功能/画布生成/一键超人菜单': { ImageSuperMenu: 'ImageSuperMenu' },
        '@/扩展功能/主题/页签内容过渡': { TabContentTransition: 'TabTransition' },
        '@/扩展功能/产品/产品界面边界': { useProductActive: () => true },
        '@/扩展功能/本机存储/上游浏览器存储桥': {}, '@/lib/canvas/node-registry': {},
        '@/lib/image-utils': {}, '@/hooks/use-copy-text': { useCopyText: () => () => {} }, '@/stores/use-config-store': {},
        './canvas-image-toolbar-settings-modal': { ImageToolSettingsModal: 'ImageToolSettingsModal' },
        './canvas-image-toolbar-tools': { defaultImageQuickToolIds: ['info', 'globalReference'], buildImageToolbarTools: () => [] },
    });
    let referenced = null, info = null, groups = 0;
    const image = node('image', 'image', { content: '原图' });
    const view = descendants(toolbar.CanvasNodeHoverToolbar({ node: image, viewport: { x: 0, y: 0, k: 1 },
        onUseAsGlobalReference: value => { referenced = value; }, onInfo: value => { info = value; } }));
    const interactive = view.find(item => item.props?.['data-node-toolbar'] === image.id);
    assert.ok(interactive.props.className.split(/\s+/).includes('pointer-events-auto'));
    const actions = view.filter(item => item.type?.name === 'ToolbarAction').flatMap(item => descendants(item.type(item.props)));
    actions.find(item => item.type === 'button' && item.props['aria-label'] === '设为全局参考图').props.onClick();
    assert.equal(referenced, image);
    actions.find(item => item.type === 'button' && item.props['aria-label'] === 'canvas.nodeToolbar.infoTitle').props.onClick();
    assert.equal(info, image);
    const selection = await load(resolve(source, 'components/canvas/canvas-selection-toolbar.tsx'), {
        '@/扩展功能/媒体交付/画布下载操作': { selectedDownloadFiles: () => [] },
        ...common, '@/lib/canvas/canvas-node-geometry': { nodeBounds: () => ({ left: 0, top: 0, right: 100, bottom: 100 }) },
    });
    const selected = descendants(selection.CanvasSelectionToolbar({ nodes: [image, node('second')], viewport: { x: 0, y: 0, k: 1 },
        showToolbar: true, canGroup: true, canUngroup: false, onGroup: () => { groups++; } }));
    assert.ok(selected.find(item => item.type === 'svg').props.className.includes('pointer-events-none'));
    assert.ok(selected.find(item => item.type === 'div').props.className.split(/\s+/).includes('pointer-events-auto'));
    const group = selected.find(item => item.type?.name === 'SelectionAction');
    descendants(group.type(group.props)).find(item => item.type === 'button').props.onClick();
    assert.equal(groups, 1);
    const parent = readFileSync(resolve(source, 'pages/canvas/project.tsx'), 'utf8');
    assert.match(parent, /ref=\{panOverlayRef\} className="pointer-events-none /, '空白视区不能拦截画布操作');
});
