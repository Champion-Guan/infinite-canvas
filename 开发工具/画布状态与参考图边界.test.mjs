import assert from 'node:assert/strict';
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
const rules = await load('Excel画布/旧版参数规则.ts', { './旧版主题翻译.js': themes, '../提示词/变量使用规则': variables });
const contexts = await load('Excel画布/Excel卡片上下文.ts', { './旧版参数规则': rules });
const titles = await load('Excel画布/旧版最终提示词标题.ts');
const parameterLinks = await load('Excel画布/产品参数联动.ts', { '../提示词/变量使用规则': variables, './旧版最终提示词标题': titles });
const domain = await load('Excel画布/Excel卡片事务.ts', {
    './旧版参数规则': rules, './产品参数联动': parameterLinks, './旧版最终提示词标题': titles, './Excel卡片上下文': contexts,
});
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

async function persistence(options = {}) {
    const effects = [], updates = [], pendingTimers = new Map(), cleared = [];
    let registration, timerId = 0, flushed = 0;
    const nodes = [node('original')], viewport = { x: 10, y: 20, k: 1.14 };
    const port = { projectId: 'original-product', nodes, connections: [], chatSessions: [], activeChatId: null,
        backgroundMode: 'lines', showImageInfo: false, viewport, projectLoaded: true,
        restoredProjectIdRef: { current: 'original-product' }, nodeTransactionRef: { current: nodes }, historyPausedRef: { current: false },
        dragRef: { current: { isDraggingNode: false } }, isNodeDragging: false, isNodeResizing: false, focusAnimRef: { current: null },
        viewportRef: { current: viewport }, viewportSaveTimerRef: { current: null }, generationRequestsRef: { current: new Map() }, runningNodeId: null,
        updateProject: (id, patch) => updates.push({ id, patch }), ...options.port };
    const store = { projects: [{ id: 'original-product' }] };
    const { useCanvasPersistence } = await load(names[1], {
        react: { useEffect: effect => effects.push(effect), useMemo: callback => callback() },
        '@/stores/canvas/use-canvas-store': { useCanvasStore: { getState: () => store } },
        './产品操作': { useProductCanvasSave: (...args) => { registration = args; } },
        '../本机存储/上游浏览器存储桥': { flushSQLiteStorage: async () => { flushed++; await options.flush?.(); } },
    }, { setTimeout: (callback, delay) => { const id = ++timerId; pendingTimers.set(id, { callback, delay }); return id; },
        clearTimeout: id => { cleared.push(id); pendingTimers.delete(id); } });
    useCanvasPersistence(port);
    const [id, snapshot, ready, persist, canDelete] = registration;
    return { port, store, id, snapshot, ready, persist: () => persist(snapshot), canDelete, effects, updates, pendingTimers, cleared, flushed: () => flushed };
}
test('保存票据只在节点、产品身份和交互稳定时就绪，未决生成阻止删除', async () => {
    const api = await persistence();
    assert.equal(api.id, 'original-product'); assert.equal(api.snapshot.nodes, api.port.nodes);
    assert.equal(api.ready(), true); assert.equal(api.canDelete(), true);
    for (const change of [
        api => { api.port.restoredProjectIdRef.current = 'other'; }, api => { api.port.nodeTransactionRef.current = []; },
        api => { api.port.historyPausedRef.current = true; }, api => { api.port.dragRef.current.isDraggingNode = true; },
        api => { api.port.focusAnimRef.current = 1; },
    ]) { const changed = await persistence(); change(changed); assert.equal(changed.ready(), false); }
    for (const port of [{ projectLoaded: false }, { isNodeDragging: true }, { isNodeResizing: true }]) {
        const blocked = await persistence({ port }); assert.equal(blocked.ready(), false);
        blocked.effects[0](); assert.equal(blocked.updates.length, 0);
    }
    api.port.generationRequestsRef.current.set('task', {}); assert.equal(api.canDelete(), false);
    const running = await persistence({ port: { runningNodeId: 'node' } }); assert.equal(running.canDelete(), false);
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
    assert.equal(api.pendingTimers.get(timer).delay, 500);
    const newest = { x: 40, y: 50, k: 2 }; api.port.viewportRef.current = newest;
    api.pendingTimers.get(timer).callback();
    assert.deepEqual(api.updates, [{ id: 'original-product', patch: { viewport: newest } }]);
    api.effects[1](); const second = api.port.viewportSaveTimerRef.current; cleanup();
    assert.equal(api.pendingTimers.has(second), false);
    const unloaded = await persistence({ port: { projectLoaded: false } }); unloaded.effects[1]();
    assert.equal(unloaded.pendingTimers.size, 0);
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
        'react-i18next': { useTranslation: () => ({ t: key => key }) },
        'lucide-react': new Proxy({}, { get: (_, key) => key }),
        '@/lib/canvas-theme': { canvasThemes: { light: { canvas: {} } } },
        '@/stores/use-theme-store': { useThemeStore: select => select({ theme: 'light' }) },
        '@/types/canvas': { CanvasNodeType: { Image: 'image', Config: 'config', Text: 'text' } },
    };
    const source = resolve(root, '.运行/3100源/画布副本/web/src');
    const toolbar = await load(resolve(source, 'components/canvas/canvas-node-hover-toolbar.tsx'), {
        ...common,
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
