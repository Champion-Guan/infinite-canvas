import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Linter } from 'eslint';
import ts from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import { transformWithEsbuild } from '../.运行/3100源/画布副本/web/node_modules/vite/dist/node/index.js';
import { historyDownloadFiles } from '../扩展功能/生成历史/历史下载文件.js';
import { historyMediaInfo } from '../扩展功能/生成历史/历史媒体详情.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(resolve(root, '.运行/3100源/画布副本/web/package.json'));
const { zipSync, unzipSync, strFromU8 } = require('fflate');
const types = { CanvasNodeType: { Image: 'image', Video: 'video' } };
const fixtureNodes = [{ id: 'batch', title: '主图', type: 'image', metadata: {
    status: 'success', generationType: 'image', prompt: '用户原始提示词', primaryImageId: 'a', model: 'model', channel: 'channel',
    images: [{ id: 'a', status: 'success', content: 'data:a', storageKey: 'a', naturalWidth: 900, naturalHeight: 1200, bytes: 10, mimeType: 'image/png' },
        { id: 'b', status: 'success', content: 'data:b', storageKey: 'b', naturalWidth: 1584, naturalHeight: 992, bytes: 20, mimeType: 'image/webp' },
        { id: 'failed', status: 'error', content: 'data:failed' }] } },
{ id: 'single', title: '详情页', type: 'image', metadata: { status: 'success', generationType: 'image', content: 'data:single' } }];
const files = historyDownloadFiles(fixtureNodes);

async function load(name, dependencies) {
    const file = resolve(root, '扩展功能/生成历史', name);
    const { code } = await transformWithEsbuild(readFileSync(file, 'utf8'), file, { loader: name.endsWith('.tsx') ? 'tsx' : 'ts', jsx: 'automatic', format: 'cjs', target: 'es2022', tsconfigRaw: '{}' });
    const module = { exports: {} };
    new Function('require', 'module', 'exports', code)(id => {
        assert.ok(Object.hasOwn(dependencies, id), '未声明依赖：' + id);
        return dependencies[id];
    }, module, module.exports);
    return module.exports;
}

function hookFixture() {
    const cells = []; let cursor = 0;
    const hooks = {
        useState(value) { const index = cursor++; if (!(index in cells)) cells[index] = { value: typeof value === 'function' ? value() : value }; return [cells[index].value, next => { cells[index].value = typeof next === 'function' ? next(cells[index].value) : next; }]; },
        useRef(value) { const [ref] = hooks.useState(() => ({ current: value })); return ref; },
        useMemo: callback => callback(), useCallback: callback => callback, memo: callback => callback, useSyncExternalStore: () => 0,
        useEffect(callback, deps) { const index = cursor++, old = cells[index]; if (!old || deps.some((value, key) => value !== old.deps[key])) { old?.cleanup?.(); cells[index] = { deps, cleanup: callback() }; } },
    };
    return { hooks, render(callback) { cursor = 0; return callback(); }, unmount() { cells.forEach(cell => cell.cleanup?.()); } };
}
const flush = () => new Promise(done => setImmediate(done));

test('按节点/槽位ID选择单张，反选不影响同批其他图片，失败图片不进入详情', async () => {
    const runtime = hookFixture();
    const { useHistorySelection } = await load('历史选择操作.ts', { react: runtime.hooks });
    const render = (items = files, busy = false) => runtime.render(() => useHistorySelection(items, busy));
    let api = render(); api.beginOverviewSelection(); api = render();
    assert.equal(api.selectionMode, true); assert.deepEqual(api.selectedFiles, []);
    api.selectFiles([files[1].id, '不存在']); api = render();
    assert.deepEqual(api.selectedFiles.map(file => file.imageId), ['b']);
    api.selectFiles([files[0].id]); api = render(); api.selectFiles([files[1].id]); api = render();
    assert.deepEqual(api.selectedFiles.map(file => file.imageId), ['a']);
    api = render(files.slice(1)); assert.deepEqual(api.selectedFiles, [], '删除或失效文件立刻从详情消失');
});

