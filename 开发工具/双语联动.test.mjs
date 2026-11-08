import test from 'node:test';
import assert from 'node:assert/strict';
import { variantModules } from './产品变体生成夹具.mjs';

const rules = variantModules().load('提示词/双语片段对齐.ts');
const segments = [
    { chinese: '仅编辑数字0原图', english: 'Edit the digit 0 original photo only' },
    { chinese: '（参考 ID abc-123）；', english: ' (reference ID abc-123); ' },
    { chinese: '保留宽3.2cm和高6cm。', english: 'Keep the width 3.2cm and height 6cm.' },
];
test('双语片段无损拼接并计算字符偏移，任一方向选择短语得到对应译文', () => {
    const pair = rules.readBilingualSegments({ segments });
    assert.equal(pair.chinese, segments.map(segment => segment.chinese).join(''));
    assert.equal(pair.english, segments.map(segment => segment.english).join(''));
    const zh = [0, segments[0].chinese.length], en = [0, segments[0].english.length];
    assert.deepEqual(rules.correspondingRanges(pair.alignment, 'chinese', zh), [en]);
    assert.deepEqual(rules.correspondingRanges(pair.alignment, 'english', en), [zh]);
    assert.deepEqual(rules.correspondingRanges(pair.alignment, 'chinese', [0, pair.chinese.length]), [[0, pair.english.length]]);
    assert.deepEqual(rules.correspondingRanges(pair.alignment, 'chinese', [0, 0]), []);
    assert.deepEqual(rules.bilingualAlignment(pair.chinese, pair.english, pair.alignment), pair.alignment);
});
test('旧全文可按共同数字、参考ID和语句定位，截图中的编辑范围不会高亮整篇英文', () => {
    const pair = rules.readBilingualSegments({ segments });
    const alignment = rules.bilingualAlignment(pair.chinese, pair.english);
    const ranges = rules.correspondingRanges(alignment, 'chinese', [0, segments[0].chinese.length]);
    assert.equal(ranges.length, 1);
    assert.equal(pair.english.slice(...ranges[0]), segments[0].english);
    assert.equal(pair.chinese.slice(...rules.correspondingRanges(alignment, 'english', ranges[0])[0]), segments[0].chinese);
    assert.deepEqual(rules.bilingualAlignment('', pair.english), []);
    assert.deepEqual(rules.bilingualAlignment(pair.chinese, ''), []);
    assert.notDeepEqual(rules.bilingualAlignment(pair.chinese, pair.english, [[-1, 999, 0, 1]]), [[-1, 999, 0, 1]]);
});
test('空或损坏片段不写入提示词，空格、小数、参考ID和HTML原样保留', () => {
    for (const segments of [[], [{ chinese: '中文', english: '' }], [{ chinese: 123, english: 'word' }]])
        assert.throws(() => rules.readBilingualSegments({ segments }), /双语/);
    const pair = rules.readBilingualSegments({ segments: [{ chinese: '  <img>3.2cm ', english: '  <img>3.2cm ' }, { chinese: '中文  ', english: 'text  ' }] });
    assert.equal(pair.chinese, '<img>3.2cm 中文');
    assert.equal(pair.english, '<img>3.2cm text');
    assert.deepEqual(pair.alignment[0], [0, 11, 0, 11]);
});
test('滚动按可滚动距离双向映射，不能滚动、滚动回弹和尺寸变化均不越界', () => {
    assert.equal(rules.linkedScrollTop({ scrollTop: 50, scrollHeight: 200, clientHeight: 100 }, { scrollHeight: 500, clientHeight: 100 }), 200);
    assert.equal(rules.linkedScrollTop({ scrollTop: 200, scrollHeight: 500, clientHeight: 100 }, { scrollHeight: 200, clientHeight: 100 }), 50);
    assert.equal(rules.linkedScrollTop({ scrollTop: 0, scrollHeight: 100, clientHeight: 100 }, { scrollHeight: 200, clientHeight: 100 }), 0);
    assert.equal(rules.linkedScrollTop({ scrollTop: -20, scrollHeight: 200, clientHeight: 100 }, { scrollHeight: 500, clientHeight: 100 }), 0);
    assert.equal(rules.linkedScrollTop({ scrollTop: 200, scrollHeight: 200, clientHeight: 100 }, { scrollHeight: 500, clientHeight: 100 }), 400);
});
