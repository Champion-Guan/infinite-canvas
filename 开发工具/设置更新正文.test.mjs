import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readGitHubReleaseNotes } from './GitHub发布说明.mjs';

const require = createRequire(new URL('../.运行/3100源/画布副本/web/package.json', import.meta.url));
const ts = require('typescript'), React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
const { Streamdown } = await import(new URL('../.运行/3100源/画布副本/web/node_modules/streamdown/dist/index.js', import.meta.url));
const source = readFileSync(new URL('../扩展功能/软件更新/GitHub更新正文.tsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const module = { exports: {} };
new Function('require', 'module', 'exports', code)(name => {
    if (name === 'react') return { ...React, lazy: () => Streamdown };
    if (name === 'react/jsx-runtime') return require(name);
    if (name === 'antd') return require(name);
    assert.fail('未声明依赖：' + name);
}, module, module.exports);
const render = notes => renderToStaticMarkup(React.createElement(module.exports.GitHubReleaseNotes, { notes }));

test('设置正文显示发布日期和最新标记，仅相同运行版本显示当前', () => {
    const props = { notes: '# 标题', publishedAt: '2026-11-12T07:06:14Z', version: '2.0.0-beta.29' };
    const current = renderToStaticMarkup(React.createElement(module.exports.GitHubReleaseNotes, { ...props, currentVersion: 'v2.0.0-beta.29' }));
    assert.match(current, /2026-11-12/); assert.match(current, /最新/); assert.match(current, /当前/);
    const other = renderToStaticMarkup(React.createElement(module.exports.GitHubReleaseNotes, { ...props, currentVersion: '2.0.0-beta.28' }));
    assert.doesNotMatch(other, /当前/);
});

test('设置页保留GitHub概述、分节、粗体和嵌套列表，隐藏旧客户兼容条目', () => {
    const notes = readGitHubReleaseNotes(fileURLToPath(new URL('../', import.meta.url)));
    const html = render(notes);
    assert.match(html, /AI-Workbench v2\.0\.0-beta\.29/);
    for (const title of ['新增', '优化', '修复', '使用说明']) assert.match(html, new RegExp('<h2[^>]*>' + title + '</h2>'));
    assert.match(html, /本次重点提升整套商品图的趣味设计/);
    assert.match(html, /<strong[^>]*>桌面入口修复<\/strong>/);
    assert.match(html, /<ul[\s\S]*<ul/);
    assert.doesNotMatch(html, /应用内时间线兼容条目|\[新增\]|\[文档\]/);
});

test('远端说明的脚本、HTML和图片不执行或加载，空正文仍有明确说明', () => {
    const html = render('# 更新\n\n<script>alert("不应执行")</script>\n\n![外图](https://example.invalid/image.png)\n\n<!-- 隐藏说明 -->\n\n正常正文');
    assert.doesNotMatch(html, /<script|<img|隐藏说明/);
    assert.match(html, /正常正文/);
    assert.match(render(''), /暂无更新说明/);
});