test('原选择按钮默认全选，部分批次可补齐全选；下载期间不改变勾选', async () => {
    const runtime = hookFixture();
    const { useHistorySelection } = await load('历史选择操作.ts', { react: runtime.hooks });
    const render = (busy = false) => runtime.render(() => useHistorySelection(files, busy));
    let api = render(); api.toggleSelectionMode(); api = render();
    assert.equal(api.selectedFiles.length, 3);
    api.selectFiles([files[1].id], false); api = render();
    api.selectFiles([files[0].id, files[1].id]); api = render(); assert.equal(api.selectedFiles.length, 3);
    api = render(true); api.selectFiles(files.map(file => file.id), false); api.toggleSelectionMode(); api = render();
    assert.equal(api.selectedFiles.length, 3); assert.equal(api.selectionMode, true);
    api.toggleSelectionMode(); api = render(); assert.deepEqual(api.selectedFiles, []);
});

async function downloadFixture(options = {}) {
    const runtime = hookFixture(), saved = [], messages = [], reads = [];
    const { useHistoryDownloads } = await load('历史下载操作.ts', {
        react: runtime.hooks, 'file-saver': { saveAs: (blob, name) => saved.push({ blob, name }) }, fflate: { zipSync }, '@/types/canvas': types,
        '../画布迁移扩展/media-download': { readDownloadBlob: async request => { reads.push(request); if (options.gate) await options.gate; if (options.fail?.(request)) throw Error('原文件不可用'); return new Blob([request.storageKey || 'single'], { type: options.mime || 'image/webp' }); } },
        './媒体文件扩展': { mediaFileExtension: mime => mime === 'image/webp' ? 'webp' : 'png' },
    });
    const api = runtime.render(() => useHistoryDownloads({ error: value => messages.push(value), info: value => messages.push(value), warning: value => messages.push(value) }));
    return { ...runtime, ...api, saved, messages, reads };
}

test('打包只读取勾选的原持久文件，保留输入顺序、MIME扩展名及同名编号', async () => {
    const api = await downloadFixture();
    await api.downloadAll([{ ...files[1], name: '产品/主图' }, { ...files[0], name: '产品/主图' }]);
    assert.deepEqual(api.reads.map(item => item.storageKey), ['b', 'a']);
    assert.equal(api.saved[0].name, '生成历史.zip');
    const archive = unzipSync(new Uint8Array(await api.saved[0].blob.arrayBuffer()));
    assert.deepEqual(Object.keys(archive), ['产品_主图.webp', '产品_主图-2.webp']);
    assert.equal(strFromU8(archive['产品_主图.webp']), 'b'); assert.equal(strFromU8(archive['产品_主图-2.webp']), 'a');
});

test('单文件原样下载；部分失败提示跳过，全失败不输出空ZIP', async () => {
    const single = await downloadFixture(); await single.downloadFile(files[1]);
    assert.equal(single.saved.length, 1); assert.match(single.saved[0].name, /\.webp$/); assert.equal(await single.saved[0].blob.text(), 'b');
    const partial = await downloadFixture({ fail: request => request.storageKey === 'a' }); await partial.downloadAll(files);
    assert.equal(partial.saved.length, 1); assert.match(partial.messages[0], /跳过 1/);
    const failed = await downloadFixture({ fail: () => true }); await failed.downloadAll(files);
    assert.deepEqual(failed.saved, []); assert.match(failed.messages[0], /没有可下载/);
});

test('重复下载不重复读取；切走原产品卸载后不弹出另一产品的下载', async () => {
    let release; const api = await downloadFixture({ gate: new Promise(done => { release = done; }) });
    const pending = api.downloadAll(files); await api.downloadAll(files);
    assert.equal(api.reads.length, 1);
    api.unmount(); release(); await pending;
    assert.deepEqual(api.saved, []); assert.equal(api.reads.length, 1);
});

