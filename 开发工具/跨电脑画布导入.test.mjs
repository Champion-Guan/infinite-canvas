import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { variantModules } from './产品变体生成夹具.mjs';
import { openWorkspace } from '../扩展功能/本机存储/SQLite工作区.mjs';
import { createRecoverableShardedApplicationStorage } from '../扩展功能/本机存储/可恢复分片应用存储.mjs';

const require = createRequire(new URL('../.运行/3100源/画布副本/web/package.json', import.meta.url));
const { unzipSync, zipSync } = require('fflate');
const oldUrl = 'blob:http://localhost:3000/source-browser-only';
let sequence = 0;
const modules = variantModules({ nanoid: { nanoid: () => `import-${++sequence}` } });
const { prepareCanvasExport } = modules.load('画布导入/画布导入数据.ts');
const { prepareCanvasContentImport } = modules.load('画布导入/画布内容导入.ts');
const node = (id, metadata, type = 'image') => ({ id, type, title: id, position: { x: 0, y: 0 }, width: 100, height: 100, metadata });
function sample() {
    const parameters = { productMainImages: [{ id: 'main', name: '原图.png', storageKey: 'image:source', originalStorageKey: 'image:source', url: oldUrl }],
        productMainImageStorageKey: 'image:source', productMainImageUrl: oldUrl };
    const fingerprint = JSON.stringify([{ images: [{ id: 'main', name: '原图.png' }] }, [['main', 'image:source', null]]]);
    const parameter = node('parameter', { ...parameters, productImagePlan: { source: { fingerprint, parameters: JSON.stringify(parameters) } } }, 'guan:prompt-variables');
    const image = node('image', { storageKey: 'image:source', content: oldUrl, references: ['image:source'],
        images: [{ id: 'slot', storageKey: 'image:source', content: oldUrl }] });
    const project = { id: 'source', title: '跨电脑导入', createdAt: '2026-11-09T00:00:00Z', updatedAt: '2026-11-09T00:00:00Z',
        nodes: [parameter, image, node('prompt', { productPromptSourceFingerprint: fingerprint }, 'guan:product-prompt')],
        connections: [{ id: 'edge', fromNodeId: 'parameter', toNodeId: 'prompt' }], chatSessions: [{ id: 'chat', messages: [{ references: [{ storageKey: 'image:source', dataUrl: oldUrl }] }] }],
        deletedNodeBatches: [{ id: 'deleted', nodes: [image], relatedNodes: [parameter], connections: [] }] };
    const files = [{ storageKey: 'image:source', path: 'original.png', bytes: 3, mimeType: 'image/png' }];
    return { data: { app: 'infinite-canvas', version: 3, projects: [{ project, files }] }, zip: new Map([['original.png', new Blob(['abc'])]]) };
}

test('旧ZIP导入重映射主图别名与嵌套快照，不携带原浏览器Blob地址', () => {
    const { data, zip } = sample(), before = structuredClone(data);
    const result = prepareCanvasExport(data, zip), project = result.projects[0].project, key = result.media[0].key;
    assert.notEqual(key, 'image:source');
    assert.equal(project.nodes[0].metadata.productMainImageStorageKey, key);
    assert.equal(project.nodes[0].metadata.productMainImages[0].storageKey, key);
    assert.equal(project.deletedNodeBatches[0].relatedNodes[0].metadata.productMainImageStorageKey, key);
    assert.equal(project.nodes[1].metadata.images[0].storageKey, key);
    assert.equal(project.chatSessions[0].messages[0].references[0].storageKey, key);
    assert.doesNotMatch(JSON.stringify(project), /blob:/);
    const fingerprint = JSON.parse(project.nodes[2].metadata.productPromptSourceFingerprint);
    assert.equal(fingerprint[1][0][1], key);
    assert.equal(JSON.parse(project.nodes[0].metadata.productImagePlan.source.parameters).productMainImageStorageKey, key);
    assert.deepEqual(data, before);
});

test('当前画布追加也移除跨电脑临时地址，引用仍指向本次导入媒体', () => {
    const { data, zip } = sample();
    const result = prepareCanvasContentImport(data, zip, []);
    assert.doesNotMatch(JSON.stringify(result.nodes), /blob:/);
    assert.equal(result.nodes[0].metadata.productMainImageStorageKey, result.media[0].key);
    assert.equal(result.nodes[1].metadata.storageKey, result.media[0].key);
});

test('无打包媒体对应的临时地址在应用产品前明确拒绝', () => {
    const { data, zip } = sample();
    data.projects[0].project.nodes.push(node('lost', { content: 'blob:http://localhost:3000/not-in-package' }));
    assert.throws(() => prepareCanvasExport(data, zip), /临时媒体|媒体.*ZIP/);
    assert.throws(() => prepareCanvasContentImport(data, zip, []), /临时媒体|媒体.*ZIP/);
});

