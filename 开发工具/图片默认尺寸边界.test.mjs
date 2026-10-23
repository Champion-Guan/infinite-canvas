import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { transformWithEsbuild } from '../.运行/3100源/画布副本/web/node_modules/vite/dist/node/index.js';

async function load(file, dependencies = {}) {
    const { code } = await transformWithEsbuild(readFileSync(file, 'utf8'), file, { loader: file.endsWith('.tsx') ? 'tsx' : 'ts', jsx: 'automatic', format: 'cjs', target: 'es2022', tsconfigRaw: '{}' });
    const module = { exports: {} };
    new Function('require', 'module', 'exports', code)(id => {
        assert.ok(Object.hasOwn(dependencies, id), '未声明依赖：' + id);
        return dependencies[id];
    }, module, module.exports);
    return module.exports;
}
const sizes = await load('扩展功能/图片设置/图片尺寸规则.ts');
const anchor = await load('扩展功能/图片设置/尺寸比例锚点.ts');
const dimensionAnchor = { current: null };
const jsx = (type, props) => ({ type, props });
const panel = await load('.运行/3100源/画布副本/web/src/components/image-settings-panel.tsx', {
    react: { useState: () => [false, () => {}], useRef: () => dimensionAnchor },
    'react/jsx-runtime': { jsx, jsxs: jsx }, antd: {}, 'react-i18next': { useTranslation: () => ({ t: key => key }) },
    '@/i18n': { default: { t: key => key }, __esModule: true }, '@/lib/app-theme': {},
    '@/stores/use-config-store': { modelOptionName: model => model },
    '@/扩展功能/图片设置/图片尺寸规则': sizes, '@/扩展功能/图片设置/尺寸比例锚点': anchor,
});
function descendants(node) {
    if (Array.isArray(node)) return node.flatMap(descendants);
    if (!node || typeof node !== 'object') return [];
    return [node, ...descendants(node.props?.children)];
}
const variables = await load('扩展功能/提示词/变量使用规则.ts');
const video = await load('.运行/3100源/画布副本/web/src/lib/media-size.ts');
const protocol = await load('扩展功能/画布生成/原版图片协议.ts', {
    '@/i18n/index': { t: key => key }, nanoid: { nanoid: () => 'id' },
    '@/stores/use-config-store': { resolveModelRequestConfig: config => config, resolveModelScript: () => null },
    '@/lib/image-utils': {}, '@/lib/image-reference-prompt': {}, '@/services/image-storage': {},
    '../提示词/变量使用规则': variables, '../图片设置/图片尺寸规则': sizes,
});
const config = { model: 'gpt-image-1', baseUrl: 'https://example.invalid', count: 1, quality: 'auto', systemPrompt: '', apiFormat: 'openai' };
const bodyFor = async overrides => JSON.parse(Buffer.from((await protocol.prepareOriginalImageRequest({ ...config, ...overrides }, '产品照片')).body, 'base64').toString('utf8'));

test('图片自动和1k比例使用新默认，像素再识别不跳分辨率', () => {
    for (const [ratio, width, height] of [['3:4', 1152, 1536], ['8:5', 1584, 992]]) {
        const pixels = `${width}x${height}`;
        assert.equal(sizes.computeMediaSize('auto', ratio), ratio);
        assert.equal(sizes.computeMediaSize('1k', ratio), pixels);
        assert.deepEqual(sizes.readMediaDimensions(ratio, 'auto', ratio), { width, height });
        assert.equal(sizes.inferMediaRatio(pixels), ratio);
        assert.equal(sizes.inferMediaScale(pixels), '1k');
    }
});
test('已保存旧尺寸及手填值原样显示，锚点选比例仍保留手填宽高', () => {
    for (const [width, height] of [[768, 1024], [900, 1200], [1000, 625]]) {
        assert.deepEqual(sizes.readMediaDimensions(`${width}x${height}`, '1k', '3:4'), { width, height });
    }
    assert.deepEqual(anchor.dimensionsFromAnchor('height', 1200, '3:4'), { width: 900, height: 1200 });
    assert.deepEqual(anchor.dimensionsFromAnchor('width', 1000, '8:5'), { width: 1000, height: 625 });
    assert.equal(anchor.dimensionsFromAnchor('width', 1000, 'auto'), null);
});
test('实际宽高输入失焦不抢手填锚点，改宽或改高后选择比例均保持对应边', () => {
    let size = '1584x992'; const changes = [];
    dimensionAnchor.current = null;
    const render = () => descendants(panel.ImageSettingsPanel({ config: { model: 'gpt-image-2', size },
        theme: { node: {} }, onConfigChange(key, value) { assert.equal(key, 'size'); size = value; changes.push(value); } }));
    const blur = (prefix, value) => {
        const item = render().find(node => node.type?.name === 'DimensionInput' && node.props.prefix === prefix);
        const input = descendants(item.type(item.props)).find(node => node.type === 'input');
        input.props.onBlur({ currentTarget: { value } });
    };
    const ratio = () => render().find(node => node.type === 'button' && descendants(node).some(child => child.type === 'span' && child.props.children === '8:5'));
    blur('W', '1000'); assert.equal(size, '1000x992');
    blur('H', '992'); assert.equal(changes.length, 1);
    ratio().props.onClick(); assert.equal(size, '1000x625');
    blur('H', '1200'); blur('W', '1000');
    assert.equal(changes.length, 3);
    ratio().props.onClick(); assert.equal(size, '1920x1200');
});
test('实际质量选项按自动到低排列，模型不支持的最高与极高仍不发送', () => {
    assert.deepEqual(panel.imageQualityOptionsForModel('gpt-image-2.5-sunburst').map(item => item.value), ['auto', 'max', 'xhigh', 'high', 'medium', 'low']);
    assert.deepEqual(panel.imageQualityOptionsForModel('gpt-image-2').map(item => item.value), ['auto', 'high', 'medium', 'low']);
    assert.equal(panel.imageQualityForModel('max', 'gpt-image-2'), 'auto');
});
test('2k、4k及公共视频规则保持原规格', () => {
    for (const scale of ['2k', '4k']) for (const ratio of ['1:1', '2:3', '3:2', '4:3', '3:4', '16:9', '9:16', '21:9', '9:21']) {
        assert.equal(sizes.computeMediaSize(scale, ratio), video.computeMediaSize(scale, ratio));
    }
    assert.equal(video.computeMediaSize('1k', '3:4'), '768x1024');
    assert.equal(video.computeVideoSize('720', '3:4'), '720x960');
    assert.equal(video.computeVideoSize('1080', '16:9'), '1920x1080');
});
test('自动比例和明确像素进入真实OpenAI编码使用相同尺寸，自动尺寸仍由服务决定', async () => {
    for (const [ratio, size] of [['3:4', '1152x1536'], ['8:5', '1584x992']]) {
        assert.equal((await bodyFor({ size: ratio })).size, size);
        assert.equal((await bodyFor({ size })).size, size);
    }
    assert.equal(Object.hasOwn(await bodyFor({ size: 'auto' }), 'size'), false);
});
test('Gemini保持能力适配，默认3:4和8:5映射合法比例与1K', async () => {
    for (const [size, aspectRatio] of [['3:4', '3:4'], ['8:5', '3:2']]) {
        const body = await bodyFor({ apiFormat: 'gemini', model: 'gemini-3-pro-image-preview', size });
        assert.deepEqual(body.generationConfig.imageConfig, { aspectRatio, imageSize: '1K' });
    }
});