test('预览读取当前槽位原文件，移除释放URL，迟到的旧文件不能回写', async t => {
    const created = [], revoked = [], pending = [];
    t.mock.method(URL, 'createObjectURL', blob => { created.push(blob); return 'blob:preview-' + created.length; });
    t.mock.method(URL, 'revokeObjectURL', url => revoked.push(url));
    const runtime = hookFixture();
    const { useHistoryMediaPreview } = await load('历史媒体预览.ts', {
        react: runtime.hooks, '@/types/canvas': types,
        '../画布迁移扩展/media-download': { readDownloadBlob: request => new Promise(done => pending.push({ request, done })) },
    });
    const render = file => runtime.render(() => useHistoryMediaPreview(file));
    render(files[0]); render(files[1]);
    assert.equal(pending[1].request.storageKey, 'b');
    pending[0].done(new Blob(['old'])); await flush(); assert.equal(created.length, 0);
    pending[1].done(new Blob(['new'])); await flush(); assert.equal(render(files[1]).url, 'blob:preview-1');
    runtime.unmount(); assert.deepEqual(revoked, ['blob:preview-1']);
});

test('屏幕外详情不读取原图，进入视区后读取；退出或卸载释放预览', async t => {
    const reads = [], revoked = [];
    t.mock.method(URL, 'createObjectURL', () => 'blob:visible-preview');
    t.mock.method(URL, 'revokeObjectURL', url => revoked.push(url));
    const runtime = hookFixture();
    const { useHistoryMediaPreview } = await load('历史媒体预览.ts', {
        react: runtime.hooks, '@/types/canvas': types,
        '../画布迁移扩展/media-download': { readDownloadBlob: async request => { reads.push(request); return new Blob(['image']); } },
    });
    const render = enabled => runtime.render(() => useHistoryMediaPreview(files[0], enabled));
    render(false); await flush(); assert.equal(reads.length, 0);
    render(true); await flush(); assert.equal(reads.length, 1);
    assert.equal(render(true).url, 'blob:visible-preview');
    render(false); assert.deepEqual(revoked, ['blob:visible-preview']);
    runtime.unmount(); assert.equal(reads.length, 1);
});

function jsx(type, props, key) { return { type, props: props || {}, key }; }
function elements(value) { if (Array.isArray(value)) return value.flatMap(elements); if (!value || typeof value !== 'object') return []; return [value, ...elements(value.props?.children)]; }
const theme = { node: { text: '#111', panel: '#fff', fill: '#eee', stroke: '#ccc' } };

test('总览详情只含已选文件；未勾选缩略图仅打开预览，不自动进入详情', async () => {
    const runtime = hookFixture(), selections = [];
    const { HistoryOverviewPanel } = await load('历史总览面板.tsx', {
        react: runtime.hooks, 'react/jsx-runtime': { jsx, jsxs: jsx }, antd: { Checkbox: 'Checkbox', Empty: 'Empty', Modal: 'Modal', Spin: 'Spin' },
        'lucide-react': { Download: 'Download', Image: 'Image', Video: 'Video' }, '@/lib/image-utils': { formatBytes: size => size + ' B' },
        'motion/react': { useInView: () => true },
        '@/stores/use-config-store': { decodeChannelModel: () => null }, '@/services/image-storage': { previewUrlFor: () => undefined }, '@/types/canvas': types,
        './历史媒体详情': { historyMediaInfo }, './历史媒体预览': { useHistoryMediaPreview: file => ({ url: file.content }) },
        './历史总览面板.module.css': { __esModule: true, default: new Proxy({}, { get: (_object, key) => key }) },
    });
    const props = { history: fixtureNodes, files, selectedFiles: [files[1]], selectedIds: new Set([files[1].id]), downloading: false, theme,
        onSelect: (...args) => selections.push(args), onDownload: () => {}, onDownloadSelected: () => {}, onClose: () => {} };
    const render = () => runtime.render(() => HistoryOverviewPanel(props));
    let tree = render();
    const detailFiles = elements(tree).filter(item => typeof item.type === 'function' && item.props.file).map(item => item.props.file.id);
    assert.deepEqual(detailFiles, [files[1].id]);
    const detail = elements(tree).find(item => typeof item.type === 'function' && item.props.file);
    const detailTree = detail.type(detail.props);
    assert.ok(JSON.stringify(detailTree).includes('1584x992')); assert.ok(!JSON.stringify(detailTree).includes('900x1200'));
    elements(tree).find(item => item.props['aria-label'] === '预览 ' + files[0].name).props.onClick();
    tree = render(); assert.deepEqual(selections, []);
    assert.equal(elements(tree).filter(item => item.type === 'Modal').length, 2);
    assert.deepEqual(elements(tree).filter(item => typeof item.type === 'function' && item.props.file).map(item => item.props.file.id), [files[1].id, files[0].id]);
});