async function exportPackage(project, media) {
    let saved;
    const exporter = variantModules({
        'file-saver': { saveAs: blob => { saved = blob; } },
        '@/i18n': { default: { t: key => key } },
        '@/services/image-storage': { getImageBlob: async key => media.get(key) },
        '@/services/file-storage': { getMediaBlob: async key => media.get(key) },
        '@/lib/zip': { createZip: async files => new Blob([zipSync(Object.fromEntries(await Promise.all(files.map(async file =>
            [file.name, new Uint8Array(await new Blob([file.data]).arrayBuffer())]))), { level: 0 })]) },
    }).load('lib/canvas/canvas-export.ts', true);
    await exporter.exportCanvasProjects([project], '跨电脑往返');
    return saved;
}

test('重新导出的ZIP只含稳定引用，兼容单主图旧字段且不改当前画布', async () => {
    const { data } = sample(), project = data.projects[0].project;
    delete project.nodes[0].metadata.productMainImages;
    const before = structuredClone(project);
    const blob = await exportPackage(project, new Map([['image:source', new Blob(['abc'], { type: 'image/png' })]]));
    const zip = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    const exported = JSON.parse(Buffer.from(zip['projects.json']).toString());
    assert.equal(exported.projects[0].files.length, 1);
    assert.doesNotMatch(JSON.stringify(exported), /blob:/);
    assert.equal(exported.projects[0].project.nodes[0].metadata.productMainImageStorageKey, 'image:source');
    assert.deepEqual(project, before);
});

test('缺失原图时拒绝不完整导出，不再静默跳过文件', async () => {
    await assert.rejects(exportPackage(sample().data.projects[0].project, new Map()), /媒体无法读取/);
});

test('重映射来源指纹不重算用户资料，原本已失效的来源仍保留差异', () => {
    const { data, zip } = sample();
    const original = JSON.parse(data.projects[0].project.nodes[2].metadata.productPromptSourceFingerprint);
    original[0].platform = '旧平台';
    original[1].push(['removed', 'image:removed-before-export', null]);
    data.projects[0].project.nodes[2].metadata.productPromptSourceFingerprint = JSON.stringify(original);
    const result = prepareCanvasExport(data, zip);
    const source = JSON.parse(result.projects[0].project.nodes[2].metadata.productPromptSourceFingerprint);
    assert.equal(source[0].platform, '旧平台');
    assert.equal(source[1][1][1], 'image:removed-before-export');
    assert.notEqual(source[1][0][1], 'image:source');
});

test('旧版失败追加后再导出的包，主图别名凭相同地址修复到实际已打包的文件', async () => {
    const { data, zip } = sample();
    const parameter = data.projects[0].project.nodes[0].metadata;
    parameter.productMainImageStorageKey = 'image:previous-machine-alias';
    const result = prepareCanvasExport(data, zip);
    assert.equal(result.projects[0].project.nodes[0].metadata.productMainImageStorageKey, result.media[0].key);
    const exported = await exportPackage(data.projects[0].project, new Map([['image:source', new Blob(['abc'], { type: 'image/png' })]]));
    const files = unzipSync(new Uint8Array(await exported.arrayBuffer()));
    const manifest = JSON.parse(Buffer.from(files['projects.json']).toString());
    assert.equal(manifest.projects[0].files.length, 1);
    assert.equal(manifest.projects[0].project.nodes[0].metadata.productMainImageStorageKey, 'image:source');
});

