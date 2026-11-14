import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { transformWithEsbuild } from '../.运行/3100源/画布副本/web/node_modules/vite/dist/node/index.js';
import * as delivery from '../扩展功能/媒体交付/生成图片尺寸交付.mjs';

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
    '@/stores/use-config-store': { resolveModelRequestConfig: config => config, resolveModelChannel: () => ({ id: "test-channel", name: "测试渠道" }), resolveModelScript: () => null },
    '@/lib/image-utils': { dataUrlToFile: () => new File(['reference'], '参考图.png', { type: 'image/png' }) },
    '@/lib/image-reference-prompt': { buildImageReferencePromptText: prompt => prompt },
    '@/services/image-storage': { imageToDataUrl: async () => 'data:image/png;base64,cmVmZXJlbmNl' },
    '../提示词/变量使用规则': variables, '../图片设置/图片尺寸规则': sizes,
    './参考图数量限制': await load('扩展功能/画布生成/参考图数量限制.ts'),
    '../媒体交付/生成图片尺寸交付.mjs': delivery,
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
test('实际质量六档顺序固定，早期模型的max与极高可见但禁用', () => {
    assert.deepEqual(panel.imageQualityOptionsForModel('gpt-image-2.5-sunburst').map(item => item.value), ['auto', 'max', 'xhigh', 'high', 'medium', 'low']);
    assert.deepEqual(panel.imageQualityOptionsForModel('gpt-image-2').map(item => item.value), ['auto', 'max', 'xhigh', 'high', 'medium', 'low']);
    assert.deepEqual(panel.imageQualityOptionsForModel('gpt-image-2').filter(item => item.disabled).map(item => item.value), ['max', 'xhigh']);
    assert.equal(panel.imageQualityForModel('max', 'gpt-image-2'), 'auto');
});
for (const model of ['gpt-image-2.5', 'gpt-image-2.5-flare', 'gpt-image-2.5-sunburst', 'gpt-image-2.5-flare-1k', 'gpt-image-2.5-sunburst-4k', 'vendor/gpt-image-2.5-preview', ' GPT-IMAGE-2.5-FLARE-1K ', 'gpt-image-2.5-flare-2026-10-27',
    'gpt-image-2.6', 'gpt-image-2.6-sunburst-4k', 'channel::gpt-image-2.6-flare', 'gpt-image-2.10', 'gpt-image-3']) {
    test(`2.5及以上版本：${model} 启用、选中并提交max/极高`, async () => {
        assert.equal(panel.supportsAdvancedImageQuality(model), true);
        assert.deepEqual(panel.imageQualityOptionsForModel(model).map(item => item.value), ['auto', 'max', 'xhigh', 'high', 'medium', 'low']);
        for (const quality of ['max', 'xhigh']) {
            assert.equal(panel.imageQualityForModel(quality, model), quality);
            const changes = [];
            const rendered = descendants(panel.ImageSettingsPanel({ config: { ...config, model, quality }, theme: { node: {} }, onConfigChange: (...change) => changes.push(change) }));
            const pill = rendered.find(node => node.type?.name === 'OptionPill' && node.props.children === (quality === 'max' ? 'Max' : `settingsPanels.common.${quality}`));
            assert.ok(pill); assert.equal(pill.props.selected, true); assert.equal(pill.props.disabled, false); pill.props.onClick();
            assert.deepEqual(changes, [['quality', quality]]);
            assert.equal((await bodyFor({ model, quality, size: '1024x1024' })).quality, quality);
        }
    });
}
test('早期GPT及其他模型禁用max/极高，实际点击和请求均有保护', async () => {
    for (const model of ['gpt-image-2', 'gpt-image-2-4k', 'gpt-image-2.4', 'gpt-image-1.5', 'flux-2.5', 'gpt-image-2_5', 'not-gpt-image-2.5', 'gpt-image-2.5fake']) {
        assert.equal(panel.supportsAdvancedImageQuality(model), false);
        for (const quality of ['max', 'xhigh']) {
            assert.equal(panel.imageQualityForModel(quality, model), 'auto');
            assert.equal(Object.hasOwn(await bodyFor({ model, quality, size: '1024x1024' }), 'quality'), false);
            const changes = [];
            const rendered = descendants(panel.ImageSettingsPanel({ config: { ...config, model, quality }, theme: { node: {} }, onConfigChange: (...change) => changes.push(change) }));
            const pill = rendered.find(node => node.type?.name === 'OptionPill' && node.props.children === (quality === 'max' ? 'Max' : `settingsPanels.common.${quality}`));
            assert.ok(pill); assert.equal(pill.props.disabled, true); assert.equal(pill.props.selected, false);
            const button = pill.type(pill.props);
            assert.equal(button.props.disabled, true);
            button.props.onClick({ stopPropagation() {} });
            pill.props.onClick();
            assert.deepEqual(changes, [], '禁用按钮或迟到回调均不能更新质量');
        }
        for (const quality of ['low', 'medium', 'high']) assert.equal((await bodyFor({ model, quality, size: '1024x1024' })).quality, quality);
    }
});
test('未设置质量默认自动，原有手动值保留，Agent选项保留顺序和禁用状态', () => {
    assert.equal(panel.imageQualityLabel('max'), 'Max');
    for (const model of ['gpt-image-2', 'gpt-image-2.5', 'gpt-image-2.6']) {
        const rendered = descendants(panel.ImageSettingsPanel({ config: { model }, theme: { node: {} }, onConfigChange() {} }));
        const options = rendered.filter(node => node.type?.name === 'OptionPill').slice(0, 6);
        assert.deepEqual(options.map(node => node.props.children), ['settingsPanels.common.auto', 'Max', 'settingsPanels.common.xhigh', 'settingsPanels.common.high', 'settingsPanels.common.medium', 'settingsPanels.common.low']);
        assert.deepEqual(options.filter(node => node.props.selected).map(node => node.props.children), ['settingsPanels.common.auto']);
        const exported = panel.imageQualityOptionsForAgent(model);
        assert.deepEqual(exported.map(item => item.value), ['auto', 'max', 'xhigh', 'high', 'medium', 'low']);
        assert.equal(exported[1].label, 'Max');
        assert.equal(exported[1].disabled, model === 'gpt-image-2');
        assert.equal(panel.imageQualityForModel('high', model), 'high');
    }
    assert.match(readFileSync('.运行/3100源/画布副本/web/src/stores/use-config-store.ts', 'utf8'), /quality:\s*"auto"/);
});
test('参考图编辑请求也按2.5版本边界发送高级质量，不仅文生图生效', async () => {
    for (const model of ['gpt-image-2', 'gpt-image-2.5-flare', 'gpt-image-2.6-sunburst-4k'])
        for (const quality of ['max', 'xhigh', 'high', 'auto']) {
            const request = await protocol.prepareOriginalImageRequest({ ...config, model, quality, size: '1024x1024' }, '保留参考商品', [{ id: 'reference' }]);
            assert.equal(request.path, '/v1/images/edits');
            const form = await new Response(Buffer.from(request.body, 'base64'), { headers: { 'Content-Type': request.contentType } }).formData();
            const expected = quality === 'auto' || model === 'gpt-image-2' && ['max', 'xhigh'].includes(quality) ? null : quality;
            assert.equal(form.get('quality'), expected);
            assert.ok(form.get('image') instanceof File);
        }
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

test('900×1200交付请求以912×1216合法尺寸提交，响应仍记住用户原尺寸', async () => {
    const original = { ...config, size: '900x1200' };
    assert.equal((await bodyFor({ size: original.size })).size, '912x1216');
    const images = protocol.parseOriginalImageResponse(original, Buffer.from(JSON.stringify({ data: [{ b64_json: 'c3ludGhldGlj' }] })).toString('base64'));
    assert.equal(images[0].deliverySize, '900x1200');
    assert.equal(images[0].upstreamSize, '912x1216');
    assert.equal(original.size, '900x1200');
});
