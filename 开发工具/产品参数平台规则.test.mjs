import assert from 'node:assert/strict';
import { platformState } from './全局平台规则夹具.mjs';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { transformWithEsbuild } from '../.运行/3100源/画布副本/web/node_modules/vite/dist/node/index.js';

async function load(file, dependencies = {}) {
    dependencies = { './平台规则全局状态': platformState, ...dependencies };
    const source = resolve(file);
    const { code } = await transformWithEsbuild(readFileSync(source, 'utf8'), source, { loader: source.endsWith('.js') ? 'js' : 'ts', format: 'cjs', target: 'es2022', tsconfigRaw: '{}' });
    const module = { exports: {} };
    new Function('require', 'module', 'exports', code)(id => {
        assert.ok(Object.hasOwn(dependencies, id), `未声明依赖：${id}`);
        return dependencies[id];
    }, module, module.exports);
    return module.exports;
}
const themes = await load('扩展功能/Excel画布/旧版主题翻译.js');
const variables = await load('扩展功能/提示词/变量使用规则.ts');
const confirmationRules = await load('扩展功能/Excel画布/商品待确认规则.ts');
const rules = await load('扩展功能/Excel画布/旧版参数规则.ts', { './旧版主题翻译.js': themes, '../提示词/变量使用规则': variables, './商品待确认规则': confirmationRules });

test('新产品参数卡默认 Wildberries 与俄文，并带入对应规则', () => {
    const metadata = rules.buildPromptVariablesMetadata();
    assert.equal(metadata.productPlatform, rules.WILDBERRIES_PLATFORM);
    assert.equal(metadata.productLanguage, rules.WILDBERRIES_LANGUAGE);
    assert.equal(metadata.productPlatformRules, undefined, '新卡只保存平台选择，不保存独立规则');
    assert.equal(rules.productPlatformRules(metadata), [
        '主图/轮播图：共11张（主图1张、轮播图10张），1800 x 2400 px ，3 : 4 ，PNG ，单张小于10MB 。',
        '富内容：6张，800 x 500 px ，PNG ，单张最大5MB 。',
        '商品卡视频：3 : 4 ，MP4 ，小于50MB 。',
    ].join('\n'));
    const prompt = rules.productParameterSupplement(metadata);
    assert.equal(prompt, `${rules.productPlatformRules(metadata)}\n\n富内容必须制作6张：800 x 500 px，PNG，单张最大5MB。`);
});

test('旧卡的规则字段不覆盖全局默认，历史自定义由首次启动统一迁移', () => {
    const metadata = { productPlatform: 'Wildberries', productPlatformRules: [
        '主图/轮播图：1800×2400，3:4，JPG/PNG/WEBP，单张小于10MB，最多30张，最低700×933。',
        '商品卡视频：3:4，MOV/MP4，单个小于50MB。',
        '富内容：仅图片，800×500，JPG/PNG，单张最大5MB。',
    ].join('\n') };
    assert.equal(rules.productPlatformRules(metadata), rules.WILDBERRIES_RULES_TEXT);
    const previousDefaults = [
        '主图/轮播图：1800 x 2400 px ，3 : 4 ，PNG ，单张小于10MB 。',
        '富内容：800 x 500 px ，PNG ，单张最大5MB 。',
        '商品卡视频：3 : 4 ，MP4 ，小于50MB 。',
    ].join('\n');
    assert.equal(rules.productPlatformRules({ ...metadata, productPlatformRules: previousDefaults }), rules.WILDBERRIES_RULES_TEXT);
    const previousCounts = [
        '主图/轮播图：共10张（主图1张、轮播图9张），1800 x 2400 px ，3 : 4 ，PNG ，单张小于10MB 。',
        '富内容：6张，800 x 500 px ，PNG ，单张最大5MB 。',
        '商品卡视频：3 : 4 ，MP4 ，小于50MB 。',
    ].join('\n');
    assert.equal(rules.productPlatformRules({ ...metadata, productPlatformRules: previousCounts }), rules.WILDBERRIES_RULES_TEXT);
    assert.equal(rules.productPlatformRules({ ...metadata, productPlatformRules: '自定义规则' }), rules.WILDBERRIES_RULES_TEXT);
});

test('切换其他平台不会继续注入 Wildberries 规则', () => {
    assert.equal(rules.productParameterSupplement({ productPlatform: 'Ozon', promptVariableSupplement: '用户补充' }), '用户补充');
});

test('平台切换提供俄文或英文默认值，未指定不设置图片文字语言', () => {
    for (const platform of ['Wildberries', 'Ozon']) assert.equal(rules.defaultProductLanguage(platform), '俄文');
    for (const platform of ['亚马逊', 'Takealot']) assert.equal(rules.defaultProductLanguage(platform), '英文');
    assert.equal(rules.defaultProductLanguage('未指定'), '');
});

test('Wildberries 富内容始终必需，旧资料中的不需要不再注入；其他平台保留原选择', () => {
    const metadata = { productPlatform: 'Wildberries', productBrief: { nameCategory: '收纳包', richContent: '不需要' } };
    const prompt = rules.productParameterSupplement(metadata);
    assert.match(prompt, /富内容必须制作6张：800 x 500 px，PNG，单张最大5MB/);
    assert.doesNotMatch(prompt, /富内容：不需要/);
    assert.match(rules.productParameterSupplement({ ...metadata, productPlatform: 'Ozon' }), /富内容：不需要/);
    assert.equal(metadata.productBrief.richContent, '不需要', '读取时应用平台要求，不覆盖其他平台的原选择');
});

test('平台五项和语言四项按指定顺序展示，俄文沿用既有产品存储值', () => {
    const platforms = rules.PRODUCT_PLATFORM_OPTIONS.map(option => option.label);
    assert.deepEqual(platforms, ['Wildberries', 'OZON', '亚马逊', 'Takealot', '未指定']);
    assert.equal(rules.PRODUCT_PLATFORM_OPTIONS.find(option => option.label === '未指定').value, '未指定');
    assert.ok(!platforms.includes('自定义'));
    assert.deepEqual(rules.PRODUCT_LANGUAGE_OPTIONS.map(option => option.label), ['俄文', '英文', '中文', '未指定']);
    const metadata = { productPlatform: '未指定', productLanguage: '', productBrief: { nameCategory: '数字蜡烛', dimensions: '3.2 cm / 1.3 in' } };
    assert.doesNotMatch(rules.productParameterSupplement(metadata), /图片文字语言|俄文|俄语/);
    assert.match(rules.productParameterSupplement(metadata), /3.2 cm \/ 1.3 in/);
    assert.equal(rules.PRODUCT_LANGUAGE_OPTIONS.find(option => option.label === '俄文').value, rules.WILDBERRIES_LANGUAGE);
});

test('产品主图上传保存在参数卡元数据，并接受常见图片与HEIC', () => {
    const source = readFileSync(resolve('扩展功能/Excel画布/产品主图上传.tsx'), 'utf8');
    assert.match(source, /accept="image\/\*,\.heic,\.heif"/);
    assert.match(source, /type="file" multiple/);
    assert.match(source, /assetProjectId: productId/);
});
