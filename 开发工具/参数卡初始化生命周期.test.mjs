import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(new URL('../.运行/3100源/画布副本/web/package.json', import.meta.url));
const ts = require('typescript');
function load(name, dependencies = {}) {
    const source = readFileSync(new URL('../扩展功能/' + name, import.meta.url), 'utf8');
    const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    const module = { exports: {} };
    new Function('require', 'module', 'exports', javascript)(id => { assert.ok(Object.hasOwn(dependencies, id), id); return dependencies[id]; }, module, module.exports);
    return module.exports;
}
const variables = load('提示词/变量使用规则.ts');
const productRules = load('Excel画布/旧版参数规则.ts', {
    './旧版主题翻译.js': { localizePromptTheme: value => value },
    '../提示词/变量使用规则': variables,
});

test('参数卡记忆恢复和补齐一次提交；重复渲染不写入，明确留空不被旧记忆复原', () => {
    const saved = new Map(), writes = [], updates = [];
    const memory = load('Excel画布/Excel参数记忆.ts', { '../本机存储/上游浏览器存储桥': { sqlitePreferences: {
        getItem: key => saved.get(key) ?? null, setItem(key, value) { saved.set(key, value); writes.push(value); },
    } } });
    memory.saveProductParameterValues('product', { '[LENGTH]': '100' }); writes.length = 0;
    const cells = [], effects = []; let cursor = 0;
    const hooks = {
        useMemo: callback => callback(),
        useState: value => [value, () => {}],
        useRef(value) { const index = cursor++; return cells[index] ||= { current: value }; },
        useEffect: callback => effects.push(callback),
    };
    const { PromptVariablesContent } = load('Excel画布/旧版参数卡片.tsx', {
        react: hooks, 'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
        'lucide-react': { Braces: 'Braces' }, '@/lib/canvas-theme': { canvasThemes: { light: { node: {}, toolbar: {} } } },
        '@/stores/use-theme-store': { useThemeStore: callback => callback({ theme: 'light' }) },
        './旧版参数规则': { ...productRules, productVariableTokens: () => ['[LENGTH]', '[COUNT]'], variableLabel: token => token, productPlatformRules: () => '' },
        './Excel画布上下文': { useExcelProductId: () => 'product', useExcelPromptContext: () => ({ templates: [], fileName: '参数.xlsx' }) },
        './Excel参数记忆': memory, './产品参数编辑操作': { useProductParameterEditing: () => ({ updateValue() {}, updateSupplement() {}, updateMetadata() {} }) },
        './产品资料表单': { ProductBriefForm: 'ProductBriefForm' },
        './产品主图上传': { ProductMainImageUploader: 'ProductMainImageUploader' },
        './产品变体编辑': { ProductVariantEditor: 'ProductVariantEditor' },
        './产品变体规则': { productVariants: metadata => metadata.productVariants || [] },
        './产品选项下拉': { ProductOptionSelect: 'ProductOptionSelect' },
        './商品策划按钮': { ProductPlanningButton: 'ProductPlanningButton', ProductPlanOverview: 'ProductPlanOverview' },
    });
    let node = { id: 'parameter', metadata: {} };
    const render = () => {
        cursor = 0;
        const ctx = { node, getNode: id => id === node.id ? node : undefined, getNodes: () => [node], updateMetadata(patch) { updates.push(patch); node = { ...node, metadata: { ...node.metadata, ...patch } }; } };
        PromptVariablesContent({ ctx });
        while (effects.length) effects.shift()();
    };
    render();
    assert.deepEqual(node.metadata.promptVariableValues, { '[LENGTH]': '100', '[COUNT]': '' });
    assert.equal(updates.length, 1, '空变量补齐不能用旧快照覆盖刚恢复的记忆');
    for (let index = 0; index < 100; index++) render();
    assert.equal(updates.length, 1); assert.equal(writes.length, 0);
    node = { ...node, metadata: { ...node.metadata, promptVariableValues: { '[LENGTH]': '', '[COUNT]': '0' } } };
    render();
    assert.deepEqual(node.metadata.promptVariableValues, { '[LENGTH]': '', '[COUNT]': '0' });
    assert.equal(updates.length, 1); assert.equal(writes.length, 0);
});

