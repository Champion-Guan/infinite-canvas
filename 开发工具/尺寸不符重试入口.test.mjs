import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from '../.运行/3100源/画布副本/web/node_modules/typescript/lib/typescript.js';
import { imageSizeRetryBlocked } from '../扩展功能/媒体交付/生成图片尺寸交付.mjs';

const root = '.运行/3100源/画布副本/web/src/';
const jsx = (type, props) => ({ type, props });
const theme = { node: {}, toolbar: {} };
const scope = {
    imageSizeRetryBlocked, useTranslation: () => ({ t: key => key }),
    canvasThemes: { light: theme }, useThemeStore: read => read({ theme: 'light' }),
    RefreshCw: 'RetryIcon', Trash2: 'DeleteIcon', Button: 'Button', Typography: { Paragraph: 'Paragraph' },
};
function extract(path, names) {
    const file = ts.createSourceFile(path, readFileSync(root + path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const declarations = new Map();
    const visit = node => {
        if (ts.isFunctionDeclaration(node) && node.name) declarations.set(node.name.text, node.getText(file));
        if (ts.isVariableDeclaration(node) && node.initializer) declarations.set(node.name.getText(file), `const ${node.name.getText(file)} = ${node.initializer.getText(file)};`);
        ts.forEachChild(node, visit);
    };
    visit(file);
    const source = names.map(name => {
        assert.ok(declarations.has(name), `实际入口不存在：${name}`);
        return declarations.get(name);
    }).join('\n') + `\nmodule.exports = { ${names.join(',')} };`;
    return extra => {
        const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
        const module = { exports: {} }, context = { ...scope, ...extra };
        new Function('require', 'module', 'exports', ...Object.keys(context), code)(id => {
            assert.equal(id, 'react/jsx-runtime');
            return { jsx, jsxs: jsx };
        }, module, module.exports, ...Object.values(context));
        return module.exports;
    };
}
const elements = node => !node || typeof node !== 'object' ? []
    : [node, ...[node.props?.children].flat(Infinity).flatMap(elements)];
const buttons = tree => elements(tree).filter(node => ['button', 'Button'].includes(node.type));
const errorDetails = '图片尺寸不符：要求 1152 × 1536，上游返回 1024 × 1536。此结果不支持重试。';
const canvas = extract('components/canvas/canvas-node.tsx', ['ErrorContent', 'BatchImageFailureActions'])();
const imagePage = extract('pages/image/index.tsx', ['FailedImageCard', 'retryResult']);

test('画布失败卡保留尺寸说明并移除重试，普通失败仍有原按钮', () => {
    const blocked = canvas.ErrorContent({ node: { metadata: { errorDetails } }, theme, onRetry: assert.fail });
    assert.equal(buttons(blocked).length, 0);
    assert.ok(elements(blocked).some(node => node.props?.children === errorDetails));
    const ordinary = canvas.ErrorContent({ node: { metadata: { errorDetails: '连接中断' } }, theme, onRetry() {} });
    assert.equal(buttons(ordinary).length, 1);
});

test('批次子图尺寸不符时只保留删除操作，普通失败仍可重试', () => {
    const blocked = canvas.BatchImageFailureActions({ placement: 'right', retryable: false, onRetry: assert.fail, onDelete() {} });
    assert.deepEqual(buttons(blocked).map(node => node.props['aria-label']), ['common.delete']);
    assert.equal(buttons(canvas.BatchImageFailureActions({ placement: 'left', onRetry() {}, onDelete() {} })).length, 2);
    const source = readFileSync(root + 'components/canvas/canvas-node.tsx', 'utf8');
    const file = ts.createSourceFile('canvas-node.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const retryProps = [];
    const visit = node => {
        if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(file) === 'BatchImageFailureActions')
            retryProps.push(node.attributes.properties.find(prop => ts.isJsxAttribute(prop) && prop.name.getText(file) === 'retryable')?.initializer?.expression?.getText(file));
        ts.forEachChild(node, visit);
    };
    visit(file);
    assert.deepEqual(retryProps.sort(), ['!imageSizeRetryBlocked(image)', '!imageSizeRetryBlocked(primaryImage)'].sort());
});

test('独立生图页无尺寸错误重试按钮，迟到点击在读取配置和发请求前退出', async () => {
    const api = imagePage({
        results: [{ error: errorDetails }], buildRequestSnapshot: () => assert.fail('不能读取新配置或发请求'),
    });
    assert.equal(buttons(api.FailedImageCard({ error: errorDetails, onRetry: assert.fail })).length, 0);
    assert.equal(buttons(api.FailedImageCard({ error: '普通上游错误', onRetry() {} })).length, 1);
    await api.retryResult(0);
});
