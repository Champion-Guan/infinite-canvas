import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { transformWithEsbuild } from '../.运行/3100源/画布副本/web/node_modules/vite/dist/node/index.js';

const require = createRequire(new URL('../.运行/3100源/画布副本/web/package.json', import.meta.url));
const React = require('react'), { renderToString } = require('react-dom/server');
async function load(name, dependencies = {}) {
    const source = readFileSync(new URL('../扩展功能/生成历史/' + name, import.meta.url), 'utf8');
    const { code } = await transformWithEsbuild(source, name, { loader: name.endsWith('.tsx') ? 'tsx' : name.endsWith('.ts') ? 'ts' : 'js', jsx: 'automatic', format: 'cjs', target: 'es2022', tsconfigRaw: '{}' });
    const module = { exports: {} };
    new Function('require', 'module', 'exports', code)(id => {
        assert.ok(Object.hasOwn(dependencies, id), '未声明依赖：' + id);
        return dependencies[id];
    }, module, module.exports);
    return module.exports;
}
const library = await load('虚拟列表依赖.js', { react: React, 'react-dom': require('react-dom') });
const rules = await load('历史虚拟化规则.ts');
const { HistoryVirtualList } = await load('历史虚拟列表.tsx', {
    react: React, 'react/jsx-runtime': require('react/jsx-runtime'), './虚拟列表依赖': library, './历史虚拟化规则': rules,
});
const records = Array.from({ length: 10_000 }, (_, index) => ({ id: `history-${index}` }));
const getKey = item => item.id;

test('浏览器依赖产物可按原生ESM加载，不能遗留CommonJS动态require', async () => {
    const source = readFileSync(new URL('../扩展功能/生成历史/虚拟列表依赖.js', import.meta.url), 'utf8');
    assert.ok(!source.includes('Dynamic require of'));
    const temp = mkdtempSync(new URL('../.运行/3100源/画布副本/web/.历史依赖冒烟-', import.meta.url));
    try {
        const file = join(temp, '依赖.mjs');
        copyFileSync(new URL('../扩展功能/生成历史/虚拟列表依赖.js', import.meta.url), file);
        const native = await import(pathToFileURL(file));
        assert.equal(typeof native.useVirtualizer, 'function');
        assert.equal(typeof native.Virtualizer, 'function');
    } finally { rmSync(temp, { recursive: true, force: true }); }
});

function renderWindow(items, offset = 0, extra = {}) {
    const rendered = [];
    const html = renderToString(React.createElement(HistoryVirtualList, {
        items, getKey, estimateSize: 72, gap: 6, label: '合成历史列表', offsetRef: { current: offset }, ...extra,
        children: (item, index) => { rendered.push({ id: item.id, index }); return React.createElement('button', null, item.id); },
    }));
    return { rendered, html };
}

test('真实React与虚拟引擎渲染一万条历史，首屏只挂载视区及缓冲记录', () => {
    const result = renderWindow(records);
    assert.ok(result.rendered.length > 0 && result.rendered.length <= 20);
    assert.equal(result.rendered[0].id, 'history-0');
    assert.ok(!result.html.includes('>history-9999<'));
    assert.match(result.html, /aria-setsize="10000"/);
    assert.match(result.html, /data-history-total="10000"/);
});
test('启用排序动效仍只挂载原可见窗口，稳定ID仅加在要播放的虚拟项', () => {
    for (const extra of [{ animateSort: true }, { animateSort: true, minColumnWidth: 300 }]) {
        const result = renderWindow(records, 0, extra);
        assert.ok(result.rendered.length <= 20);
        assert.equal((result.html.match(/data-history-sort-key=/g) || []).length, result.rendered.length);
    }
    assert.doesNotMatch(renderWindow(records).html, /data-history-sort-key=/);
});

test('恢复深处滚动位置直接渲染目标附近，末尾记录可达', () => {
    const middle = renderWindow(records, 5000 * 78);
    assert.ok(middle.rendered.length <= 24);
    assert.ok(middle.rendered.some(item => item.id === 'history-5000'));
    assert.ok(!middle.rendered.some(item => item.id === 'history-0'));
    const end = renderWindow(records, 9999 * 78 - 400);
    assert.ok(end.rendered.some(item => item.id === 'history-9999'));
    assert.ok(end.rendered.length <= 24);
});

