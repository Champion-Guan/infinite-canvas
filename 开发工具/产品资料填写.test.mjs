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
const rules = load('Excel画布/旧版参数规则.ts', {
    './旧版主题翻译.js': { localizePromptTheme: value => value }, '../提示词/变量使用规则': variables,
    './商品待确认规则': load('Excel画布/商品待确认规则.ts'),
});
const links = load('Excel画布/产品参数联动.ts', {
    '../提示词/变量使用规则': variables, './旧版参数规则': rules,
    './旧版最终提示词标题': { finalPromptPreviewTitle: node => node.title },
});
const jsx = (type, props) => ({ type, props });
const elements = tree => {
    if (!tree || typeof tree !== 'object') return [];
    if (Array.isArray(tree)) return tree.flatMap(elements);
    return [tree, ...elements(tree.props?.children)];
};

test('未识别提示词、无变量的提示词都显示资料表；已识别变量仍使用变量表并保留资料', () => {
    let node = { id: 'parameter', metadata: { productBrief: { nameCategory: '收纳包' } } };
    const context = { templates: [] };
    const card = load('Excel画布/旧版参数卡片.tsx', {
        react: { useMemo: callback => callback(), useRef: value => ({ current: value }), useState: value => [value, () => {}], useEffect() {} },
        'react/jsx-runtime': { jsx, jsxs: jsx }, 'lucide-react': {},
        '@/lib/canvas-theme': { canvasThemes: { light: { node: {}, toolbar: {} } } },
        '@/stores/use-theme-store': { useThemeStore: callback => callback({ theme: 'light' }) },
        './旧版参数规则': rules, './Excel画布上下文': { useExcelProductId: () => 'product', useExcelPromptContext: () => context },
        './Excel参数记忆': {}, './产品参数编辑操作': { useProductParameterEditing: () => ({}) },
        './产品资料表单': { ProductBriefForm: 'ProductBriefForm' },
        './产品主图上传': { ProductMainImageUploader: 'ProductMainImageUploader' },
        './产品选项下拉': { ProductOptionSelect: 'ProductOptionSelect' },
        './产品变体编辑': { ProductVariantEditor: 'ProductVariantEditor' },
        './产品变体规则': { productVariants: metadata => metadata?.productVariants || [] },
        './商品策划按钮': { ProductPlanningButton: 'ProductPlanningButton', ProductPlanOverview: 'ProductPlanOverview' },
    });
    const render = () => elements(card.PromptVariablesContent({ ctx: { node, getNode: () => node, getNodes: () => [node] } }));
    assert.ok(!render().some(element => element.props?.['aria-label'] === '本次制作要求'));
    assert.equal(render().find(element => element.type === 'ProductBriefForm').props.values.nameCategory, '收纳包');
    context.templates = [{ id: 'template', route: '产品', prompts: { main: '无占位符提示词' } }];
    assert.ok(render().some(element => element.type === 'ProductBriefForm'));
    node = { ...node, metadata: { ...node.metadata, promptVariableTokens: ['[NAME]'] } };
    assert.ok(!render().some(element => element.type === 'ProductBriefForm'));
    assert.ok(render().some(element => element.type === 'input' && element.props.placeholder === '[NAME]'));
    node = { ...node, metadata: { ...node.metadata, promptVariableTokens: [] } };
    assert.equal(render().find(element => element.type === 'ProductBriefForm').props.values.nameCategory, '收纳包');
});

test('资料表所有字段可编辑，制作范围有专用控件，不重复展示实物图和语言', () => {
    const { ProductBriefForm } = load('Excel画布/产品资料表单.tsx', {
        antd: { Tooltip: 'Tooltip' },
        'react/jsx-runtime': { jsx, jsxs: jsx }, './旧版参数规则': rules,
        './产品选项下拉': { ProductOptionSelect: 'ProductOptionSelect' },
    });
    const edits = [];
    const props = { values: {}, platform: 'Ozon', onChange: (...args) => edits.push(args) };
    const tree = ProductBriefForm(props), controls = elements(tree);
    for (const field of rules.PRODUCT_BRIEF_FIELDS) {
        const input = controls.find(element => element.props?.['aria-label'] === field.label || element.props?.label === field.label);
        assert.ok(input, field.label);
        input.props.onChange(field.kind === 'choice' ? '需要' : { target: { value: '用户填写' } });
    }
    assert.equal(edits.length, 13);
    const keywordIndex = controls.findIndex(element => element.props?.['aria-label'] === '需要在图片中展现的关键词');
    const styleIndex = controls.findIndex(element => element.props?.['aria-label'] === '风格或竞品参考');
    assert.ok(keywordIndex > 0 && keywordIndex < styleIndex);
    assert.equal(controls[keywordIndex].type, 'textarea');
    assert.equal(controls[keywordIndex].props.placeholder, '可选');
    assert.ok(!controls.some(element => element.props?.['aria-label'] === '轮播图张数'));
    assert.equal(controls.find(element => element.props?.label === '富内容').type, 'ProductOptionSelect');
    assert.doesNotMatch(JSON.stringify(tree), /实物图|图片文字语言|未上传|已附|使用的生图工具/);
    const wildberries = elements(ProductBriefForm({ ...props, platform: rules.WILDBERRIES_PLATFORM, values: { richContent: '不需要' } }));
    assert.ok(!wildberries.some(element => element.props?.label === '富内容' || element.type === 'select'));
    assert.ok(!wildberries.some(element => element.props?.['aria-label'] === '轮播图张数'));
});

