import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformWithEsbuild } from '../.运行/3100源/画布副本/web/node_modules/vite/dist/node/index.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
async function load(file, dependencies) {
    const { code } = await transformWithEsbuild(readFileSync(resolve(root, file), 'utf8'), file, { loader: file.endsWith('.tsx') ? 'tsx' : 'ts', jsx: 'automatic', format: 'cjs', target: 'es2022', tsconfigRaw: '{}' });
    const module = { exports: {} };
    new Function('require', 'module', 'exports', code)(id => {
        assert.ok(Object.hasOwn(dependencies, id), '未声明依赖：' + id);
        return dependencies[id];
    }, module, module.exports);
    return module.exports;
}
const types = { Config: 'config', Image: 'image', Text: 'text', Video: 'video', Audio: 'audio' };
const relations = await load('扩展功能/画布连线/连线关系标识.ts', {});
const api = await load('扩展功能/画布生成/生成连线保护.ts', { '../画布连线/连线关系标识': relations, react: { useCallback: value => value }, '@/types/canvas': { CanvasNodeType: types } });
const node = (id, type, metadata) => ({ id, type, metadata });
const edge = (fromNodeId, toNodeId, id = fromNodeId + '-' + toNodeId) => ({ id, fromNodeId, toNodeId });
function deletion(nodes, connections, parameter = false) {
    const nodesRef = { current: nodes }, connectionsRef = { current: connections }, calls = [];
    const port = { nodesRef, connectionsRef, disconnectParameterConnection: id => { calls.push(['parameter', id]); return parameter; },
        setConnections: action => { calls.push(['connections']); connectionsRef.current = action(connectionsRef.current); },
        setSelectedConnectionId: action => calls.push(['selection', action(connections[0]?.id)]),
        setContextMenu: action => calls.push(['menu', action({ type: 'connection', connectionId: connections[0]?.id })]),
        message: { info: options => { assert.equal(options.content, api.GENERATED_CONNECTION_DELETE_NOTICE); calls.push(['protected']); } } };
    return { run: api.useCanvasConnectionDeletion(port), calls, nodesRef, connectionsRef };
}

test('旧画布及四种生成模式在成功、失败、运行和空结果时都不能单独断开输出连线', () => {
    for (const type of ['image', 'text', 'video', 'audio']) {
        for (const status of [undefined, 'idle', 'loading', 'error', 'success']) {
            const nodes = [node('config', 'config'), node('result', type, status ? { status } : undefined)];
            const connections = [edge('config', 'result')], before = structuredClone({ nodes, connections });
            assert.equal(api.isGeneratedResultConnection(connections[0], nodes), true);
            const state = deletion(nodes, connections);
            state.run(connections[0].id);
            assert.deepEqual(state.calls, [['protected']]);
            assert.equal(state.connectionsRef.current, connections);
            assert.equal(state.nodesRef.current, nodes);
            assert.deepEqual({ nodes, connections }, before);
        }
    }
});

test('普通提示词、参考图和参数输入保持可删，不把反向输入误当成生成归属', () => {
    for (const [from, to] of [['text', 'config'], ['image', 'config'], ['prompt-variables', 'config'], ['text', 'image'], ['image', 'image'], ['config', 'prompt-variables']]) {
        const nodes = [node('a', from), node('b', to)], connection = edge('a', 'b');
        assert.equal(api.isGeneratedResultConnection(connection, nodes), false);
        const state = deletion(nodes, [connection]); state.run(connection.id);
        assert.deepEqual(state.connectionsRef.current, []);
        assert.deepEqual(state.calls, [['parameter', connection.id], ['connections'], ['selection', null], ['menu', null]]);
    }
    const state = deletion([node('a', 'prompt-variables'), node('b', 'text')], [edge('a', 'b')], true);
    state.run('a-b');
    assert.deepEqual(state.calls, [['parameter', 'a-b'], ['selection', null], ['menu', null]]);
});

