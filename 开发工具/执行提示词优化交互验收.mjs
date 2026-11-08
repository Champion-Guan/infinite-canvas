import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { variantModules } from './产品变体生成夹具.mjs';
import { 执行有界构建命令 } from './有界构建进程.mjs';

// 模拟文本模型响应，不连接收费渠道；临时DOM和依赖结束后清理。
const directory = mkdtempSync(resolve('.运行/提示词优化交互-'));
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
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const require = createRequire(resolve('.运行/3100源/画布副本/web/package.json'));
    const React = require('react'), { createRoot } = require('react-dom/client'), jsx = require('react/jsx-runtime');
    const el = React.createElement;
    const messages = [], calls = [], undo = [];
    let nodes = [{ id: 'prompt', type: 'text', title: '主图提示词', position: { x: 10, y: 20 }, width: 340, height: 240,
        metadata: { content: 'Photograph [COLOR] bag with 3.2cm width and 6cm height. No extra text.' } }];
    let active = true, failSave = false, complete, requestOptions;
    const original = structuredClone(nodes[0]);
    const host = {
        getNode: id => nodes.find(node => node.id === id), getNodes: () => nodes,
        applyOps: ops => { undo.push(structuredClone(nodes)); nodes = nodes.map(node => {
            const op = ops.find(item => item.id === node.id);
            return op ? { ...node, metadata: { ...node.metadata, ...op.metadata } } : node;
        }); },
    };
    const loader = variantModules({
        '../产品配置/模型配置门禁': { ensureModelConfigured: () => true },
        react: React, 'react/jsx-runtime': jsx, 'lucide-react': { Sparkles: () => el('span', null, '*'), ChevronDown: () => el('span', null, '>') },
        './双语联动文本框': { useBilingualPromptSync: () => ({}), BilingualPromptField: ({ link, language, ...props }) => el('textarea', props) },
        './提示词优化窗口.module.css': { default: { field: 'field', stack: 'stack', language: 'language' } },
        antd: {
            App: { useApp: () => ({ message: { warning: value => messages.push(value), success: value => messages.push(value) } }) },
            Tooltip: ({ children, title, trigger }) => {
                assert.ok(title);
                assert.deepEqual(trigger, ['hover', 'focus']);
                return children;
            },
            Button: ({ children, disabled, loading, onClick }) => el('button', { disabled: disabled || loading, onClick }, children),
            Input: { TextArea: ({ autoSize, maxLength, ...props }) => el('textarea', { maxLength, ...props }) },
            Modal: ({ open, title, children, footer, onCancel }) => open ? el('div', { role: 'dialog', 'aria-label': title },
                el('button', { onClick: onCancel }, '关闭'), children, footer) : null,
        },
        '@/stores/use-config-store': { decodeChannelModel: () => null,
            useConfigStore: Object.assign(selector => selector({ config: { model: 'preferred-text' } }), { getState: () => ({ config: { model: 'preferred-text' } }) }) },
        '@/lib/canvas/canvas-generation-helpers': { buildGenerationConfig: config => config },
        '../产品/产品操作': { saveProductCanvas: async id => { calls.push(['save', id]); return { persisted: !failSave }; } },
        './提示词优化请求': { requestPromptOptimization: options => {
            requestOptions = options; calls.push(['request', options.source.id]);
            return new Promise(resolve => { complete = resolve; });
        } },
    });
    const rules = loader.load('提示词/提示词优化规则.ts');
    const { usePromptOptimization } = loader.load('提示词/提示词优化窗口.tsx');
    function Page() {
        const api = usePromptOptimization({ productId: 'product', active, host,
            assertActive() { if (!active) throw Error('已切换画布'); } });
        return el(React.Fragment, null, ...api.optimizationTool(nodes[0]).map(tool =>
            el('button', { key: tool.id, onClick: tool.onClick }, tool.label)), api.optimizationDialog);
    }
    const root = createRoot(document.getElementById('root'));
    const render = () => React.act(() => root.render(el(Page)));
    const button = text => [...document.querySelectorAll('button')].find(node => node.textContent === text);
    const click = async text => { const target = button(text); assert.ok(target, text); await React.act(async () => target.click()); };
    const reply = async () => {
        const result = rules.parseOptimizedPrompt(JSON.stringify({ text: requestOptions.source.text + ' Use soft light.', changes: ['更清晰的构图'] }), requestOptions.source);
        const node = host.getNode(requestOptions.source.id);
        node.metadata.promptOptimizationDraft = { signature: requestOptions.source.signature,
            raw: JSON.stringify(result), instruction: '', model: 'preferred-text', directions: requestOptions.directions };
        await React.act(async () => complete(result));
    };
    try {
        await render(); await click('AI优化');
        assert.equal(document.querySelector('[aria-label="原提示词"]').value, original.metadata.content);
        assert.equal(button('应用到原卡片').disabled, true);
        const chooseDirection = text => [...document.querySelectorAll('label')].find(label => label.textContent === text)?.querySelector('input');
        assert.equal(document.querySelectorAll('input[type="checkbox"]').length, 14);
        await React.act(async () => { chooseDirection('核心卖点图').click(); });
        await React.act(async () => { chooseDirection('使用场景图').click(); });
        await click('开始优化');
        assert.deepEqual(requestOptions.directions, ['selling-points', 'usage-scene']);
        assert.equal(chooseDirection('核心卖点图').disabled, true);
        assert.equal(calls.filter(call => call[0] === 'request').length, 1);
        assert.equal(button('应用到原卡片').disabled, true);
        await reply();
        assert.ok(document.querySelector('[aria-label="优化结果"]').value.includes('soft light'));
        assert.equal(host.getNode('prompt').metadata.content, original.metadata.content);
        await click('取消'); assert.equal(document.querySelector('[role="dialog"]'), null);
        await click('AI优化');
        assert.equal(chooseDirection('核心卖点图').checked, true);
        assert.equal(chooseDirection('使用场景图').checked, true);
        assert.equal(button('应用到原卡片').disabled, false);
        failSave = true; await click('应用到原卡片');
        assert.ok(host.getNode('prompt').metadata.content.includes('soft light'));
        assert.ok(document.body.textContent.includes('保存尚未确认'));
        assert.equal(undo.length, 1);
        failSave = false; await click('重试保存');
        assert.equal(undo.length, 1, '保存重试不重复改写');
        assert.equal(document.querySelector('[role="dialog"]'), null);
        nodes = undo.pop(); await render();
        assert.equal(host.getNode('prompt').metadata.content, original.metadata.content);
        assert.deepEqual(host.getNode('prompt').position, original.position);

        // 迟到响应不能覆盖更新的原文；重新优化可基于最新版本开始。
        delete nodes[0].metadata.promptOptimizationDraft;
        await click('AI优化'); await click('开始优化');
        nodes[0] = { ...nodes[0], metadata: { ...nodes[0].metadata, content: original.metadata.content + ' New instruction.' } };
        await render(); await reply();
        assert.ok(document.body.textContent.includes('原文或关联商品资料已更改'));
        assert.equal(button('应用到原卡片').disabled, true);
        await click('重新优化');
        assert.ok(requestOptions.source.text.includes('New instruction.'));
        await click('取消优化');
        assert.equal(requestOptions.signal.aborted, true);
        await click('取消');

        await click('AI优化'); await click('开始优化');
        active = false; await render();
        assert.equal(requestOptions.signal.aborted, true);
        assert.equal(document.querySelector('[role="dialog"]'), null);
        active = true; await render();
        nodes[0] = { ...nodes[0], metadata: { content: ' ' } }; await render();
        await click('AI优化');
        assert.ok(messages.some(message => message.includes('先填写')));
        assert.equal(document.querySelector('[role="dialog"]'), null);
        console.log(JSON.stringify({ previewBeforeApply: true, restoredDraft: true, inPlaceApply: true, saveRetryWithoutReapply: true,
            undoSnapshot: true, staleApplyBlocked: true, cancelled: true, switchAborted: true, emptyBlocked: true,
            quickDirectionsSubmittedAndRestored: true, paidRequests: 0 }));
    } finally { await React.act(() => root.unmount()); dom.window.close(); }
} finally { rmSync(directory, { recursive: true, force: true }); }