test('未填资料不制造默认事实；已填资料、图片与语言可作为参数资源读取', () => {
    assert.equal(rules.productBriefSupplement({ productBrief: {}, productLanguage: '俄文' }), '');
    const metadata = { productBrief: { nameCategory: '收纳包', dimensions: '待确认', carouselCount: '0', richContent: '不需要', generationTool: '旧工具' }, productLanguage: '英文', promptVariableSupplement: '额外补充' };
    const result = rules.promptVariablesResource({ metadata }).text;
    assert.match(result, /商品名称／品类：收纳包/); assert.match(result, /真实尺寸与参数：待确认/);
    assert.doesNotMatch(result, /轮播图张数|使用的生图工具|旧工具/); assert.match(result, /富内容：不需要/); assert.match(result, /图片文字语言：英文/);
    assert.match(result, /额外补充/); assert.doesNotMatch(result, /实物图：已附|材质／成分：/);
    assert.match(rules.productBriefSupplement({ ...metadata, productMainImageStorageKey: 'image' }), /实物图：已附/);
});

test('连续填写按最新节点合并，保存后可恢复，连线预览同步且清空可移除；不污染Excel变量', () => {
    const parameter = { id: 'parameter', type: 'guan:prompt-variables', metadata: {} };
    const source = { id: 'source', type: 'text', metadata: { content: '展示商品', excelPromptBindingNodeId: parameter.id } };
    const preview = { id: 'preview', type: 'text', metadata: { promptVariablePreviewOf: parameter.id, promptVariableSourceNodeId: source.id } };
    const unrelated = { id: 'other', type: 'guan:prompt-variables', metadata: {} };
    let nodes = [parameter, source, preview, unrelated], writes = 0;
    const applyOps = ops => { writes++; nodes = nodes.map(node => ({ ...node, metadata: { ...node.metadata, ...ops.find(op => op.id === node.id)?.metadata } })); };
    const { useProductParameterEditing } = load('Excel画布/产品参数编辑操作.ts', {
        react: { useCallback: callback => callback }, './产品参数联动': links,
        './Excel参数记忆': { saveProductParameterValues: () => assert.fail('手填资料不能写入Excel变量记忆') },
    });
    const api = useProductParameterEditing({ node: parameter, getNode: id => nodes.find(node => node.id === id), getNodes: () => nodes, getConnections: () => [], applyOps }, 'product', []);
    api.updateBrief('nameCategory', '收纳包'); api.updateBrief('material', '棉');
    assert.deepEqual(nodes[0].metadata.productBrief, { nameCategory: '收纳包', material: '棉' });
    assert.equal(nodes[0].metadata.promptVariableTokens, undefined);
    assert.deepEqual(nodes[3].metadata, {});
    assert.equal(nodes[1].metadata.content, '展示商品');
    assert.match(nodes[2].metadata.content, /收纳包[\s\S]*棉/);
    const saved = JSON.parse(JSON.stringify(nodes));
    assert.deepEqual(saved[0].metadata.productBrief, nodes[0].metadata.productBrief);
    api.updateBrief('nameCategory', ''); api.updateBrief('material', '');
    assert.equal(nodes[2].metadata.content, '展示商品');
    nodes = links.reconcileExcelPreviews(nodes, saved);
    assert.match(nodes[2].metadata.content, /收纳包/);
    const languageChanged = nodes.map(node => node.id === parameter.id ? { ...node, metadata: { ...node.metadata, productLanguage: '中文' } } : node);
    nodes = links.reconcileExcelPreviews(nodes, languageChanged);
    assert.match(nodes[2].metadata.content, /图片文字语言：中文/);
    nodes = []; api.updateBrief('nameCategory', '迟到输入'); assert.equal(writes, 4);
});