test('选择模式缩略图仅预览、文字才勾选；排序立即切换，总览紧跟下载', async () => {
    const runtime = hookFixture(), previews = [], sorts = [];
    const selection = await load('历史选择操作.ts', { react: runtime.hooks });
    const actionStyles = { default: {} };
    const { HistoryActionButton } = await load('历史操作按钮.tsx', {
        'react/jsx-runtime': { jsx, jsxs: jsx }, antd: { Tooltip: 'Tooltip' },
        '@/lib/utils': { cn: (...values) => values.filter(Boolean).join(' ') }, './历史操作栏.module.css': actionStyles,
    });
    const renderElement = (type, props, key) => type === HistoryActionButton ? type(props) : jsx(type, props, key);
    const { CanvasGenerationHistoryTab } = await load('生成历史页签.tsx', {
        react: runtime.hooks, 'react/jsx-runtime': { jsx: renderElement, jsxs: renderElement }, antd: { App: { useApp: () => ({ message: {} }) }, Checkbox: 'Checkbox', Empty: 'Empty' },
        'lucide-react': Object.fromEntries(['ArrowDownWideNarrow', 'Download', 'Image', 'LayoutGrid', 'ListChecks', 'RotateCcw', 'Video'].map(key => [key, key])),
        'motion/react': { motion: { div: 'motion.div' } }, '@/lib/utils': { cn: (...values) => values.filter(Boolean).join(' ') },
        '@/lib/image-utils': { formatBytes: () => '文件大小' }, './任务摘要': { failedTaskTargets: () => [] }, './历史失败重试': { runHistoryRetries: async () => {} },
        './历史下载文件': { historyDownloadFiles }, './历史媒体详情': { historyMediaInfo }, './历史排序': { sortGenerationHistory: value => value },
        './历史下载操作': { useHistoryDownloads: () => ({ downloading: false, downloadFile: () => {}, downloadAll: () => {} }) },
        './历史选择操作': selection, './历史总览面板': { HistoryOverviewPanel: 'Overview' },
        './历史操作按钮': { HistoryActionButton }, './历史操作栏.module.css': actionStyles,
        '@/services/file-storage': { getMediaBlob: async () => new Blob(['media']) },
        '@/services/image-storage': { getImageBlob: async () => new Blob(['image']), previewUrlFor: () => undefined, subscribeImagePreviews: () => () => {}, getImagePreviewRevision: () => 0 },
        '@/stores/use-config-store': { decodeChannelModel: () => null }, '@/stores/use-canvas-side-panel-store': { useCanvasSidePanelStore: callback => callback({ historySorted: false, toggleHistorySorted: () => sorts.push('sorted') }) }, '@/types/canvas': types,
    });
    const render = () => runtime.render(() => CanvasGenerationHistoryTab({ nodes: fixtureNodes, connections: [], getCurrentNode: () => undefined, onPreviewNode: id => previews.push(id), onRetryNode: () => {}, theme }));
    let tree = render();
    const header = tree.props.children[0];
    const buttons = elements(header).filter(item => item.type === 'button');
    buttons.find(item => item.props['aria-label'] === '排序').props.onClick();
    assert.deepEqual(sorts, ['sorted']);
    assert.deepEqual(buttons.slice(-2).map(item => item.props['aria-label']), ['下载', '总览']);
    buttons.find(item => item.props.className.includes('guan-history-select')).props.onClick();
    tree = render();
    const selected = () => elements(tree).filter(item => item.type === 'Checkbox' && item.props['aria-label']).map(item => item.props.checked);
    assert.deepEqual(selected(), [true, true]);
    elements(tree).find(item => item.props['aria-label'] === '预览主图').props.onClick();
    tree = render(); assert.deepEqual(previews, ['batch']); assert.deepEqual(selected(), [true, true]);
    elements(tree).find(item => item.props['aria-label'] === '选择主图').props.onClick();
    tree = render(); assert.deepEqual(selected(), [false, true]);
});

