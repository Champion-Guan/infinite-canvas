import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { variantModules } from './产品变体生成夹具.mjs';
import { 执行有界构建命令 } from './有界构建进程.mjs';

const directory = mkdtempSync(resolve('.运行/双语联动交互-'));
try {
    writeFileSync(join(directory, 'package.json'), JSON.stringify({ private: true, dependencies: { jsdom: '26.1.0' } }));
    await 执行有界构建命令('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false'], {
        cwd: directory, budgetDirectory: directory, maxBytes: 128 * 1024 ** 2, reserveBytes: 1024 ** 3,
        env: { ...process.env, npm_config_cache: join(directory, '缓存'), npm_config_logs_max: '0' },
    });
    const { JSDOM } = createRequire(join(directory, 'package.json'))('jsdom');
    const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost:3000/', pretendToBeVisual: true });
    for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'Event', 'MouseEvent', 'MutationObserver'])
        globalThis[key] = dom.window[key];
    globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
    let observers = 0;
    globalThis.ResizeObserver = class { observe() { observers++; } disconnect() { observers--; } };
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const require = createRequire(resolve('.运行/3100源/画布副本/web/package.json'));
    const React = require('react'), { createRoot } = require('react-dom/client'), el = React.createElement;
    const loader = variantModules({ react: React, 'react/jsx-runtime': require('react/jsx-runtime'),
        './双语联动文本框.module.css': { default: { field: 'linked-field', overlay: 'overlay', mirror: 'mirror' } } });
    const { readBilingualSegments } = loader.load('提示词/双语片段对齐.ts');
    const { useBilingualPromptSync, BilingualPromptField } = loader.load('提示词/双语联动文本框.tsx');
    const pair = readBilingualSegments({ segments: [
        { chinese: '仅编辑数字0原图', english: 'Edit the digit 0 original photo only' },
        { chinese: '，保留商品不变。', english: ', preserving the actual product.' },
    ] });
    let ready = true;
    function Pair({ name }) {
        const link = useBilingualPromptSync({ ...pair, ready });
        return el('section', { 'aria-label': name }, ...['chinese', 'english'].map(language =>
            el(BilingualPromptField, { key: language, language, link, readOnly: true,
                'aria-label': name + language, value: pair[language], rows: 7 })));
    }
    const root = createRoot(document.getElementById('root'));
    const render = () => React.act(async () => root.render(el(React.Fragment, null, el(Pair, { name: '原文' }), el(Pair, { name: '结果' }))));
    const field = name => document.querySelector(`[aria-label="${name}"]`);
    const highlight = name => [...field(name).parentElement.querySelectorAll('mark')].map(mark => mark.textContent).join('');
    const select = async (input, start, end) => {
        await React.act(async () => {
            input.focus(); input.setSelectionRange(start, end); document.dispatchEvent(new dom.window.Event('selectionchange', { bubbles: true }));
            input.dispatchEvent(new dom.window.MouseEvent('mouseup', { bubbles: true }));
        });
    };
    try {
        await render();
        const zh = field('原文chinese'), en = field('原文english'), result = field('结果english');
        for (const [input, height] of [[zh, 400], [en, 800], [result, 800]]) {
            Object.defineProperties(input, { clientHeight: { configurable: true, value: 100 },
                scrollHeight: { configurable: true, value: height }, clientWidth: { configurable: true, value: 300 } });
        }
        await select(zh, 0, 8);
        assert.equal(document.activeElement, zh, '对照高亮不能夺走原文编辑焦点');
        assert.equal(highlight('原文english'), 'Edit the digit 0 original photo only');
        assert.equal(highlight('结果english'), '', '原文与优化结果是独立双语组');
        await select(en, 0, 35);
        assert.equal(highlight('原文chinese'), '仅编辑数字0原图');
        assert.equal(document.activeElement, en);
        await React.act(async () => { zh.scrollTop = 150; zh.dispatchEvent(new dom.window.Event('scroll', { bubbles: true })); });
        assert.equal(en.scrollTop, 350);
        await React.act(async () => en.dispatchEvent(new dom.window.Event('scroll', { bubbles: true })));
        assert.equal(zh.scrollTop, 150, '程序滚动不会反过来循环修改源框');
        await React.act(async () => { en.scrollTop = 700; en.dispatchEvent(new dom.window.Event('scroll', { bubbles: true })); });
        assert.equal(zh.scrollTop, 300);
        assert.equal(result.scrollTop, 0);
        ready = false; await render();
        assert.equal(highlight('原文chinese'), '', '旧英文尚未同步时停止高亮');
        await select(zh, 0, 8); assert.equal(highlight('原文english'), '');
        ready = true; await render(); await select(zh, 0, 8);
        await select(zh, 0, 0); assert.equal(highlight('原文english'), '');
        pair.english += ' Changed.'; await render();
        assert.equal(document.querySelectorAll('.overlay[aria-hidden="true"]').length, 4);
        assert.equal(zh.value, pair.chinese);
        console.log(JSON.stringify({ bidirectionalHighlight: true, bidirectionalScroll: true, noFocusTheft: true,
            noScrollLoop: true, independentGroups: true, staleTranslationNotHighlighted: true,
            textUnchanged: true, paidRequests: 0 }));
    } finally { await React.act(() => root.unmount()); assert.equal(observers, 0); dom.window.close(); }
} finally { rmSync(directory, { recursive: true, force: true }); }