test('使用点击时最新节点和连线，失效菜单不产生解绑、保存或选择变更', () => {
    const state = deletion([], []);
    state.run('missing'); assert.deepEqual(state.calls, []);
    state.nodesRef.current = [node('new-config', 'config'), node('new-result', 'image')];
    state.connectionsRef.current = [edge('new-config', 'new-result', 'late')];
    state.run('late'); assert.deepEqual(state.calls, [['protected']]);
    assert.equal(api.isGeneratedResultConnection(undefined, state.nodesRef.current), false);
    assert.equal(api.isGeneratedResultConnection(edge('new-config', 'missing'), state.nodesRef.current), false);
    assert.equal(api.isGeneratedResultConnection(edge('new-config', 'new-config'), state.nodesRef.current), false);
});

test('复制和导入重新编号后无需新增元数据仍保护配置结果关系', () => {
    const snapshot = JSON.parse(JSON.stringify({ nodes: [node('copy-config', 'config'), node('copy-result', 'image')], connections: [edge('copy-config', 'copy-result', 'import-edge')] }));
    const state = deletion(snapshot.nodes, snapshot.connections);
    state.run('import-edge'); assert.deepEqual(state.calls, [['protected']]);
});

test('结果卡片删除仍回收连线，恢复后删除保护立即生效', async () => {
    const recycle = await load('扩展功能/画布回收/画布节点回收.ts', { nanoid: { nanoid: () => 'recycle' },
        '../Excel画布/Excel卡片事务': { clearDeletedExcelRelations: node => node, excelDeletionIds: (_nodes, ids) => ids } });
    const nodes = [node('config', 'config'), node('result', 'image')], connections = [edge('config', 'result')];
    const removed = recycle.recycleCanvasNodes(nodes, connections, new Set(['result']), []);
    assert.deepEqual(removed.nodes, [nodes[0]]); assert.deepEqual(removed.connections, []);
    const restored = recycle.restoreCanvasNodes(removed.nodes, removed.connections, removed.batches[0]);
    assert.deepEqual(restored.connections, connections);
    assert.equal(api.isGeneratedResultConnection(restored.connections[0], restored.nodes), true);
});

test('右键菜单禁用删除并说明原因，普通连线和节点仍保留可用删除按钮', async () => {
    const jsx = (type, props) => ({ type, props });
    const icons = new Proxy({}, { get: (_target, type) => type });
    const { CanvasNodeContextMenu } = await load('.运行/3100源/画布副本/web/src/components/canvas/canvas-context-menu.tsx', {
        react: { useEffect: () => {} }, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'lucide-react': icons,
        'react-i18next': { useTranslation: () => ({ t: key => key }) }, '@/lib/canvas-theme': { canvasThemes: { light: { toolbar: {}, node: {} } } },
        '@/stores/use-theme-store': { useThemeStore: select => select({ theme: 'light' }) },
    });
    function buttons(element) {
        if (!element || typeof element !== 'object') return [];
        if (typeof element.type === 'function') return buttons(element.type(element.props));
        return [...(element.type === 'button' ? [element.props] : []), ...[element.props?.children].flat().flatMap(buttons)];
    }
    for (const type of ['node', 'connection']) for (const protectedConnection of [false, true]) {
        const protectedMenu = type === 'connection' && protectedConnection;
        const items = buttons(CanvasNodeContextMenu({ menu: { type, x: 0, y: 0 }, canCaptureVideoFrame: false,
            deleteDisabledReason: protectedMenu ? api.GENERATED_CONNECTION_DELETE_NOTICE : undefined, onClose() {}, onDelete() {} }));
        const remove = items.at(-1);
        assert.equal(remove.disabled, protectedMenu);
        assert.equal(remove.title, protectedMenu ? api.GENERATED_CONNECTION_DELETE_NOTICE : undefined);
    }
});


test('重复原始 ID 使用两端身份精确删除，生成归属线始终保留', () => {
    const nodes = [node('prompt', 'text'), node('config', 'config'), node('result', 'image')];
    const plain = edge('prompt', 'config', 'legacy'), protectedEdge = edge('config', 'result', 'legacy');
    const connections = [plain, protectedEdge], before = structuredClone(connections);
    const state = deletion(nodes, connections);
    state.run('legacy'); assert.deepEqual(state.calls, [], '不明确的旧 ID 不能随机删除');
    state.run(relations.connectionSelectionKey(protectedEdge)); assert.deepEqual(state.calls, [['protected']]);
    state.run(relations.connectionSelectionKey(plain));
    assert.deepEqual(state.connectionsRef.current, [protectedEdge]);
    assert.deepEqual(connections, before, '不改写输入或持久化关系 ID');
});