async function persistAndColdOpen(data, zip) {
    const root = mkdtempSync(join(tmpdir(), '跨电脑画布导入-'));
    let workspace, app;
    try {
        workspace = openWorkspace({ dataRoot: root, initialize: true });
        let foreignReads = 0;
        const client = {
            readDocument: (...args) => workspace.readDocument(...args),
            writeDocument: input => workspace.writeDocument(input),
            writeFragments: items => workspace.writeFragments(items),
            async writeMedia(blob) { return workspace.writeMedia(Buffer.from(await blob.arrayBuffer()), blob.type); },
            async readMedia(id) { const media = workspace.readMedia(id); return new Blob([media.bytes], { type: media.mime }); },
        };
        const options = { client, namespaceSnapshots: true, requestLimit: 0, readBlobUrl: async () => { foreignReads++; throw Error('Mac B 无法读取来源浏览器的临时地址'); } };
        app = createRecoverableShardedApplicationStorage(options);
        const stored = new Map();
        const writes = {
            async setImageBlob(key, blob) { await app.createInstance({ storeName: 'image_files' }).setItem(key, blob); stored.set(key, blob); },
            async setMediaBlob(key, blob) { await app.createInstance({ storeName: 'media_files' }).setItem(key, blob); stored.set(key, blob); },
        };
        const { readCanvasExport } = variantModules({
            nanoid: { nanoid: () => `import-${++sequence}` },
            '@/lib/zip': { readZip: async () => new Map([...zip, ['projects.json', new Blob([JSON.stringify(data)])]]) },
            '@/services/image-storage': { setImageBlob: writes.setImageBlob, deleteStoredImages: async () => assert.fail('成功导入不应清理媒体') },
            '@/services/file-storage': { setMediaBlob: writes.setMediaBlob, deleteStoredMedia: async () => assert.fail('成功导入不应清理媒体') },
        }).load('画布导入/画布导入.ts');
        const imported = await readCanvasExport(new Blob());
        const key = 'infinite-canvas:canvas_store';
        const state = { state: { projects: imported.map(item => item.project), deletedProjects: [], guanWorkbooks: null }, version: 0 };
        await app.createInstance({ storeName: 'app_state' }).setItem(key, JSON.stringify(state));
        await app.flush();
        assert.equal(foreignReads, 0);
        assert.equal(app.getStatus().state, 'saved');
        app.close(); app = null; workspace.close(); workspace = openWorkspace({ dataRoot: root });
        app = createRecoverableShardedApplicationStorage(options);
        const recovered = JSON.parse(await app.createInstance({ storeName: 'app_state' }).getItem(key));
        assert.deepEqual(recovered, state, '冷重开保留完整产品、节点、连线、回收站与聊天');
        for (const item of imported) for (const file of item.files) {
            const namespace = file.storageKey.startsWith('image:') ? 'image_files' : 'media_files';
            const blob = await app.createInstance({ storeName: namespace }).getItem(file.storageKey);
            assert.equal(blob.size, file.bytes);
            assert.deepEqual(Buffer.from(await blob.arrayBuffer()), Buffer.from(await stored.get(file.storageKey).arrayBuffer()));
        }
        return { products: recovered.state.projects.length, nodes: recovered.state.projects[0].nodes.length,
            connections: recovered.state.projects[0].connections.length, media: stored.size, foreignReads };
    } finally {
        try { app?.close(); } catch { /* 失败用例仍清理本次合成数据库。 */ }
        try { workspace?.close(); } finally { rmSync(root, { recursive: true, force: true }); }
    }
}

test('空白接收端完成媒体和产品SQLite落盘，冷重开不会丢产品', async () => {
    const { data, zip } = sample();
    await persistAndColdOpen(data, zip);
});

if (process.env.GUAN_IMPORT_ARCHIVE) test('用户原始ZIP在空白接收端完整导入并冷重开', { timeout: 120_000 }, async () => {
    const entries = unzipSync(readFileSync(process.env.GUAN_IMPORT_ARCHIVE));
    const zip = new Map(Object.entries(entries).map(([path, bytes]) => [path, new Blob([bytes])]));
    const data = JSON.parse(await zip.get('projects.json').text());
    const prepared = prepareCanvasExport(data, zip);
    const planning = modules.load('Excel画布/商品提示词规则.ts');
    for (const node of data.projects[0].project.nodes) {
        const document = node.metadata?.productImagePrompt;
        if (!document) continue;
        const source = data.projects[0].project.nodes.find(item => item.id === document.parameterId);
        const imported = prepared.projects[0].project.nodes.find(item => item.id === node.id);
        const importedSource = prepared.projects[0].project.nodes.find(item => item.id === document.parameterId);
        assert.ok(source && importedSource);
        assert.deepEqual(planning.productPlanningChangeDetails(importedSource.metadata, imported.metadata.productPromptSourceFingerprint),
            planning.productPlanningChangeDetails(source.metadata, node.metadata.productPromptSourceFingerprint),
            '导入只重映射文件位置，不能使有效提示词失效或掩盖原有商品资料变更');
    }
    console.log('原始ZIP冷重开结果', await persistAndColdOpen(data, zip));
    const media = new Map(data.projects[0].files.map(file => [file.storageKey, zip.get(file.path).slice(0, file.bytes, file.mimeType)]));
    const exported = await exportPackage(data.projects[0].project, media);
    const exportedFiles = unzipSync(new Uint8Array(await exported.arrayBuffer()));
    const roundtripZip = new Map(Object.entries(exportedFiles).map(([path, bytes]) => [path, new Blob([bytes])]));
    const roundtripData = JSON.parse(await roundtripZip.get('projects.json').text());
    assert.doesNotMatch(JSON.stringify(roundtripData), /blob:/);
    console.log('重新导出往返冷重开结果', await persistAndColdOpen(roundtripData, roundtripZip));
});
