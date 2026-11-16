import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { variantModules } from './产品变体生成夹具.mjs';

test('不同缺模型原因生成独立通知，同一原因重复点击复用原通知', () => {
    let notice = null;
    const effects = [], shown = { current: undefined }, calls = [];
    const warning = options => calls.push(options);
    const { MissingModelConfigurationNotice } = variantModules({
        react: { useRef: () => shown, useEffect: fn => effects.push(fn),
            useSyncExternalStore: (_subscribe, snapshot) => snapshot() },
        antd: { App: { useApp: () => ({ message: { warning } }) } },
        '../产品配置/模型配置通知': { missingModelNoticeSnapshot: () => notice, subscribeMissingModelNotice() {} },
    }).load('存储界面/模型配置提示.tsx');
    for (const [index, message] of ['请添加音频模型', '请添加视频模型', '请添加音频模型'].entries()) {
        notice = { sequence: index + 1, message };
        MissingModelConfigurationNotice(); effects.splice(0).forEach(fn => fn());
    }
    assert.equal(calls.length, 3);
    assert.notEqual(calls[0].key, calls[1].key);
    assert.equal(calls[0].key, calls[2].key);
    assert.deepEqual(calls.map(call => call.content), ['请添加音频模型', '请添加视频模型', '请添加音频模型']);
    MissingModelConfigurationNotice(); effects.splice(0).forEach(fn => fn());
    assert.equal(calls.length, 3, '同一次通知重渲染不重复弹出');
});

test('原生选择器、菜单与二级菜单共用单一进退场样式，无入口独立滑动或缩放动画', () => {
    const source = file => readFileSync(file, 'utf8');
    const css = source('扩展功能/主题/下拉菜单动效.module.css');
    assert.match(css, /reveal 220ms cubic-bezier\(\.22, 1, \.36, 1\)/);
    assert.match(css, /dismiss 220ms cubic-bezier\(\.22, 1, \.36, 1\)/);
    assert.match(css, /prefers-reduced-motion: reduce/);
    assert.match(css, /animation-duration: 1ms/);
    assert.match(css, /pointer-events: none/);
    const wrapper = source('扩展功能/主题/原生可关闭浮层.tsx');
    assert.equal((wrapper.match(/transitionName="guan-option"/g) || []).length, 2);
    assert.equal((wrapper.match(/motionName: "guan-option"/g) || []).length, 2);
    for (const path of ['扩展功能/Excel画布/产品选项下拉.tsx',
        '.运行/3100源/画布副本/web/src/components/ui/select.tsx']) {
        const input = source(path);
        assert.match(input, /motionStyles.radix/);
        assert.doesNotMatch(input, /animate-in|animate-out|slide-in|zoom-in|duration-100/);
    }
});
