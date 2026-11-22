import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { variantModules } from './产品变体生成夹具.mjs';

const require = createRequire(new URL('../.运行/3100源/画布副本/web/package.json', import.meta.url));
const { strFromU8, strToU8, unzipSync, zipSync } = require('fflate');
const loader = variantModules({ nanoid: { nanoid: randomUUID } });
const { productPlanOps } = loader.load('Excel画布/商品提示词画布.ts');
const { promptDocument } = loader.load('Excel画布/商品提示词规则.ts');
const { productVariants } = loader.load('Excel画布/产品变体规则.ts');
const { prepareCanvasExport } = loader.load('画布导入/画布导入数据.ts');
const nodes = [], connections = [];

for (let index = 0; index < 22; index++) {
    const group = String(index + 1).padStart(2, '0');
    const title = `勾选连点验收 ${group}`;
    const variants = Array.from({ length: 12 }, (_, i) => ({
        id: randomUUID(), name: `${group}号变体 ${String(i + 1).padStart(2, '0')}`,
        enabled: true, attributes: {}, imageIds: [],
    }));
    const y = 60 + index * 730;
    const parameter = { id: randomUUID(), type: 'guan:prompt-variables', title: `验收参数 ${group}`,
        position: { x: 60, y }, width: 420, height: 540, metadata: {
            productVariants: variants, productPlatform: '未指定', productLanguage: '中文',
            productBrief: { nameCategory: title }, productRequirements: '合成数据，仅用于勾选与保存验收。',
        } };
    const chinese = '仅用于测试提示词变体选择、卡片标题和保存后的读回。';
    const pair = { chinese, english: 'Synthetic variant selection and persistence check.', translatedChinese: chinese };
    const plan = { overview: { buyers: '', sellingPoints: '', concerns: '', consistency: '', sequence: '' },
        style: '', assumptions: [], pendingFacts: [], images: [{
            key: `selection-${group}`, kind: 'main', name: title, buyerQuestion: '', evidence: '',
            composition: '', constraints: '', copyLayout: '', checks: '',
            delivery: { width: 1152, height: 1536, format: 'png', maxMB: 10 },
            prompt: pair, variants: Object.fromEntries(variants.map(({ id }) => [id, pair])),
        }] };
    nodes.push(parameter);
    for (const op of productPlanOps(parameter, plan, [parameter], [], `local-selection-check-${group}`)) {
        if (op.type === 'add_node') nodes.push({ id: op.id, type: op.nodeType, title: op.title,
            position: op.position, width: op.width, height: op.height, metadata: op.metadata });
        if (op.type === 'update_node') {
            const node = nodes.find(item => item.id === op.id);
            Object.assign(node, op.patch);
            node.metadata = { ...node.metadata, ...op.metadata };
        }
        if (op.type === 'connect_nodes') connections.push({ id: randomUUID(), fromNodeId: op.fromNodeId, toNodeId: op.toNodeId });
    }
}

for (let i = 0; i < 160; i++) nodes.push({ id: randomUUID(), type: 'text', title: `合成占位卡片 ${i + 1}`,
    position: { x: 1590 + (i % 8) * 280, y: 60 + Math.floor(i / 8) * 730 }, width: 240, height: 150,
    metadata: { content: '合成占位卡片，用于匹配验收画布节点规模。', status: 'idle' } });

const now = new Date().toISOString();
const project = { id: randomUUID(), title: '变体连点验收（合成226节点）', nodes, connections,
    viewport: { x: 20, y: 30, k: .8 }, createdAt: now, updatedAt: now };
const archive = zipSync({ 'projects.json': strToU8(JSON.stringify({
    app: 'infinite-canvas', version: 3, projects: [{ project, files: [] }],
})) });
const decoded = JSON.parse(strFromU8(unzipSync(archive)['projects.json']));
const imported = prepareCanvasExport(decoded, new Map());
assert.equal(imported.media.length, 0);
const loaded = imported.projects[0].project;
assert.equal(loaded.nodes.length, 226);
assert.equal(loaded.connections.length, 44);
const promptNodes = loaded.nodes.filter(node => promptDocument(node));
assert.equal(promptNodes.length, 22);
for (const node of promptNodes) {
    const document = promptDocument(node);
    const parameter = loaded.nodes.find(item => item.id === document.parameterId);
    const variants = productVariants(parameter.metadata);
    assert.equal(variants.length, 12);
    assert.ok(variants.every(variant => variant.enabled && document.variants[variant.id]));
}

const target = resolve(process.argv[2] ?? resolve(homedir(), 'Downloads', '变体连点验收-合成226节点.zip'));
writeFileSync(target, archive, { flag: 'wx' });
console.log(JSON.stringify({ 文件: target, 节点: loaded.nodes.length, 连接: loaded.connections.length, 提示词卡: promptNodes.length }));
