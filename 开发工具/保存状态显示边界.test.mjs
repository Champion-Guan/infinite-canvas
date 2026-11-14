import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { transformWithEsbuild } from '../.运行/3100源/画布副本/web/node_modules/vite/dist/node/index.js';

const require = createRequire(new URL('../.运行/3100源/画布副本/web/package.json', import.meta.url));
const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
let status;
let retryError = null, retryCalls = [], reported = [];
const source = '扩展功能/存储界面/保存状态条.tsx';
const { code } = await transformWithEsbuild(readFileSync(source, 'utf8'), source, { loader: 'tsx', format: 'cjs', target: 'es2022', jsx: 'automatic', tsconfigRaw: '{}' });
const module = { exports: {} };
new Function('require', 'module', 'exports', code)(id => {
    if (id === 'react' || id === 'react/jsx-runtime') return require(id);
    if (id === './状态通知区') return { LocalStatusNotice: ({ children }) => React.createElement('div', null, children) };
    if (id === 'lucide-react') return { RotateCcw: () => null };
    if (id === '../主题/状态详情') return { StatusDetails: ({ label }) => React.createElement('button', null, label) };
    if (id === './保存错误通知') return { readReportedSaveFailure: () => '', clearReportedSaveFailure() { reported.push('cleared'); },
        reportSaveFailure(message) { reported.push(message); }, subscribeReportedSaveFailure: () => () => {} };
    if (id === '../本机存储/上游浏览器存储桥') return { storageStatus: () => status,
        async reconnectAndRetrySQLiteStorage() { retryCalls.push('reconnect'); if (retryError) throw retryError; },
        async retrySQLiteStorage() { retryCalls.push('retry'); if (retryError) throw retryError; } };
    throw Error('未声明依赖：' + id);
}, module, module.exports);
const render = value => { status = { state: 'idle', retrying: false, conflict: false, ...value }; return renderToStaticMarkup(React.createElement(module.exports.SQLiteSaveStatus)); };
const details = value => renderToStaticMarkup(React.createElement(module.exports.SQLiteSaveDetails, { status: { state: 'error', retrying: false, conflict: false, ...value } }));

test('状态在顶栏原位置显示，错误详情默认不展开且不泄漏长诊断', () => {
    assert.match(render({ state: 'saving' }), /保存中/);
    assert.match(render({ state: 'saved' }), /已保存/);
    const failed = render({ state: 'error', failure: { code: 'synthetic_failure', stage: 'root' } });
    assert.match(failed, /保存失败/);
    assert.doesNotMatch(failed, /synthetic_failure|position:fixed|部分编辑/);
});
test('普通失败保留重试，版本冲突说明不可重试并提供安全指引', () => {
    assert.match(details({}), /重试保存/);
    assert.match(details({ retrying: true }), /disabled=""|正在重试/);
    const conflict = details({ conflict: true });
    assert.match(conflict, /其他窗口已修改数据/); assert.match(conflict, /重复重试已暂停/);
    assert.match(conflict, /导出当前画布/); assert.doesNotMatch(conflict, /<button/); assert.doesNotMatch(conflict, /已保存到本机/);
    assert.match(render({ state: 'saved' }), /已保存/);
});
test('自动恢复失败和绝对授权到期显示不同原因', () => {
    assert.match(details({ reconnectRequired: true }), /自动恢复本机连接未完成/);
    const expired = details({ reconnectError: 'authorization_expired' });
    assert.match(expired, /页面授权已结束/); assert.doesNotMatch(expired, /自动恢复本机连接未完成/);
});


test('保存失败显示精确阶段与错误码，不显示内容或凭据', () => {
    const html = details({ failure: { code: 'revision_conflict', stage: 'root', status: 409 } });
    assert.match(html, /revision_conflict/); assert.match(html, /提交目录/); assert.match(html, /HTTP 409/);
    assert.match(details({ failure: { code: 'connection_failed', stage: 'fragment' } }), /写入分片/);
});

test('详情只重试原保存，失败保留提醒，确认成功后才清除；连接失效走恢复入口', async () => {
    const elements = node => Array.isArray(node) ? node.flatMap(elements) : node && typeof node === 'object'
        ? [node, ...elements(node.props?.children)] : [];
    const clickRetry = async reconnectRequired => {
        const tree = module.exports.SQLiteSaveDetails({ status: { state: 'error', reconnectRequired, retrying: false } });
        elements(tree).find(node => node.type === 'button').props.onClick();
        await new Promise(resolve => setImmediate(resolve));
    };
    retryCalls = []; reported = []; retryError = Error('原保存仍未确认');
    await clickRetry(false);
    assert.deepEqual(retryCalls, ['retry']);
    assert.deepEqual(reported, ['原保存仍未确认']);
    retryError = null;
    await clickRetry(true);
    assert.deepEqual(retryCalls, ['retry', 'reconnect']);
    assert.deepEqual(reported, ['原保存仍未确认', 'cleared']);
});
