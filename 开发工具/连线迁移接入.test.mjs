import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const frontend = createRequire(new URL('../.运行/3100源/画布副本/web/package.json', import.meta.url));
const { buildSync, transformSync } = createRequire(frontend.resolve('vite'))('esbuild');
const load = async file => import('data:text/javascript;base64,' + Buffer.from(buildSync({ entryPoints: [file], bundle: true, write: false, format: 'esm', platform: 'node' }).outputFiles[0].text).toString('base64'));
const { buildSharedConnectionGeometry: route, mergeSharedConnectionSegments: merge } = await load('扩展功能/画布连线/圆角连线路由.ts');
const { connectionSelectionKey: key, selectedConnection } = await load('扩展功能/画布连线/连线关系标识.ts');
const node = (id, x, y, type = 'image') => ({ id, type, position: { x, y }, width: 200, height: 120 });

test('重复原 ID 在规划前消歧，稳定记忆和共享段保留各自真实端点，原数据不变', () => {
    const nodes = [node('config', 0, 0, 'config'), node('b', 600, 4), node('c', 1000, 10)];
    const edges = ['b', 'c'].map(toNodeId => ({ id: 'legacy', fromNodeId: 'config', toNodeId }));
    const original = structuredClone({ nodes, edges });
    const g = route(edges, new Map(nodes.map(n => [n.id, n])));
    assert.equal(g.length, 2); assert.equal(new Set(g.map(i => i.connection.id)).size, 2);
    for (const edge of edges) {
        const item = g.find(i => i.connection.id === key(edge));
        assert.equal(item.to.id, edge.toNodeId); assert.deepEqual(selectedConnection(edges, item.connection.id), edge);
    }
    assert.equal(selectedConnection(edges, 'legacy'), undefined);
    assert.ok(merge(g).some(s => s.connectionIds.length === 2));
    const shifted = nodes.map(n => n.id === 'c' ? { ...n, position: { ...n.position, x: n.position.x + 2 } } : n);
    const again = route(edges, new Map(shifted.map(n => [n.id, n])), undefined, g);
    assert.deepEqual(again.map(i => i.connection.id), g.map(i => i.connection.id));
    assert.deepEqual({ nodes, edges }, original);
});

test('分组背景不当作实心障碍，真正普通卡片移动后会重新规划', () => {
    const a = node('a', 0, 0), b = node('b', 700, 0), background = { ...node('group', -50, -50, 'group'), width: 1000, height: 300 };
    const edges = [{ id: 'ab', fromNodeId: 'a', toNodeId: 'b' }];
    const first = route(edges, new Map([a, b, background].map(n => [n.id, n])));
    assert.deepEqual(first[0].route.points, [{ x: 200, y: 60 }, { x: 700, y: 60 }]);
    const block = node('block', 350, 0);
    const next = route(edges, new Map([a, b, background, block].map(n => [n.id, n])), undefined, first);
    assert.notEqual(next[0].route.d, first[0].route.d);
    assert.ok(next[0].route.points.some(p => p.y < 0 || p.y > 120));
});

