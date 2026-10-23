import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { transformWithEsbuild } from '../.运行/3100源/画布副本/web/node_modules/vite/dist/node/index.js';

const require = createRequire(new URL('../.运行/3100源/画布副本/web/package.json', import.meta.url));
const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
let status;
const source = '扩展功能/存储界面/保存状态条.tsx';
const { code } = await transformWithEsbuild(readFileSync(source, 'utf8'), source, { loader: 'tsx', format: 'cjs', target: 'es2022', jsx: 'automatic', tsconfigRaw: '{}' });
const module = { exports: {} };
new Function('require', 'module', 'exports', code)(id => {
    if (id === 'react' || id === 'react/jsx-runtime') return require(id);
    if (id === './状态通知区') return { LocalStatusNotice: ({ children }) => React.createElement('div', null, children) };
    if (id === '../本机存储/上游浏览器存储桥') return { storageStatus: () => status, reconnectAndRetrySQLiteStorage() {}, retrySQLiteStorage() {} };
    throw Error('未声明依赖：' + id);
}, module, module.exports);
const render = value => { status = { state: 'idle', retrying: false, conflict: false, ...value }; return renderToStaticMarkup(React.createElement(module.exports.SQLiteSaveStatus)); };

test('正常空闲、保存中、已保存不显示右下角通知', () => {
    for (const state of ['idle', 'saving', 'saved']) assert.equal(render({ state }), '');
});
test('失败与重试期间保留恢复提示，冲突时禁用重试且不宣称已保存', () => {
    assert.match(render({ state: 'error' }), /保存尚未确认/);
    assert.match(render({ state: 'error', retrying: true }), /正在核实并重试保存/);
    const conflict = render({ state: 'error', conflict: true });
    assert.match(conflict, /其他窗口已修改数据/); assert.match(conflict, /disabled/); assert.doesNotMatch(conflict, /已保存到本机/);
    assert.equal(render({ state: 'saved' }), '');
});
test('自动恢复失败和绝对授权到期显示不同原因', () => {
    assert.match(render({ state: 'error', reconnectRequired: true }), /自动恢复本机连接未完成/);
    const expired = render({ state: 'error', reconnectError: 'authorization_expired' });
    assert.match(expired, /页面授权已结束/); assert.doesNotMatch(expired, /自动恢复本机连接未完成/);
});