test('动态高度与稳定ID交由真实虚拟引擎处理，变高后后续记录不会重叠', () => {
    const { Virtualizer, defaultRangeExtractor } = library;
    const options = {
        count: 10000, getScrollElement: () => null, estimateSize: () => 72, getItemKey: index => records[index].id,
        observeElementRect: () => () => {}, observeElementOffset: () => () => {}, scrollToFn() {},
        initialRect: { width: 320, height: 480 }, initialOffset: 0, overscan: 4, gap: 6, rangeExtractor: defaultRangeExtractor,
    };
    const virtualizer = new Virtualizer(options);
    const before = virtualizer.getVirtualItems();
    assert.ok(before.length <= 20);
    virtualizer.resizeItem(0, 220);
    const after = virtualizer.getVirtualItems();
    assert.equal(after[0].size, 220);
    assert.equal(after[1].start, 226);
    for (let index = 1; index < after.length; index++) assert.ok(after[index].start >= after[index - 1].end + 6);
    const reversed = records.slice().reverse();
    virtualizer.setOptions({ ...options, getItemKey: index => reversed[index].id });
    assert.equal(virtualizer.getVirtualItems()[0].key, 'history-9999');
});

test('保留焦点行及其相邻行，连续Tab不因窗口卸载而丢失焦点', () => {
    assert.deepEqual(rules.includeHistoryFocus([20, 21, 22], 0, 100), [0, 1, 20, 21, 22]);
    assert.deepEqual(rules.includeHistoryFocus([20, 21, 22], 99, 100), [20, 21, 22, 98, 99]);
    assert.deepEqual(rules.includeHistoryFocus([20, 21, 22], -1, 100), [20, 21, 22]);
});

test('详情网格保持300px列宽规则，窄屏、宽屏及尾部文件完整', () => {
    assert.equal(rules.historyGridColumns(280, 300, 16, 20), 1);
    assert.equal(rules.historyGridColumns(700, 300, 16, 20), 2);
    assert.equal(rules.historyGridColumns(1100, 300, 16, 20), 3);
    const rows = rules.historyGridRows(records.slice(0, 101), 3);
    assert.equal(rows.length, 34);
    assert.deepEqual(rows.at(-1).map(item => item.id), ['history-99', 'history-100']);
    assert.deepEqual(rows.flat(), records.slice(0, 101));
    const selected = renderWindow(records, 0, { minColumnWidth: 300, estimateSize: 480, gap: 16 });
    assert.ok(selected.rendered.length > 0 && selected.rendered.length <= 3, '全选后详情也只能挂载可见行及一行缓冲');
});

test('单个任务含一万张图片时也按文件虚拟化，不把整批图片藏在一个虚拟行里', () => {
    const node = { id: 'batch', title: '大批次', type: 'image', metadata: { status: 'success' } };
    const files = records.map(item => ({ ...item, node, content: '合成内容' }));
    const tasks = rules.historyTaskRows([node], new Map([[node.id, files]]));
    assert.equal(tasks.length, 10001);
    assert.equal(tasks[0].kind, 'heading');
    assert.equal(tasks[0].first, true); assert.equal(tasks[0].last, false);
    assert.equal(tasks.at(-1).file.id, 'history-9999'); assert.equal(tasks.at(-1).last, true);
    assert.equal(new Set(tasks.map(item => item.id)).size, tasks.length);
    const rendered = renderWindow(tasks, 0, { estimateSize: rules.estimateHistoryTaskRow, gap: 0 });
    assert.ok(rendered.rendered.length <= 20);
    assert.ok(!rendered.rendered.some(item => item.id === tasks.at(-1).id));
});

test('空任务、单张成功文件均可达，分组和下载使用原文件身份', () => {
    const node = { id: 'one', type: 'image', metadata: {} }, empty = { id: 'failed', type: 'image', metadata: { status: 'error' } };
    const file = { id: 'file', node };
    const rows = rules.historyTaskRows([empty, node], new Map([[node.id, [file]]]));
    assert.equal(rows.length, 2);
    assert.equal(rows[0].kind, 'empty');
    assert.equal(rows[1].file, file);
    assert.equal(rows[1].first, true); assert.equal(rows[1].last, true);
});