function moduleWith(file, dependencies) {
    const code = transformSync(readFileSync(file, 'utf8'), { loader: file.endsWith('tsx') ? 'tsx' : 'ts', jsx: 'automatic', format: 'cjs', target: 'es2022' }).code;
    const module = { exports: {} };
    new Function('require', 'module', 'exports', code)(id => { assert.ok(Object.hasOwn(dependencies, id), id); return dependencies[id]; }, module, module.exports);
    return module.exports;
}
const jsx = (type, props) => ({ type, props });
const elements = tree => Array.isArray(tree) ? tree.flatMap(elements) : !tree || typeof tree !== 'object' ? [] : [tree, ...elements(tree.props?.children)];
const routing = await load('扩展功能/画布连线/圆角连线路由.ts');
const sharedFlow = await load('扩展功能/画布连线/共享网络数据流.ts');
const junction = await load('扩展功能/画布连线/连线交点整理.ts');
const design = await load('扩展功能/画布连线/连线视觉设计.ts');
const picker = await load('扩展功能/画布连线/共享主干关系选择.ts');
let hookState = [], hookIndex = 0;
const { SharedConnectionLayer: renderLayer } = moduleWith('扩展功能/画布连线/连线渲染层.tsx', {
    react: { memo: fn => fn, useMemo: fn => fn(), useState: value => { const index = hookIndex++; return [hookState[index] === undefined ? value : hookState[index], next => { hookState[index] = next; }]; }, useEffect: fn => fn(), useCallback: fn => fn },
    'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-dom': { createPortal: (children, target) => jsx('portal', { target, children }) },
    './连线数据流动画.css': {}, './共享主干关系面板': { SharedConnectionPicker: 'picker' },
    './共享网络数据流': sharedFlow, './连线交点整理': junction, './连线视觉设计': design, './圆角连线路由': routing, './共享主干关系选择': picker,
    '@/lib/canvas-theme': { canvasThemes: { light: { canvas: { background: '#fff' }, node: {} } } },
    '@/stores/use-theme-store': { useThemeStore: select => select({ theme: 'light' }) },
});
const render = (props, state = []) => { hookState = state; hookIndex = 0; return renderLayer(props); };
const g = route([{ id: 'ab', fromNodeId: 'a', toNodeId: 'b' }], new Map([node('a', 0, 0), node('b', 700, 300)].map(n => [n.id, n])));
const props = { geometry: g, scale: 1, focusedIds: new Set(['ab']), dragging: false, onSelect() {} };
test('仅焦点关系绘制 7 画布单位数据点，拖动或平移中清空，线宽同比缩放', () => {
    const tree = elements(render(props));
    const points = tree.filter(e => e.props?.['data-flow-particle']);
    assert.ok(points.length); assert.ok(points.every(e => e.props.r === 3.5));
    for (const scale of [.29, 1, 2]) {
        const line = elements(render({ ...props, scale })).find(e => e.props?.['data-focus-ink']);
        assert.equal(line.props.strokeWidth, 2.6);
    }
    for (const extra of [{ dragging: true }, { focusedIds: new Set() }]) assert.equal(elements(render({ ...props, ...extra })).filter(e => e.props?.['data-flow-particle']).length, 0);
    assert.equal(tree.filter(e => e.type === 'circle' && !e.props['data-flow-particle'] && !e.props['data-junction-dot'] && !e.props['data-focus-junction-dot']).length, 0);
});
test('配置整组焦点保持在卡片下；单条关系通过独立高亮层，透明命中无选择框', () => {
    const target = {};
    assert.equal(elements(render({ ...props, focusTarget: target })).some(e => e.type === 'portal'), true);
    assert.equal(elements(render({ ...props, focusTarget: target, keepFocusBehindCards: true })).some(e => e.type === 'portal'), false);
    const paths = elements(render(props)).filter(e => e.props?.['data-shared-connection-ids']);
    assert.ok(paths.length); assert.ok(paths.every(e => e.props.stroke === 'transparent' && e.props.strokeWidth === 24));
    assert.equal(elements(render(props)).some(e => e.type === 'rect'), false);
});
test('悬浮独立线及共享主干时高亮与流动点留在卡片下、不触发透视；离开恢复已选关系', () => {
    const nodes = [node('config', 0, 0, 'config'), node('near', 600, 0), node('far', 1000, 0)];
    const geometry = route(['near', 'far'].map(toNodeId => ({ id: toNodeId, fromNodeId: 'config', toNodeId })), new Map(nodes.map(n => [n.id, n])));
    const target = {};
    let perspective;
    const p = { ...props, geometry, flowGeometry: geometry, focusedIds: new Set(['far']), focusTarget: target, onFocusConnections: ids => { perspective = ids; } };
    const current = [];
    const draw = () => elements(render(p, current));
    for (const count of [1, 2]) {
        const path = draw().find(e => e.props?.['data-shared-connection-ids']?.split(' ').length === count);
        assert.ok(path);
        path.props.onMouseEnter();
        const hovered = draw();
        assert.equal(hovered.some(e => e.type === 'portal'), false);
        assert.ok(hovered.some(e => e.props?.['data-focus-ink']));
        assert.ok(hovered.some(e => e.props?.['data-flow-particle']));
        assert.equal(perspective.size, 0, '悬浮时不能淡化卡片');
        path.props.onMouseLeave();
        assert.ok(draw().some(e => e.type === 'portal'));
        assert.deepEqual([...perspective], ['far']);
    }
    const shared = draw().find(e => e.props?.['aria-haspopup'] === 'dialog');
    shared.props.onMouseEnter(); draw();
    shared.props.onClick({ preventDefault() {}, stopPropagation() {}, clientX: 400, clientY: 200, currentTarget: { getBoundingClientRect: () => ({ x: 400, y: 200, width: 100, height: 1 }) } });
    let opened = draw();
    assert.ok(opened.some(e => e.type === 'picker'), '共享主干仍打开关系选择');
    assert.ok(opened.some(e => e.type === 'portal'));
    opened.find(e => e.type === 'picker').props.onPreview('far');
    opened = draw();
    assert.deepEqual([...perspective], ['far']);
    assert.ok(opened.some(e => e.type === 'portal'), '条目预览仍可透视');
});
test('提示词 Portal 保留位置锚点与事件边界，面板操作不穿透画布', () => {
    const { CardPanelLayer } = moduleWith('扩展功能/画布连线/卡片浮层.tsx', {
        'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-dom': { createPortal: (children, target) => ({ children, target }) },
    });
    const n = node('prompt', 100, 200, 'text'), target = {}, child = {};
    const portal = CardPanelLayer({ node: n, target, children: child });
    assert.equal(portal.target, target); assert.equal(portal.children.props.children, child);
    assert.equal(portal.children.props.style.transform, 'translate(100px, 200px)');
    assert.equal(portal.children.props['data-canvas-no-zoom'], true);
    for (const event of ['onPointerDown', 'onMouseDown', 'onClick', 'onContextMenu', 'onDoubleClick', 'onWheel']) {
        let stopped = false; portal.children.props[event]({ stopPropagation() { stopped = true; } }); assert.equal(stopped, true);
    }
});

