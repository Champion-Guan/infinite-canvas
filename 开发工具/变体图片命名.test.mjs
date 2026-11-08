import test from 'node:test';
import assert from 'node:assert/strict';
import { variantModules } from './产品变体生成夹具.mjs';
import { restoreVariantImageNames, generatedImageName, numberGeneratedImages } from '../扩展功能/媒体交付/生成图片命名.js';
import { historyDownloadFiles } from '../扩展功能/生成历史/历史下载文件.js';
import { readFileSync } from 'node:fs';
import ts from '../.运行/3100源/画布副本/web/node_modules/typescript/lib/typescript.js';

const image = (id, variant, sequence) => ({
    id, type: 'image', title: ` · ${variant}-${sequence}`, position: { x: 123, y: 456 }, width: 800, height: 800,
    metadata: { generationType: 'edit', generationNameBase: ` · ${variant}`, productVariant: { id: variant, name: variant, parameterId: 'parameter' },
        status: 'success', content: 'blob:existing', storageKey: 'original-file', prompt: 'Keep the original product.',
        gatewayGenerationTasks: [{ taskId: 'paid-task', slotId: 'image' }],
        images: [{ id: 'slot', name: ` · ${variant}-${sequence}`, status: 'success', content: 'blob:existing', storageKey: 'original-file' }] },
});
const rename = variantModules().load('媒体交付/生成图片来源.ts').renameGeneratedImageNodes;

test('真实生成入口空用途名称直接使用变体名，有用途时才插入分隔符', () => {
    const path = new URL('../.运行/3100源/画布副本/web/src/pages/canvas/project.tsx', import.meta.url);
    const ast = ts.createSourceFile('project.tsx', readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let expression;
    const visit = node => {
        if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'generationNameBase') expression = node.initializer;
        ts.forEachChild(node, visit);
    };
    visit(ast); assert.ok(expression, '读取装配后真实生成入口');
    const base = new Function('sourceNameBase', 'variantExecution', 'return ' + expression.getText(ast));
    assert.equal(base('', { snapshot: { name: '数字0' } }), '数字0');
    assert.equal(base('   ', { snapshot: { name: '数字3' } }), '数字3');
    assert.equal(base('主图', { snapshot: { name: '红色' } }), '主图 · 红色');
    assert.equal(base('主图', undefined), '主图');
});

test('仅恢复空用途拼接出的变体前缀，保留节点、编号、像素位置、媒体、配置和任务记录', () => {
    const source = [image('zero', '数字0', 1), image('three', '数字3', 2), image('zero4', '数字0', 4)];
    const before = structuredClone(source), result = rename(source, []);
    assert.deepEqual(result.map(node => node.title), ['数字0-1', '数字3-2', '数字0-4']);
    assert.deepEqual(result.map(node => node.metadata.generationNameBase), ['数字0', '数字3', '数字0']);
    assert.deepEqual(historyDownloadFiles(result).map(file => file.name), ['数字0-1', '数字3-2', '数字0-4']);
    for (const [i, node] of result.entries()) {
        assert.deepEqual([node.id, node.position, node.width, node.height], [source[i].id, source[i].position, source[i].width, source[i].height]);
        for (const key of ['gatewayGenerationTasks', 'storageKey', 'prompt', 'content', 'status', 'productVariant'])
            assert.deepEqual(node.metadata[key], source[i].metadata[key], key);
        assert.equal(node.metadata.images[0].id, 'slot');
        assert.equal(node.metadata.images[0].storageKey, 'original-file');
        assert.equal(generatedImageName(node, 'slot'), node.title);
    }
    assert.deepEqual(source, before);
    assert.equal(rename(result, []), result, '重复挂载不改名、不重复写入');
});

test('保留用户改过的标题和单图名称，正常中间分隔符及无变体依据的名称不处理', () => {
    const custom = image('custom', '数字0', 1);
    custom.title = '用户收藏的主图';
    custom.metadata.images[0].name = '用户指定文件名';
    const normal = image('normal', '数字0', 2);
    normal.title = '尺寸标注 · 数字0-2'; normal.metadata.generationNameBase = '尺寸标注 · 数字0';
    normal.metadata.images[0].name = normal.title;
    const unknown = image('unknown', '数字0', 3); delete unknown.metadata.productVariant;
    const mismatched = image('different', '数字0', 4); mismatched.metadata.productVariant.name = '数字3';
    const source = [custom, normal, unknown, mismatched], result = rename(source, []);
    assert.equal(result[0].title, '用户收藏的主图');
    assert.equal(result[0].metadata.images[0].name, '用户指定文件名');
    assert.equal(result[0].metadata.generationNameBase, '数字0');
    assert.equal(result[1], normal); assert.equal(result[2], unknown); assert.equal(result[3], mismatched);
    assert.equal(restoreVariantImageNames([normal, unknown, mismatched])[0], normal);
});

test('恢复后继续分配从原最大后缀开始，预留整批且旧图片不重新编号', () => {
    const source = rename([image('a', '数字0', 1), image('b', '数字0', 4)], []);
    const pending = { id: 'next', type: 'image', title: 'New result', metadata: {
        generationNameBase: '数字0', images: [{ id: 'new-a', status: 'loading' }, { id: 'new-b', status: 'loading' }] } };
    const result = numberGeneratedImages([...source, pending], node => node.metadata.generationNameBase);
    assert.deepEqual(result.map(node => node.title), ['数字0-1', '数字0-4', '数字0-5']);
    assert.deepEqual(result[2].metadata.images.map(slot => slot.name), ['数字0-5', '数字0-6']);
    assert.equal(result[0], source[0]); assert.equal(result[1], source[1]);
});
