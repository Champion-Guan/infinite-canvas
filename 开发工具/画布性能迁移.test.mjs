import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { transformWithEsbuild } from '../.运行/3100源/画布副本/web/node_modules/vite/dist/node/index.js';

async function load(file, dependencies = {}) {
    const { code } = await transformWithEsbuild(readFileSync(file, 'utf8'), file, { loader: file.endsWith('tsx') ? 'tsx' : 'ts', jsx: 'automatic', format: 'cjs', target: 'es2022', tsconfigRaw: '{}' });
    const module = { exports: {} };
    new Function('require', 'module', 'exports', code)(id => { assert.ok(Object.hasOwn(dependencies, id), id); return dependencies[id]; }, module, module.exports);
    return module.exports;
}
const { createVisibilityIndex } = await load('扩展功能/画布布局/空间可见索引.ts');
const { canvasContentSnapshot } = await load('扩展功能/画布布局/坐标独立内容.ts');
const { imageInfoDefaults, withCanvasAppearanceDefaults } = await load('扩展功能/图片设置/图片信息偏好.ts');
const box = (id, x, y, width = 300, height = 240) => ({ id, type: 'image', position: { x, y }, width, height, metadata: { content: id } });
const bounds = node => ({ left: node.position.x, top: node.position.y, right: node.position.x + node.width, bottom: node.position.y + node.height });
const intersects = (a, b) => a.right > b.left && a.left < b.right && a.bottom > b.top && a.top < b.bottom;

test('空间查询与原全量筛选一致，包含负坐标、超大卡、长连线和极端缩放', () => {
    let seed = 17;
    const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    const nodes = Array.from({ length: 3000 }, (_, id) => box(String(id), random() * 100000 - 50000, random() * 100000 - 50000));
    nodes.push(box('long', -900000, -500, 1800000, 1000));
    const query = createVisibilityIndex(nodes, bounds);
    for (let i = 0; i < 100; i++) {
        const left = random() * 100000 - 50000, top = random() * 100000 - 50000;
        const view = { left, top, right: left + (i === 0 ? 10000000 : 2000), bottom: top + (i === 0 ? 10000000 : 1500) };
        assert.deepEqual(query(view), nodes.filter(node => intersects(bounds(node), view)));
    }
});
test('平移查询不再读取全量节点几何，结果不变时复用数组，节点层叠顺序不变', () => {
    const nodes = Array.from({ length: 20000 }, (_, id) => box(String(id), id * 400, 0));
    let reads = 0;
    const query = createVisibilityIndex(nodes, node => { reads++; return bounds(node); });
    const view = { left: 0, top: -1, right: 1000, bottom: 300 };
    const result = query(view);
    assert.deepEqual(result.map(node => node.id), ['0', '1', '2']);
    assert.equal(query({ ...view, right: 1001 }), result);
    for (let i = 0; i < 100; i++) query({ ...view, left: i * 1000, right: i * 1000 + 1000 });
    assert.equal(reads, nodes.length);
});
test('纯坐标移动保留业务输入身份，内容、尺寸、顺序和未知插件变化必须失效', () => {
    const before = [box('a', 0, 0), box('b', 400, 0)];
    assert.equal(canvasContentSnapshot(before, before.map(node => ({ ...node, position: { x: 200, y: 100 } }))), before);
    for (const after of [
        [{ ...before[0], metadata: { content: 'changed' } }, before[1]],
        [{ ...before[0], width: 400 }, before[1]],
        [before[1], before[0]], before.slice(0, 1),
    ]) assert.equal(canvasContentSnapshot(before, after), after);
    const plugin = [{ ...before[0], type: 'plugin' }], moved = [{ ...plugin[0], position: { x: 4, y: 5 } }];
    assert.equal(canvasContentSnapshot(plugin, moved), moved);
});
test('默认显示图片信息，已有关闭偏好和旧版有效标记均保留，迁移幂等', () => {
    assert.deepEqual(imageInfoDefaults, { showImageInfo: true, imageInfoDefaultVersion: 1 });
    assert.equal(withCanvasAppearanceDefaults({}).showImageInfo, true);
    for (const value of [true, false]) {
        const normalized = withCanvasAppearanceDefaults({ id: 'product', showImageInfo: value });
        assert.equal(normalized.showImageInfo, value);
        assert.equal(withCanvasAppearanceDefaults(normalized), normalized);
    }
});
test('连线缓存入口复用同一个共享网络组件，避免新旧路径重复绘制', async () => {
    const shared = { shared: true };
    const { CachedConnectionLayer } = await load('扩展功能/画布布局/连线缓存层.tsx', {
        '../画布连线/连线渲染层': { SharedConnectionLayer: shared },
    });
    assert.equal(CachedConnectionLayer, shared);
});
