import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../.运行/3100源/画布副本/web/package.json', import.meta.url));
const ts = require('typescript');
const jsx = (type, props, key) => ({ type, props: props || {}, key });
function load(path, dependencies) {
    const source = readFileSync(new URL('../' + path, import.meta.url), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    const module = { exports: {} };
    new Function('require', 'module', 'exports', code)(name => {
        assert.ok(Object.hasOwn(dependencies, name), '未声明依赖：' + name);
        return dependencies[name];
    }, module, module.exports);
    return module.exports;
}
function flatten(node) {
    if (Array.isArray(node)) return node.flatMap(flatten);
    if (!node || typeof node !== 'object') return [];
    if (typeof node.type === 'function') return flatten(node.type(node.props));
    return [node, ...flatten(node.props.children)];
}
const dependencies = {
    'react/jsx-runtime': { jsx, jsxs: jsx },
    antd: { Tag: 'Tag', Timeline: 'Timeline' },
    'react-i18next': { useTranslation: () => ({ t: key => key }) },
    '@/constant/env': { formatDisplayVersion: value => 'v' + value.replace(/^v/, '') },
};
const { ReleaseTimeline } = load('扩展功能/软件更新/版本历史时间线.tsx', dependencies);
const releases = [
    { version: '2.0.0-beta.27', date: '2026-11-08', items: ['新增', '修复', '调整', '优化', '文档'].map(type => ({ type, content: type + '说明\n保留换行' })) },
    { version: '2.0.0-beta.26', date: '2026-11-07', items: [{ type: '更新', content: '旧版原始说明' }] },
];

test('统一时间线保留分类颜色、当前与最新标记、日期、换行及旧版说明', () => {
    const before = structuredClone(releases);
    const tree = flatten(ReleaseTimeline({ releases, currentVersion: 'v2.0.0-beta.27', latestVersion: '2.0.0-beta.27' }));
    assert.equal(tree[0].props['aria-label'], '版本历史');
    const timeline = tree.find(node => node.type === 'Timeline');
    assert.deepEqual(timeline.props.items.map(item => item.key), releases.map(item => item.version));
    const first = flatten(timeline.props.items[0].content);
    const tags = first.filter(node => node.type === 'Tag');
    assert.deepEqual(tags.map(node => node.props.color), ['green', undefined, 'green', 'default', 'red', 'blue', 'purple']);
    assert.deepEqual(tags.slice(0, 2).map(node => node.props.children), ['version.latest', 'version.current']);
    assert.ok(first.some(node => node.props.children === '2026-11-08'));
    assert.ok(first.some(node => node.props.children === '新增说明\n保留换行' && node.props.className.includes('break-words')));
    assert.ok(flatten(timeline.props.items[1].content).some(node => node.props.children === '旧版原始说明'));
    assert.deepEqual(releases, before);
});

test('当前渠道没有可显示历史时说明空状态，不泄露被过滤的Beta记录', () => {
    const tree = flatten(ReleaseTimeline({ releases: [], currentVersion: '2.0.0-beta.27' }));
    assert.equal(tree[0].props['aria-label'], '版本历史');
    assert.equal(tree.some(node => node.type === 'Timeline'), false);
    assert.ok(tree.some(node => node.props.children === '当前渠道暂无版本更新记录'));
});

test('各版本内按新增、优化、修复、调整归类，同类条目稳定且不同版本不混排', () => {
    const input = [
        { version: '2.0.0-beta.29', date: '2026-11-12', items: [
            { type: '修复', content: '修复一' }, { type: '新增', content: '新增一' },
            { type: '调整', content: '调整一' }, { type: '优化', content: '优化一' },
            { type: '新增', content: '新增二' }, { type: '文档', content: '说明一' },
        ] },
        { version: '2.0.0-beta.28', date: '2026-11-10', items: [{ type: '新增', content: '旧版本新增' }] },
    ];
    const before = structuredClone(input);
    const rows = flatten(ReleaseTimeline({ releases: input, currentVersion: input[0].version })).find(node => node.type === 'Timeline').props.items;
    const contents = row => flatten(row.content).filter(node => node.props.className?.includes('break-words')).map(node => node.props.children);
    assert.deepEqual(contents(rows[0]), ['新增一', '新增二', '优化一', '修复一', '调整一', '说明一']);
    assert.deepEqual(contents(rows[1]), ['旧版本新增']);
    assert.deepEqual(input, before);
});

test('当前日志沿用原时间线、彩色标签和正文布局，不增加概述或分组版式', () => {
    const release = { version: '2.0.0-beta.29', date: '2026-11-12', items: [{ type: '新增', content: '图片引用：点击看原图。' }] };
    const timeline = flatten(ReleaseTimeline({ releases: [release], currentVersion: release.version })).find(node => node.type === 'Timeline');
    const elements = flatten(timeline.props.items[0].content);
    assert.ok(elements.some(node => node.props.children === 'v2.0.0-beta.29'));
    assert.ok(elements.some(node => node.type === 'Tag' && node.props.color === 'green'));
    assert.ok(elements.some(node => node.props.children === release.items[0].content && node.props.className.includes('break-words')));
    assert.equal(elements.some(node => ['h4', 'p', 'strong'].includes(node.type)), false);
});

test('设置页原样展示GitHub正文；版本弹窗继续逐条展示完整历史，展示不提交更新操作', () => {
    const actions = [];
    const state = { open: true, currentVersion: '2.0.0-beta.27', latestVersion: '2.0.0-beta.27', releases,
        status: { latest: { version: '2.0.0-beta.27', publishedAt: '2026-11-08T10:30:10Z', notes: '## 2.0.0-beta.27\n+ [新增] 说明' },
            download: { state: 'idle' }, install: { state: 'idle', allowed: false }, history: [] },
        unavailable: false, refresh: async () => actions.push('refresh') };
    const shared = {
        ...dependencies,
        react: { useState: value => [value, () => {}] },
        antd: { ...dependencies.antd, App: { useApp: () => ({ message: {} }) }, Button: 'Button', Switch: 'Switch', Skeleton: { Button: 'Skeleton' } },
        '@/hooks/use-version-check': { useVersionCheck: () => state },
        '@/扩展功能/主题/原生可关闭浮层': { OutsideSelect: 'Select' },
        '@/扩展功能/主题/苹果弹窗': { AppleModal: 'Modal' },
        '@/扩展功能/存储界面/设置视区': { useSettingsViewport: () => null },
        '@/扩展功能/产品/产品界面边界': { useProductActive: () => true },
        './软件更新客户端': { updateMessages: {}, updateRequest: async () => actions.push('request') },
        '@/扩展功能/软件更新/软件更新客户端': { updateMessages: {}, updateRequest: async () => actions.push('request') },
        './在线安装操作': { OnlineInstallActions: 'InstallActions' },
        '@/扩展功能/软件更新/在线安装操作': { OnlineInstallActions: 'InstallActions' },
        './GitHub更新正文': { GitHubReleaseNotes: 'GitHubReleaseNotes' },
        '@/扩展功能/软件更新/版本历史时间线': { ReleaseTimeline },
    };
    const { ConfigSoftwareUpdates } = load('扩展功能/软件更新/软件更新设置.tsx', shared);
    const { VersionReleaseModal } = load('.运行/3100源/画布副本/web/src/components/layout/version-release-modal.tsx', shared);
    const settings = flatten(ConfigSoftwareUpdates({ active: true }));
    const modal = flatten(VersionReleaseModal({}));
    const timeline = tree => tree.find(node => node.type === 'Timeline').props.items;
    assert.equal(settings.filter(node => node.type === 'Timeline').length, 0);
    assert.equal(settings.find(node => node.type === 'GitHubReleaseNotes').props.notes, state.status.latest.notes);
    assert.equal(timeline(modal).length, 2);
    assert.equal(settings.filter(node => node.type === 'InstallActions').length, 1);
    assert.equal(modal.filter(node => node.type === 'InstallActions').length, 1);
    state.status = null;
    state.unavailable = true;
    state.latestVersion = '';
    assert.equal(flatten(ConfigSoftwareUpdates({ active: true })).filter(node => node.type === 'Timeline').length, 0,
        '没有最新发布信息时沿用设置页原行为，不额外添加本地历史区');
    assert.equal(timeline(flatten(VersionReleaseModal({}))).length, 2, '版本弹窗仍保留完整离线历史');
    assert.deepEqual(actions, [], '展示历史不能触发更新请求、设置写入或安装');
});
