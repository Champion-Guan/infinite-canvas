import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { variantFixture, variantModules } from './产品变体生成夹具.mjs';
import { 执行有界构建命令 } from './有界构建进程.mjs';

// 挂载真实策划按钮，模型与保存端口使用确定的合成返回，不访问渠道或客户数据。
const temporary = mkdtempSync(resolve('.运行/策划编号交互-'));
try {
    writeFileSync(join(temporary, 'package.json'), JSON.stringify({ private: true, dependencies: { jsdom: '26.1.0' } }));
    await 执行有界构建命令('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false'], {
        cwd: temporary, budgetDirectory: temporary, maxBytes: 128 * 1024 ** 2, reserveBytes: 1024 ** 3,
        env: { ...process.env, npm_config_cache: join(temporary, '缓存'), npm_config_logs_max: '0' },
    });
    const { JSDOM } = createRequire(join(temporary, 'package.json'))('jsdom');
    const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost:3000/', pretendToBeVisual: true });
    for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'Event', 'MouseEvent', 'MutationObserver',
        'ShadowRoot', 'SVGElement', 'DocumentFragment'])
        globalThis[key] = dom.window[key];
    globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
    dom.window.matchMedia = () => ({ matches: true, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const require = createRequire(resolve('.运行/3100源/画布副本/web/package.json'));
    const React = require('react'), { createRoot } = require('react-dom/client'), el = React.createElement;
    const base = variantFixture(), parameter = base.parameter, scopes = [], snapshots = [];
    Object.assign(parameter.metadata, { productPlatform: '未指定', productVariants: undefined, productSharedImageIds: undefined });
    let nodes = [parameter], connections = [], sequence = 0, taskCount = 0, force = () => {};
    const text = { chinese: '展示实际商品，保持参考中的结构与数量。', english: 'Show the actual product, preserving the referenced structure and quantity.' };
    const field = { id: 'load', label: '实测承重', question: '实测承重是多少', kind: 'number', unit: 'kg',
        scope: 'shared', scopes: [], imageKeys: ['detail'], fallback: '未确认不显示承重' };
    function plan(broken) {
        return {
            protocolVersion: 'product-image-plan.v2',
            overview: { buyers: '买家', sellingPoints: '实物', concerns: '结构', consistency: '参考', sequence: '原任务' },
            style: '真实商品摄影', assumptions: [], pendingFacts: [], confirmations: [field],
            images: ['main', 'detail'].map((key, index) => ({
                key: broken ? 'detail' : key, kind: index ? 'carousel' : 'main', name: index ? '结构细节' : '主视觉',
                buyerQuestion: '实际商品怎样', evidence: '实物照片', composition: '完整商品与细节', constraints: '保留真实结构',
                checks: '核对图片', delivery: { width: 1800, height: 2400, format: 'png', maxMB: 10 },
                prompt: {
                    segments: [{ chinese: text.chinese + (index && !broken ? '{{fact:load}}' : ''),
                        english: text.english + (index && !broken ? '{{fact:load}}' : '') }],
                    designSegments: [{ chinese: '折页标题与结构图标，保留必要留白。', english: 'Use a folded heading and structural icon with clear safe margins.' }],
                    conditions: index ? [{
                        factId: 'load', unknown: { chinese: '不显示承重', english: 'Show no load figure' },
                        known: { chinese: broken ? '有承重' : '显示{{value}}{{unit}}', english: broken ? 'Show a load figure' : 'Show {{value}}{{unit}}' },
                    }] : [],
                }, variants: {},
            })),
        };
    }
    const responses = [plan(true), plan(true), plan(false)];
    const loader = variantModules({
        react: React, 'react/jsx-runtime': require('react/jsx-runtime'), antd: require('antd'), 'lucide-react': require('lucide-react'),
        'motion/react': require('motion/react'),
        nanoid: { nanoid: () => 'created-' + ++sequence },
        '@/stores/use-config-store': { useConfigStore: { getState: () => ({
            config: { imageModel: 'synthetic-image', model: 'synthetic-text' }, isAiConfigReady: () => true,
        }) } },
        '@/lib/canvas/canvas-generation-helpers': { buildGenerationConfig: config => ({ ...config, model: 'synthetic-text' }) },
        './图片引用标签': { ImageReferenceText: () => null }, './商品待确认编辑': { ProductConfirmationList: () => null },
        './商品策划流式预览': { useProductPlanningText: () => '' }, './商品策划完成通知': { notifyProductPlanning() {} },
        '../产品/产品操作': { saveProductCanvas: async () => {
            snapshots.push(JSON.stringify({ nodes, connections })); return { persisted: true };
        } },
        '../画布生成/原画布文本调用': {
            confirmSavedCanvasText: async () => {}, queryCanvasTextTask: async () => ({ state: 'succeeded' }),
            requestCanvasText: async request => {
                scopes.push(request.scope.slotId);
                const id = 'synthetic-' + ++taskCount;
                await request.recordTask({ taskId: id, slotId: request.scope.slotId });
                const response = responses.shift();
                assert.ok(response, '不能发出未预期的模型请求');
                await request.applyAndSave(JSON.stringify(response), { taskId: id, responseHash: id + '-hash' });
            },
        },
    });
    const seed = loader.load('Excel画布/商品提示词规则.ts').parseProductImagePlan(JSON.stringify(plan(false)), []);
    Object.assign(parameter.metadata, { productImagePlan: { pendingFacts: [], confirmations: [field] } });
    const originalCards = seed.images.map((brief, index) => ({
        id: 'old-' + index, type: 'guan:product-prompt', title: brief.name, position: { x: 500, y: index * 600 }, width: 440, height: 540,
        metadata: { productImagePrompt: { ...brief, parameterId: parameter.id, generatedSignature: 'old' } },
    }));
    nodes.push(...originalCards);
    const ctx = {
        node: parameter, getNode: id => nodes.find(node => node.id === id), getNodes: () => nodes, getConnections: () => connections,
        updateMetadata: patch => { parameter.metadata = { ...parameter.metadata, ...patch }; force(); },
        applyOps: ops => {
            for (const op of ops) {
                if (op.type === 'update_node') {
                    const node = nodes.find(node => node.id === op.id);
                    Object.assign(node, op.patch || {}); node.metadata = { ...node.metadata, ...op.metadata };
                }
                if (op.type === 'add_node') nodes.push({ id: op.id, type: op.nodeType, title: op.title, position: op.position,
                    width: op.width, height: op.height, metadata: op.metadata });
                if (op.type === 'connect_nodes') connections.push({ id: 'edge-' + connections.length, fromNodeId: op.fromNodeId, toNodeId: op.toNodeId });
            }
            force();
        },
    };
    const { ProductPlanningButton } = loader.load('Excel画布/商品策划按钮.tsx');
    function Page() {
        const [, setVersion] = React.useState(0);
        force = () => setVersion(value => value + 1);
        return el('main', null, el(ProductPlanningButton, { ctx, productId: 'synthetic-product' }),
            el('section', { 'aria-label': '原卡片' }, ...nodes.filter(node => node.type === 'guan:product-prompt')
                .map(node => el('article', { key: node.id, 'data-card-id': node.id }, node.title))));
    }
    const button = label => [...document.querySelectorAll('button')].find(node => node.getAttribute('aria-label') === label);
    let root = createRoot(document.getElementById('root'));
    try {
        await React.act(async () => root.render(el(Page)));
        const originals = nodes.filter(node => node.type === 'guan:product-prompt').map(node => JSON.stringify(node));
        await React.act(async () => { button('AI写提示词').click(); });
        assert.ok(button('继续修正'));
        assert.match(document.querySelector('[role="alert"]').textContent, /图片编号或待确认条件.*继续修正/);
        assert.deepEqual(nodes.filter(node => node.type === 'guan:product-prompt').map(node => JSON.stringify(node)), originals);
        assert.deepEqual(scopes, ['product-image-plan', 'product-image-plan-repair']);
        const persisted = JSON.parse(snapshots.at(-1));
        await React.act(() => root.unmount());
        nodes = persisted.nodes; connections = persisted.connections;
        Object.assign(parameter, nodes.find(node => node.id === parameter.id));
        nodes = nodes.map(node => node.id === parameter.id ? parameter : node);
        root = createRoot(document.getElementById('root'));
        await React.act(async () => root.render(el(Page)));
        assert.ok(button('继续修正'), '冷恢复后保持同一修正入口');
        await React.act(async () => { button('继续修正').click(); });
        assert.ok(button('重新策划'));
        assert.equal(document.querySelector('[role="alert"]'), null);
        assert.deepEqual(scopes, ['product-image-plan', 'product-image-plan-repair', 'product-image-plan-repair']);
        assert.deepEqual(nodes.filter(node => node.type === 'guan:product-prompt').map(node => node.id), ['old-0', 'old-1']);
        assert.equal(parameter.metadata.productPlanningCandidate, undefined);
        const result = { realReact: true, actualPlanningButton: true, duplicateAndConditionErrors: true, preservedOriginalCards: true,
            coldRecovery: true, requestSlots: scopes, onlyOneFullPlanRequest: true, paidRequests: 0, clientDataWrites: 0 };
        const directory = resolve('.运行/策划标识修复验收20261112');
        mkdirSync(directory, { recursive: true });
        writeFileSync(join(directory, '真实React交互.json'), JSON.stringify(result, null, 2) + '\n');
        console.log(JSON.stringify(result));
    } finally { await React.act(() => root.unmount()); dom.window.close(); }
} finally { rmSync(temporary, { recursive: true, force: true }); }
