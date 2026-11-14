import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = resolve(root, '.运行/3100源/画布副本/web/src');
const require = createRequire(resolve(sourceRoot, '../package.json'));
const ts = require('typescript');
export function variantModules(overrides = {}) {
    const cache = new Map();
    const dependencies = {
        react: { useCallback: value => value, useEffect() {}, useRef: value => ({ current: value }), useMemo: fn => fn() },
        antd: { Tooltip: 'Tooltip' },
        '../产品/产品操作': { saveProductCanvas: async () => {} },
        '../主题/状态详情': { StatusDetail: 'StatusDetail' },
        './商品变体生成按钮': { ProductVariantGenerateButton: 'ProductVariantGenerateButton' },
        './平台规则订阅': { useGlobalPlatformRules() {} },
        './提示词变体选择.module.css': { default: {} },
        '@/types/canvas': { CanvasNodeType: { Text: 'text', Config: 'config', Image: 'image', Video: 'video', Audio: 'audio', Group: 'group' } },
        '@/constant/canvas': { getNodeSpec: () => ({ width: 340, height: 240 }) },
        '@/lib/canvas/canvas-generation-helpers': { getGenerationCount: value => Math.max(1, Math.min(15, Math.floor(Math.abs(Number(value)) || 1))) },
        '@/lib/canvas/canvas-node-factory': { createCanvasNode: (type, position, metadata) => ({ id: 'created', type, position, width: 340, height: 240, metadata }) },
        '@/lib/canvas/node-registry': { getNodeDefinition: type => type === 'guan:prompt-variables' ? { resource: node => load('Excel画布/旧版参数规则.ts').promptVariablesResource(node) } : undefined },
        '@/lib/image-reference-prompt': { imageReferenceLabel: index => `图片${index + 1}` },
        '@/i18n': { default: { t: (key, values) => `${key} ${values?.index || ''}` } },
        '@/lib/image-utils': {},
        '@/services/image-storage': { imageToDataUrl: async image => `data:image/png;base64,${image.storageKey}` },
        '@/services/file-storage': { resolveMediaUrl: async key => `http://localhost/media/${key}` },
        nanoid: { nanoid: () => 'batch-id' },
        ...overrides,
    };
    const ensureModelConfigured = config => {
        const state = dependencies['@/stores/use-config-store']?.useConfigStore?.getState?.();
        if (!state?.isAiConfigReady || state.isAiConfigReady(config, config.model)) return true;
        state.openConfigDialog?.(false, 'channels');
        return false;
    };
    if (!Object.hasOwn(dependencies, '../产品配置/模型配置门禁'))
        dependencies['../产品配置/模型配置门禁'] = { ensureModelConfigured, requireModelConfigured(config) {
            if (!ensureModelConfigured(config)) throw Error('请先配置可用模型');
        } };
    function load(name, upstream = false) {
        const path = upstream ? resolve(sourceRoot, name) : resolve(root, '扩展功能', name);
        return loadPath(path);
    }
    function loadPath(path) {
        if (cache.has(path)) return cache.get(path).exports;
        const output = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: {
            module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
        } }).outputText;
        const module = { exports: {} }; cache.set(path, module);
        new Function('require', 'module', 'exports', output)(id => {
            if (Object.hasOwn(dependencies, id)) return dependencies[id];
            let target;
            if (id.startsWith('@/扩展功能/')) target = resolve(root, '扩展功能', id.slice('@/扩展功能/'.length));
            else if (id.startsWith('@/')) target = resolve(sourceRoot, id.slice(2));
            else if (id.startsWith('.')) target = resolve(dirname(path), id);
            assert.ok(target, `未声明依赖：${id}`);
            target = [target, target + '.ts', target + '.tsx', target + '.js'].find(existsSync);
            assert.ok(target, id);
            return loadPath(target);
        }, module, module.exports);
        return module.exports;
    }
    return { load, dependencies };
}

export function variantFixture() {
    const image = (id, name = id) => ({ id, name, storageKey: `stored-${id}`, mimeType: 'image/png' });
    const variant = (id, color) => ({ id, name: color, enabled: true, attributes: { 颜色: color, 尺寸: 'M', 数量: '2件' }, imageIds: [id], primaryImageId: id });
    const parameter = { id: 'parameter', type: 'guan:prompt-variables', position: { x: 0, y: 0 }, width: 340, height: 800, metadata: {
        productPlatform: 'Wildberries', productLanguage: '俄语',
        productBrief: { nameCategory: '旅行包', material: '棉', packageContents: '包与背带', dimensions: '共用尺寸', colorModel: '旧颜色' },
        promptVariableValues: { '[COLOR]': '旧颜色', '[MATERIAL]': '棉', '[COUNT]': '1' },
        productMainImages: [image('red', '红色__正面.png'), image('blue', '蓝色__正面.png'), image('shared', '通用尺寸.png'), image('unused')],
        productSharedImageIds: ['shared'], productVariants: [variant('red', '红色'), variant('blue', '蓝色')],
    } };
    const text = { id: 'prompt', type: 'text', title: '主图', position: { x: 400, y: 0 }, width: 340, height: 240,
        metadata: { content: 'THEME: 材质展示。商品 [COLOR] [COUNT] [MATERIAL]', excelPromptBindingNodeId: parameter.id } };
    const config = { id: 'config', type: 'config', title: '生图', position: { x: 800, y: 0 }, width: 340, height: 240,
        metadata: { generationMode: 'image', prompt: '', count: 2 } };
    const nodes = [parameter, text, config];
    const connections = [{ id: 'a', fromNodeId: parameter.id, toNodeId: text.id }, { id: 'b', fromNodeId: text.id, toNodeId: config.id }];
    return { parameter, text, config, nodes, connections, image, variant };
}
