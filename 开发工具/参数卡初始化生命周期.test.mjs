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

test('参数卡记忆恢复和补齐一次提交；重复渲染不写入，明确留空不被旧记忆复原', () => {
    const saved = new Map(), writes = [], updates = [];
    const memory = load('Excel画布/Excel参数记忆.ts', { '../本机存储/上游浏览器存储桥': { sqlitePreferences: {
        getItem: key => saved.get(key) ?? null, setItem(key, value) { saved.set(key, value); writes.push(value); },
    } } });
    memory.saveProductParameterValues('product', { '[LENGTH]': '100' }); writes.length = 0;
    const cells = [], effects = []; let cursor = 0;
    const hooks = {
        useMemo: callback => callback(),
        useRef(value) { const index = cursor++; return cells[index] ||= { current: value }; },
        useEffect: callback => effects.push(callback),
    };
    const rules = load('提示词/变量使用规则.ts');
    const { PromptVariablesContent } = load('Excel画布/旧版参数卡片.tsx', {
        react: hooks, 'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
        'lucide-react': { Braces: 'Braces' }, '@/lib/canvas-theme': { canvasThemes: { light: { node: {}, toolbar: {} } } },
        '@/stores/use-theme-store': { useThemeStore: callback => callback({ theme: 'light' }) },
        './旧版参数规则': { ...rules, productVariableTokens: () => ['[LENGTH]', '[COUNT]'], variableLabel: token => token },
        './Excel画布上下文': { useExcelProductId: () => 'product', useExcelPromptContext: () => ({ templates: [], fileName: '参数.xlsx' }) },
        './Excel参数记忆': memory, './产品参数编辑操作': { useProductParameterEditing: () => ({ updateValue() {}, updateSupplement() {} }) },
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
