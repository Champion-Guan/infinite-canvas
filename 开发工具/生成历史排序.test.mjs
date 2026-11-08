import test from 'node:test';
import assert from 'node:assert/strict';
import { sortGenerationHistory } from '../扩展功能/生成历史/历史排序.js';
import { historyDownloadFiles } from '../扩展功能/生成历史/历史下载文件.js';

const nodes = titles => titles.map((title, index) => ({ id: String(index), title, type: 'image',
    metadata: { status: 'success', content: `image:${index}` } }));
const titles = history => history.map(node => node.title);

test('先按末尾数字后缀排列，同一后缀再按名称排列，严格匹配用户示例', () => {
    assert.deepEqual(titles(sortGenerationHistory(nodes(['数字0-1', '数字3-2', '数字0-2', '数字3-1']))),
        ['数字0-1', '数字3-1', '数字0-2', '数字3-2']);
    const source = nodes([' · 数字0-1', ' · 数字0-2', ' · 数字0-3', ' · 数字1-1', ' · 数字3-1', ' · 数字2-1',
        ' · 数字0-4', ' · 数字7-1', ' · 数字4-1', ' · 数字6-1', ' · 数字9-1', ' · 数字8-1', ' · 数字5-1',
        ' · 数字10-1', ' · 数字2-10', ' · 数字2-2']);
    const original = structuredClone(source);
    const sorted = sortGenerationHistory(source);
    assert.deepEqual(titles(sorted), [' · 数字0-1', ' · 数字1-1', ' · 数字2-1', ' · 数字3-1', ' · 数字4-1',
        ' · 数字5-1', ' · 数字6-1', ' · 数字7-1', ' · 数字8-1', ' · 数字9-1', ' · 数字10-1',
        ' · 数字0-2', ' · 数字2-2', ' · 数字0-3', ' · 数字0-4', ' · 数字2-10']);
    assert.deepEqual(source, original, '仅调整展示顺序，关闭排序仍能恢复原请求顺序');
    assert.ok(sorted.every(node => source.includes(node)), '不改任务身份、媒体或状态');
    assert.deepEqual(titles(sortGenerationHistory(sorted)), titles(sorted));
});

test('类别和名称中的数字不能优先于末尾编号，十号在二号之后', () => {
    const source = nodes(['主图-10', '详情页10-1', '详情页2-2', '详情页1-10', '详情页2-1']);
    const result = sortGenerationHistory(source);
    assert.deepEqual(titles(result).slice(0, 3), ['详情页2-1', '详情页10-1', '详情页2-2']);
    assert.ok(result.slice(3).every(node => node.title.endsWith('-10')));
    assert.deepEqual(titles(sortGenerationHistory(nodes(['数字2－10', '数字0－2', '数字3－1']))),
        ['数字3－1', '数字0－2', '数字2－10']);
});

test('同名任务保持稳定顺序，空名称和大小写等价名称不丢失或交替移动', () => {
    const source = nodes(['数字2-1', '', '数字2-1', undefined, 'bag2', 'Bag2', 'bag10']);
    const sorted = sortGenerationHistory(source);
    assert.deepEqual(sorted.filter(node => node.title === '数字2-1').map(node => node.id), ['0', '2']);
    assert.deepEqual(sorted.filter(node => !node.title).map(node => node.id), ['1', '3']);
    assert.deepEqual(sorted.filter(node => /bag2/i.test(node.title)).map(node => node.id), ['4', '5']);
    assert.equal(new Set(sorted.map(node => node.id)).size, source.length);
});

test('排序同时调整总览和下载文件的顺序，已选文件ID与原始批次槽位保持一致', () => {
    const source = nodes(['数字3-1', '数字2-1', '数字0-4', '数字0-1']);
    source[1].metadata = { status: 'success', images: [
        { id: 'one', name: '数字2-1', status: 'success', content: 'image:one' },
        { id: 'two', name: '数字2-2', status: 'success', content: 'image:two' },
    ] };
    const before = historyDownloadFiles(source), selected = new Set([before[1].id, before[3].id]);
    const after = historyDownloadFiles(sortGenerationHistory(source));
    assert.deepEqual(after.map(file => file.name), ['数字0-1', '数字2-1', '数字2-2', '数字3-1', '数字0-4']);
    assert.deepEqual([...after.map(file => file.id)].sort(), [...before.map(file => file.id)].sort());
    assert.deepEqual(after.filter(file => selected.has(file.id)).map(file => file.name), ['数字2-1', '数字0-4']);
    assert.deepEqual(before.map(file => file.name), ['数字3-1', '数字2-1', '数字2-2', '数字0-4', '数字0-1']);
});