test('新历史模块Hook调用顺序及依赖检查通过', () => {
    const linter = new Linter();
    for (const name of ['历史选择操作.ts', '历史下载操作.ts', '历史媒体预览.ts', '历史总览面板.tsx', '生成历史页签.tsx']) {
        const file = resolve(root, '扩展功能/生成历史', name);
        const messages = linter.verify(readFileSync(file, 'utf8'), [{ files: ['**/*.{ts,tsx}'], languageOptions: { parser: ts.parser, parserOptions: { ecmaVersion: 2022, sourceType: 'module', ecmaFeatures: { jsx: true } } }, plugins: { 'react-hooks': reactHooks }, rules: { 'react-hooks/rules-of-hooks': 'error', 'react-hooks/exhaustive-deps': 'error' } }], { filename: file });
        assert.deepEqual(messages, [], name);
    }
});

test('导入日期规范化兼容旧毫秒值，非法时间在写媒体和画布前拒绝', async () => {
    const { prepareCanvasExport } = await load('../画布导入/画布导入数据.ts', { nanoid: { nanoid: () => 'new-key' } });
    const project = { title: '验收画布', nodes: [], connections: [], createdAt: 1792674000000, updatedAt: '2026-10-22T13:00:00.000Z' };
    const wrap = item => ({ app: 'infinite-canvas', version: 3, projects: [{ project: item, files: [] }] });
    const result = prepareCanvasExport(wrap(project), new Map());
    assert.equal(result.projects[0].project.createdAt, new Date(project.createdAt).toISOString());
    assert.equal(project.createdAt, 1792674000000, '导入准备不就地改写原包');
    for (const invalid of [{}, [], Infinity, '坏时间']) assert.throws(() => prepareCanvasExport(wrap({ ...project, createdAt: invalid }), new Map()), /时间格式/);
    for (const viewport of [{ x: 0, y: 0, scale: 1 }, { x: 0, y: 0, k: -1 }, { x: NaN, y: 0, k: 1 }]) assert.throws(() => prepareCanvasExport(wrap({ ...project, viewport }), new Map()), /视区格式/);
});

test('已有异常日期不让顶栏崩溃，合法产品顺序与同毫秒稳定性保留', async () => {
    const { orderedProducts } = await load('../产品/产品规则.ts', {});
    const date = '2026-10-22T13:00:00.000Z';
    const items = [{ id: 'C', createdAt: new Date(date).getTime() }, { id: 'B', createdAt: date }, { id: 'A', createdAt: date }];
    assert.deepEqual(orderedProducts(items).map(item => item.id), ['A', 'B', 'C']);
    assert.doesNotThrow(() => orderedProducts([...items, { id: '异常', createdAt: {} }]));
    assert.deepEqual(items.map(item => item.id), ['C', 'B', 'A']);
});
