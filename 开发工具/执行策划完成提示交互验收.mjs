import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { variantModules } from './产品变体生成夹具.mjs';
import { 执行有界构建命令 } from './有界构建进程.mjs';

// 真实React和Ant Design消息浮层，策划与生成均使用模拟回调。
const directory = mkdtempSync(resolve('.运行/策划完成提示交互-'));
try {
    writeFileSync(join(directory, 'package.json'), JSON.stringify({ private: true, dependencies: { jsdom: '26.1.0' } }));
    await 执行有界构建命令('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false'], {
        cwd: directory, budgetDirectory: directory, maxBytes: 128 * 1024 ** 2, reserveBytes: 1024 ** 3,
        env: { ...process.env, npm_config_cache: join(directory, '缓存'), npm_config_logs_max: '0' },
    });
    const { JSDOM } = createRequire(join(directory, 'package.json'))('jsdom');
    const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost:3000/', pretendToBeVisual: true });
    for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'Event', 'MouseEvent', 'MutationObserver',
        'ShadowRoot', 'SVGElement', 'DocumentFragment'])
        globalThis[key] = dom.window[key];
    globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const require = createRequire(resolve('.运行/3100源/画布副本/web/package.json'));
    const React = require('react'), { createRoot } = require('react-dom/client');
    const antd = require('antd'), el = React.createElement;
    const loader = variantModules({ react: React, 'react/jsx-runtime': require('react/jsx-runtime'), antd,
        'lucide-react': require('lucide-react') });
    const notice = loader.load('Excel画布/商品策划完成通知.ts');
    const { useProductPlanningSuccessNotice } = loader.load('Excel画布/商品策划完成提示.tsx');
    const calls = [];
    let active = true, projectId = 'original-product';
    function Page() {
        useProductPlanningSuccessNotice({ projectId, active, hasNode: () => true,
            assertActive() { assert.ok(active); }, generateAllConfigNodes: async () => { calls.push(projectId); } });
        return el('main', null, '现有画布');
    }
    const root = createRoot(document.getElementById('root'));
    const render = () => React.act(async () => root.render(el(antd.App, { message: { top: 92 } }, el(Page))));
    const button = label => [...document.querySelectorAll('button')].find(node => node.textContent === label || node.getAttribute('aria-label') === label);
    const notify = async completed => React.act(async () => notice.notifyProductPlanning(projectId, 'parameter', completed));
    try {
        await render();
        await notify(false);
        assert.equal(document.querySelector('.ant-message-notice'), null);
        await notify(true);
        assert.ok(document.body.textContent.includes('AI策划已完成，提示词和生成配置已保存。'));
        assert.ok(document.body.textContent.includes('60 秒后关闭'));
        const start = button('一键生图');
        assert.ok(start);
        const container = start.closest('.ant-message');
        assert.equal(container.style.getPropertyValue('--notification-top'), '92px');
        assert.ok(start.closest('.ant-message-notice-success'));
        const actions = [...start.parentElement.querySelectorAll('button')];
        assert.equal(actions[0], start);
        assert.equal(actions[1].getAttribute('aria-label'), '关闭策划完成提示');
        await React.act(async () => { start.click(); start.click(); });
        assert.deepEqual(calls, ['original-product']);
        await notify(true);
        const closing = button('关闭策划完成提示');
        await React.act(async () => closing.click());
        assert.deepEqual(calls, ['original-product']);
        await notify(true);
        const stale = button('一键生图');
        active = false; await render();
        await React.act(async () => stale.click());
        assert.deepEqual(calls, ['original-product']);
        active = true; projectId = 'other-product'; await render();
        assert.equal(button('一键生图'), undefined);
        console.log(JSON.stringify({ realReactAndAntdMessage: true, top: 92, successOnly: true, countdown: 60,
            rightSideAction: true, singleBatchCall: true, close: true, productSwitchBlocked: true, paidRequests: 0 }));
    } finally { await React.act(() => root.unmount()); dom.window.close(); }
} finally { rmSync(directory, { recursive: true, force: true }); }