test('Wildberries 默认俄文但允许修改；重复渲染与重新打开保留用户语言', () => {
    let node = { id: 'parameter', metadata: {} };
    let cursor = 0;
    const cells = [], effects = [], updates = [];
    const updateMetadata = patch => {
        updates.push(patch);
        node = { ...node, metadata: { ...node.metadata, ...patch } };
    };
    const { PromptVariablesContent } = load('Excel画布/旧版参数卡片.tsx', {
        react: {
            useMemo: callback => callback(),
            useState: value => [value, () => {}],
            useRef(value) { const index = cursor++; return cells[index] ||= { current: value }; },
            useEffect: callback => effects.push(callback),
        },
        'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
        'lucide-react': { Braces: 'Braces', Sparkles: 'Sparkles' },
        '@/lib/canvas-theme': { canvasThemes: { light: { node: {}, toolbar: {} } } },
        '@/stores/use-theme-store': { useThemeStore: callback => callback({ theme: 'light' }) },
        './旧版参数规则': {
            ...productRules, productVariableTokens: () => [], variableLabel: token => token,
        },
        './Excel画布上下文': { useExcelProductId: () => 'product', useExcelPromptContext: () => ({ templates: [] }) },
        './Excel参数记忆': { restoreProductParameterValues: (_productId, current) => current },
        './产品参数编辑操作': { useProductParameterEditing: () => ({ updateMetadata }) },
        './产品资料表单': { ProductBriefForm: 'ProductBriefForm' },
        './产品主图上传': { ProductMainImageUploader: 'ProductMainImageUploader' },
        './产品变体编辑': { ProductVariantEditor: 'ProductVariantEditor' },
        './产品变体规则': { productVariants: metadata => metadata.productVariants || [] },
        './产品选项下拉': { ProductOptionSelect: 'ProductOptionSelect' },
        './商品策划按钮': { ProductPlanningButton: 'ProductPlanningButton', ProductPlanOverview: 'ProductPlanOverview' },
    });
    const render = () => {
        cursor = 0;
        const tree = PromptVariablesContent({ ctx: { node, getNode: () => node, getNodes: () => [node], updateMetadata } });
        while (effects.length) effects.shift()();
        const selectors = [];
        const visit = element => {
            if (!element || typeof element !== 'object') return;
            if (element.type === 'ProductOptionSelect') selectors.push(element.props);
            for (const child of [element.props?.children].flat(Infinity)) visit(child);
        };
        visit(tree);
        return { platform: selectors[0], language: selectors[1] };
    };
    render();
    assert.equal(node.metadata.productLanguage, '俄文');
    assert.equal(render().language.disabled, undefined);
    for (const language of productRules.PRODUCT_LANGUAGE_OPTIONS.map(option => option.value)) {
        render().language.onChange(language);
        const writeCount = updates.length;
        for (let index = 0; index < 10; index++) assert.equal(render().language.value, language);
        cells.length = 0;
        assert.equal(render().language.value, language, '重新打开不能覆盖手动选择');
        assert.equal(node.metadata.productLanguage, language);
        assert.equal(updates.length, writeCount, '已选语言不应触发反复初始化');
    }
    for (const platform of productRules.PRODUCT_PLATFORM_OPTIONS.map(option => option.value)) {
        render().platform.onChange(platform);
        assert.equal(render().platform.value, platform);
        assert.equal(node.metadata.productPlatform, platform);
        assert.equal(node.metadata.productPlatformRules, platform === 'Wildberries' ? productRules.WILDBERRIES_RULES_TEXT : '');
    }
    render().platform.onChange('Wildberries');
    assert.equal(render().language.value, '俄文', '重新选择 Wildberries 时自动选择俄文');
    node = { ...node, metadata: { ...node.metadata, productPlatform: '自定义', productLanguage: '' } };
    render();
    assert.equal(node.metadata.productPlatform, '自定义', '移除旧选项不能擅自把已保存产品改为其他平台');
    assert.equal(node.metadata.productLanguage, '', '旧留空语言由用户重新选择，不自动改变生成内容');
});