test('独立端点先阻止画布 pointerdown 捕获，同时保留 mousedown 新建连线', () => {
    const { CardEndpointLayer } = moduleWith('扩展功能/画布连线/卡片端点层.tsx', {
        'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-dom': { createPortal: (children, target) => ({ children, target }) },
    });
    let connected = false;
    const child = jsx('endpoint', { onMouseDown() { connected = true; } });
    const target = {}, n = node('image', 100, 200);
    const portal = CardEndpointLayer({ node: n, target, children: child });
    assert.equal(portal.target, target);
    let panStarts = 0;
    for (const eventType of ['onPointerDown', 'onDoubleClick']) {
        let stopped = false;
        portal.children.props[eventType]({ stopPropagation() { stopped = true; }, preventDefault() { assert.fail('不能取消后续兼容鼠标事件'); } });
        if (!stopped) panStarts++;
    }
    portal.children.props.children.props.onMouseDown();
    assert.equal(panStarts, 0); assert.equal(connected, true);
    assert.equal(CardEndpointLayer({ node: n, children: child }), child);
});


test('反向连接的端口短接不沿原路折返，来源向右出线、目标向右入线', () => {
    const nodes = [node('config', 1654.368, 1034.168, 'config'), node('near', 1188.94, 1034.168), node('far', 1467.166, 1034.168)];
    const g = route(['near', 'far'].map(toNodeId => ({ id: toNodeId, fromNodeId: 'config', toNodeId })), new Map(nodes.map(n => [n.id, n])));
    assert.equal(g.length, 2);
    for (const item of g) {
        const points = item.route.points;
        assert.ok(points[1].x > points[0].x); assert.equal(points[1].y, points[0].y);
        assert.ok(points.at(-2).x < points.at(-1).x); assert.equal(points.at(-2).y, points.at(-1).y);
        for (let i = 1; i < points.length - 1; i++) {
            const a = points[i - 1], b = points[i], c = points[i + 1];
            const cross = (b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x);
            const dot = (b.x-a.x)*(c.x-b.x)+(b.y-a.y)*(c.y-b.y);
            assert.ok(cross !== 0 || dot >= 0, '不可有相邻反向共线段');
        }
    }
});
