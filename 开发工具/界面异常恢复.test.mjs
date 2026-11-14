import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(resolve('.运行/3100源/画布副本/web/package.json'));
const ts = require('typescript'), React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const source = name => readFileSync('扩展功能/' + name, 'utf8');
function load(code, imports = {}, globals = {}) {
    const output = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    const module = { exports: {} };
    new Function('require', 'module', 'exports', ...Object.keys(globals), output)(id => {
        if (Object.hasOwn(imports, id)) return imports[id];
        assert.ok(['react', 'react-dom', 'react/jsx-runtime', 'lucide-react'].includes(id), '未提供测试依赖');
        return require(id);
    }, module, module.exports, ...Object.values(globals));
    return module.exports;
}
const descriptions = load(source('存储界面/界面异常说明.ts'));
const viewSource = source('存储界面/界面异常恢复.tsx');
function views(router = {}, react = React, extra = {}) {
    return load(viewSource, { react, 'react-router-dom': router, './界面异常说明': descriptions,
        '../本机存储/启动画面交接.mjs': { finishStartupScreen() {} } }, { __APP_VERSION__: '2.0.0-beta.25', ...extra });
}

test('界面诊断区分循环更新和加载故障，不包含任意异常正文、密钥、产品资料或路径', () => {
    const secret = 'synthetic-' + 'private-product-and-key';
    for (const [message, code] of [
        ['Minified React error #185; ' + secret, 'UI-185'],
        ['Maximum update depth exceeded. ' + secret, 'UI-185'],
        ['Failed to fetch dynamically imported module: /private/' + secret, 'UI-RESOURCE'],
        [secret, 'UI-UNEXPECTED'],
    ]) {
        const value = descriptions.interfaceDiagnostic(new Error(message), '2.0.0-beta.25', '2026-11-04T00:00:00Z');
        assert.equal(value.code, code);
        assert.equal(descriptions.diagnosticText(value).includes(secret), false);
        assert.deepEqual(Object.keys(value).sort(), ['code', 'time', 'version']);
    }
});

test('资源加载失败的手动重试重新获取页面，避免重复使用已失败的模块缓存；不自动刷新', () => {
    let reloads = 0;
    const view = views({
        useRouteError: () => Error('Failed to fetch dynamically imported module'),
        useLocation: () => ({ pathname: '/canvas/original' }),
        useNavigate: () => () => assert.fail('资源错误不能仅重走路由'),
    }, { ...React, useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}] },
    { window: { location: { reload() { reloads++; } } } });
    const element = view.RouteInterfaceRecovery();
    assert.equal(reloads, 0);
    element.props.onRetry(); assert.equal(reloads, 1);
});

test('中文恢复页可直接渲染，不展示开发者堆栈，不将未知编辑报告为已保存', () => {
    const { InterfaceRecoveryView } = views();
    const diagnostic = descriptions.interfaceDiagnostic(new Error('Maximum update depth exceeded.'), '2.0.0-beta.25');
    const html = renderToStaticMarkup(React.createElement(InterfaceRecoveryView, { diagnostic, onRetry() {} }));
    for (const text of ['工作台界面暂时无法显示', '重试打开界面', '复制诊断信息', '是否已保存尚未确认', '诊断信息']) assert.ok(html.includes(text));
    for (const text of ['Unexpected Application Error', 'Hey developer', 'Maximum update depth', 'ErrorBoundary']) assert.equal(html.includes(text), false);
    assert.equal(/<details[^>]*\bopen/.test(html), false);
});

test('路由重试仅重新打开原页面，不刷新浏览器、不调用保存、授权或生成端口', () => {
    const calls = [];
    const view = views({
        useRouteError: () => new Error('Maximum update depth exceeded.'),
        useLocation: () => ({ pathname: '/canvas/original-product', search: '?view=one', hash: '#node' }),
        useNavigate: () => (...args) => calls.push(args),
    }, { ...React, useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}] });
    const element = view.RouteInterfaceRecovery();
    assert.deepEqual(calls, []);
    element.props.onRetry();
    assert.deepEqual(calls, [['/canvas/original-product?view=one#node', { replace: true }]]);
});

test('独立恢复预览通过原生链接打开工作台，明确区分测试页面与真实故障', () => {
    const { InterfaceRecoveryView } = views();
    const diagnostic = descriptions.interfaceDiagnostic(new Error('preview'), '2.0.0-beta.25');
    const html = renderToStaticMarkup(React.createElement(InterfaceRecoveryView, { diagnostic,
        retryHref: 'http://localhost:3000/', previewNotice: '这是恢复页交互预览' }));
    assert.ok(html.includes('<a href="http://localhost:3000/"'));
    assert.ok(html.includes('这是恢复页交互预览'));
    assert.equal((html.match(/<button /g) || []).length, 1);
});

test('通知系统或应用供应器自身崩溃仍由外层中文边界接住，重试只清除界面错误', () => {
    const { InterfaceErrorBoundary, InterfaceRecoveryView } = views();
    const boundary = new InterfaceErrorBoundary({ children: React.createElement('div', null, 'original') });
    boundary.state = InterfaceErrorBoundary.getDerivedStateFromError(new Error('Maximum update depth exceeded.'));
    const rendered = boundary.render();
    assert.equal(rendered.type, InterfaceRecoveryView);
    assert.equal(rendered.props.diagnostic.code, 'UI-185');
    boundary.setState = patch => { boundary.state = { ...boundary.state, ...patch }; };
    rendered.props.onRetry();
    assert.equal(boundary.render().props.children, 'original');
    const entry = source('存储界面/SQLite应用入口.tsx');
    assert.ok(entry.indexOf('<InterfaceErrorBoundary>') < entry.indexOf('<AppProviders>'));
    const patch = readFileSync('上游适配/界面异常恢复入口.patch', 'utf8');
    assert.match(patch, /^\+\s*errorElement: <RouteInterfaceRecovery \/>/m);
});

test('产品重复渲染和切换显隐不重建消息配置或容器回调；更换容器时正确更新', () => {
    const cache = []; let cursor = 0, container = { addEventListener() {}, removeEventListener() {} };
    const react = { ...React, useEffect() {}, useRef: () => ({ current: new Set() }),
        useState: () => [container, () => {}], useMemo(operation, dependencies) {
            const index = cursor++, last = cache[index];
            if (!last || dependencies.some((value, i) => value !== last.dependencies[i])) cache[index] = { value: operation(), dependencies };
            return cache[index].value;
        } };
    const { ProductSurface } = load(source('产品/产品界面边界.tsx'), { react,
        '../主题/页签内容过渡': { useNativeTabFade() {} },
        '../存储界面/消息浮层布局': { useTransientMessageTop: () => 96 },
        antd: { App: 'App', ConfigProvider: 'ConfigProvider' } });
    const render = active => {
        cursor = 0;
        const element = ProductSurface({ id: 'original-product', active, children: 'content' });
        const config = element.props.children.props.children;
        return { config: config.props, app: config.props.children.props };
    };
    const first = render(true), second = render(false);
    assert.equal(second.app.message, first.app.message);
    assert.equal(second.app.notification, first.app.notification);
    assert.equal(second.config.getPopupContainer, first.config.getPopupContainer);
    assert.equal(second.app.message.getContainer(), container);
    container = { addEventListener() {}, removeEventListener() {} };
    const changed = render(true);
    assert.notEqual(changed.app.message, first.app.message);
    assert.equal(changed.app.message.getContainer(), container);
});
