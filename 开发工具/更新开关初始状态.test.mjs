import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../.运行/3100源/画布副本/web/package.json', import.meta.url));
const ts = require('typescript');
const jsx = (type, props, key) => ({ type, props: props || {}, key });
function flatten(node) {
    if (Array.isArray(node)) return node.flatMap(flatten);
    if (!node || typeof node !== 'object') return [];
    if (typeof node.type === 'function') return flatten(node.type(node.props));
    return [node, ...flatten(node.props.children), ...flatten(node.props.leadingActions)];
}
function fixture() {
    let status = null, unavailable = false, saving = false, fail = false, pending;
    const writes = [], notices = [];
    const deps = {
        react: { useState: () => [saving, value => { saving = value; }] }, 'react/jsx-runtime': { jsx, jsxs: jsx },
        antd: { App: { useApp: () => ({ message: { success: text => notices.push(['success', text]), error: text => notices.push(['error', text]) } }) }, Button: 'Button', Switch: 'Switch', Skeleton: { Button: 'Skeleton' } },
        '@/扩展功能/主题/原生可关闭浮层': { OutsideSelect: 'Select' }, '@/constant/env': { formatDisplayVersion: value => value },
        '@/hooks/use-version-check': { useVersionCheck: () => ({ status, unavailable, currentVersion: 'test', checking: false, refresh: async () => { if (pending) status = { ...status, preferences: { ...status.preferences, ...pending } }; }, checkLatestRelease: async () => writes.push(['check']) }) },
        './软件更新客户端': { updateMessages: {}, updateRequest: async (operation, input) => { writes.push([operation, input]); if (fail) throw Error('保存失败'); pending = input; } },
        './在线安装操作': { OnlineInstallActions: 'InstallActions' },
    };
    const module = { exports: {} };
    const source = readFileSync(new URL('../扩展功能/软件更新/软件更新设置.tsx', import.meta.url), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    new Function('require', 'module', 'exports', code)(name => { assert.ok(name in deps, name); return deps[name]; }, module, module.exports);
    return { writes, notices, source,
        load(values, allowed = true) { status = { preferences: { network: 'auto', ...values }, download: { state: 'idle' }, install: { allowed, state: 'idle' }, history: [], state: 'up-to-date' }; },
        unavailable() { status = null; unavailable = true; }, fail() { fail = true; },
        render() { return flatten(module.exports.ConfigSoftwareUpdates({ active: true })); },
    };
}
const switches = tree => tree.filter(node => node.type === 'Switch');
const settle = () => new Promise(resolve => setImmediate(resolve));

test('首次读取没有假开关状态，拿到真实值才首次挂载四个原生Switch', () => {
    for (const values of [
        { autoCheck: true, autoDownload: true, autoInstall: true, developerMode: true },
        { autoCheck: true, autoDownload: true, autoInstall: false, developerMode: false },
    ]) {
        const f = fixture(), loading = f.render();
        assert.equal(switches(loading).length, 0); assert.equal(loading.filter(node => node.props['data-update-preference-placeholder'] !== undefined).length, 4);
        assert.equal(loading.find(node => node.props['aria-busy']).props.role, 'status');
        assert.ok(loading.filter(node => node.type === 'Skeleton').every(node => node.props.active === false && node.props.style.width === 44 && node.props.style.height === 22));
        const network = loading.find(node => node.type === 'Select'); assert.equal(network.props.value, undefined); assert.equal(network.props.disabled, true);
        f.load(values, false); const ready = switches(f.render());
        assert.deepEqual(ready.map(node => node.props.checked), Object.values(values));
        assert.equal(ready[2].props.disabled, true, '未允许自动安装时，显示真实状态并保持禁用');
        assert.deepEqual(f.writes, [], '加载本身不得写设置或检查更新');
    }
});
test('轮询和重新打开不强制重建已就绪开关，保留原生后续切换动画', () => {
    const values = { autoCheck: true, autoDownload: true, autoInstall: true, developerMode: true };
    const f = fixture(); f.load(values);
    for (let i = 0; i < 5; i++) {
        const controls = switches(f.render());
        assert.equal(controls.length, 4); assert.ok(controls.every(node => node.type === 'Switch' && node.props.checked === true && node.key === undefined && node.props.style === undefined));
    }
    const reopened = fixture(); assert.equal(switches(reopened.render()).length, 0); reopened.load(values);
    assert.deepEqual(switches(reopened.render()).map(node => node.props.checked), [true, true, true, true]);
    assert.doesNotMatch(f.source, /checked=\{prefs\?\.[^}]*\?\?/);
});
test('真实用户切换仍提交一次并刷新，保存阶段不可重复点击，开发者模式保留更新检查', async () => {
    const f = fixture(); f.load({ autoCheck: true, autoDownload: true, autoInstall: true, developerMode: true });
    switches(f.render())[2].props.onChange(false);
    assert.ok(switches(f.render()).every(node => node.props.disabled)); await settle();
    assert.deepEqual(f.writes, [['preferences', { autoInstall: false }]]); assert.equal(switches(f.render())[2].props.checked, false);
    switches(f.render())[3].props.onChange(false); await settle();
    assert.deepEqual(f.writes.slice(1), [['preferences', { developerMode: false }], ['check']]);
    assert.equal(switches(f.render())[3].props.checked, false);
});
test('读取不可用不展示假默认值，保存失败保留真实值并结束保存状态', async () => {
    const f = fixture(); f.unavailable(); assert.equal(switches(f.render()).length, 0);
    f.load({ autoCheck: true, autoDownload: true, autoInstall: true, developerMode: true }); f.fail();
    switches(f.render())[3].props.onChange(false); await settle();
    assert.equal(switches(f.render())[3].props.checked, true); assert.equal(switches(f.render())[3].props.disabled, false);
    assert.deepEqual(f.notices, [['error', '保存失败']]);
});
