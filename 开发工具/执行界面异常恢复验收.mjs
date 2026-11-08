import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { 执行有界构建命令 } from './有界构建进程.mjs';
import { generateRecoveryPreview } from './生成界面恢复预览.mjs';

// 只在临时DOM中运行真实React/Router；不启动服务、不访问客户数据或收费渠道。
const root = process.cwd(), temporary = mkdtempSync(join(root, '.运行/界面恢复DOM-'));
try {
    writeFileSync(join(temporary, 'package.json'), JSON.stringify({ private: true, dependencies: { jsdom: '26.1.0' } }));
    await 执行有界构建命令('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false'], {
        cwd: temporary, budgetDirectory: temporary,
        env: { ...process.env, npm_config_cache: join(temporary, '缓存'), npm_config_logs_max: '0' },
    });
    const { JSDOM } = createRequire(join(temporary, 'package.json'))('jsdom');
    const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
        url: 'http://localhost:3000/canvas/original-product', pretendToBeVisual: true,
    });
    for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'SVGElement', 'MutationObserver'])
        globalThis[key] = dom.window[key];
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const require = createRequire(resolve('.运行/3100源/画布副本/web/package.json'));
    const React = require('react'), { createRoot } = require('react-dom/client'), router = require('react-router-dom');
    const ts = require('typescript');
    function load(name, imports = {}) {
        const source = readFileSync(join(root, '扩展功能/存储界面', name), 'utf8');
        const output = ts.transpileModule(source, { compilerOptions: {
            module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
        } }).outputText;
        const module = { exports: {} };
        new Function('require', 'module', 'exports', '__APP_VERSION__', output)(
            id => Object.hasOwn(imports, id) ? imports[id] : require(id), module, module.exports, '2.0.0-beta.25');
        return module.exports;
    }
    const descriptions = load('界面异常说明.ts');
    const views = load('界面异常恢复.tsx', { './界面异常说明': descriptions });
    let failed = true, copied = '';
    Object.defineProperty(dom.window.navigator, 'clipboard', { configurable: true, value: { writeText: async text => { copied = text; } } });
    Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
    const Bomb = () => {
        if (failed) throw Error('Maximum update depth exceeded. synthetic-private-marker');
        return React.createElement('div', { role: 'status' }, '原产品界面已恢复');
    };
    const memoryRouter = router.createMemoryRouter([{ path: '*', element: React.createElement(Bomb),
        errorElement: React.createElement(views.RouteInterfaceRecovery) }], { initialEntries: ['/canvas/original-product'] });
    const app = createRoot(document.getElementById('root'));
    const originalError = console.error, originalWarn = console.warn;
    console.error = () => {}; console.warn = () => {};
    try {
        await React.act(() => app.render(React.createElement(router.RouterProvider, { router: memoryRouter })));
        assert.ok(document.body.textContent.includes('工作台界面暂时无法显示'));
        assert.equal(document.body.textContent.includes('synthetic-private-marker'), false);
        const buttons = () => [...document.querySelectorAll('button')];
        await React.act(async () => buttons().find(button => button.textContent === '复制诊断信息').click());
        assert.ok(copied.includes('UI-185'));
        assert.equal(copied.includes('synthetic-private-marker'), false);
        for (const clipboard of [undefined, { writeText: async () => { throw Error('denied'); } }]) {
            Object.defineProperty(dom.window.navigator, 'clipboard', { configurable: true, value: clipboard });
            await React.act(async () => buttons().find(button => button.textContent.includes('诊断信息')).click());
            assert.ok(document.body.textContent.includes('浏览器未允许自动复制'));
            const field = document.querySelector('textarea');
            assert.equal(document.querySelector('details').open, true);
            assert.equal(document.activeElement, field);
            assert.equal(field.selectionEnd - field.selectionStart, field.value.length);
        }
        failed = false;
        await React.act(async () => buttons().find(button => button.textContent === '重试打开界面').click());
        assert.ok(document.body.textContent.includes('原产品界面已恢复'));
        assert.equal(memoryRouter.state.location.pathname, '/canvas/original-product');
        failed = true;
        await React.act(() => app.render(React.createElement(views.InterfaceErrorBoundary, null, React.createElement(Bomb))));
        assert.ok(document.body.textContent.includes('工作台界面暂时无法显示'));
        failed = false;
        await React.act(async () => buttons().find(button => button.textContent === '重试打开界面').click());
        assert.ok(document.body.textContent.includes('原产品界面已恢复'));
        const directory = join(root, '开发文档/验收记录/界面异常20261104');
        mkdirSync(directory, { recursive: true });
        const origin = JSON.parse(readFileSync(join(root, '.运行/开发版3100/进程.json'), 'utf8')).origin;
        const html = await generateRecoveryPreview({ component: views.InterfaceRecoveryView,
            diagnostic: descriptions.interfaceDiagnostic(new Error('Maximum update depth exceeded.'), '2.0.0-beta.25'),
            workbenchUrl: origin, write: false });
        let previewCopied = '', previewDestination = '';
        const previewErrors = [];
        const previewDom = new JSDOM(html, { url: 'file:///recovery-preview.html', runScripts: 'dangerously',
            pretendToBeVisual: true, beforeParse(window) {
                Object.defineProperty(window.navigator, 'clipboard', { configurable: true,
                    value: { writeText: async text => { previewCopied = text; } } });
                window.document.addEventListener('click', event => {
                    const link = event.target.closest?.('a');
                    if (link) { previewDestination = link.href; event.preventDefault(); }
                });
            } });
        previewDom.virtualConsole.on('jsdomError', error => previewErrors.push(error.message));
        const waitFor = async condition => {
            for (let attempt = 0; attempt < 100; attempt++) {
                if (condition()) return;
                await new Promise(resolve => setTimeout(resolve, 10));
            }
            assert.fail('交互预览没有响应');
        };
        try {
            const preview = previewDom.window.document;
            const copyButton = preview.querySelector('button');
            copyButton.click();
            await waitFor(() => copyButton.textContent.includes('已复制'));
            assert.ok(previewCopied.includes('UI-185'));
            assert.ok(preview.body.textContent.includes('这是恢复页交互预览'));
            Object.defineProperty(previewDom.window.navigator, 'clipboard', { value: undefined });
            copyButton.click();
            await waitFor(() => preview.body.textContent.includes('浏览器未允许自动复制'));
            const field = preview.querySelector('textarea');
            assert.equal(preview.querySelector('details').open, true);
            assert.equal(preview.activeElement, field);
            assert.equal(field.selectionEnd - field.selectionStart, field.value.length);
            preview.querySelector('a').click();
            assert.equal(previewDestination, new URL(origin).href);
            assert.deepEqual(previewErrors, []);
        } finally { previewDom.window.close(); }
        writeFileSync(join(directory, '恢复页面.html'), html);
        const result = { routeRecovered: true, originalRouteRetained: true, outerBoundaryRecovered: true,
            diagnosticCopied: true, clipboardUnavailableSelected: true, clipboardDeniedSelected: true,
            interactivePreviewCopied: true, interactivePreviewFallbackSelected: true, previewRetryLink: true,
            privateErrorTextOmitted: true, paidRequests: 0 };
        writeFileSync(join(directory, 'DOM验收.json'), JSON.stringify(result, null, 2) + '\n');
        console.log(JSON.stringify(result));
    } finally {
        await React.act(() => app.unmount()); memoryRouter.dispose();
        console.error = originalError; console.warn = originalWarn; dom.window.close();
    }
} finally { rmSync(temporary, { recursive: true, force: true }); }
