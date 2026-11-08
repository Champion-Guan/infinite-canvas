import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

// 生成本地色块样本，经原产品导入入口验收；不调用模型、不写业务数据库。
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(resolve(root, '.运行/3100源/画布副本/web/package.json'));
const { zipSync, strToU8 } = require('fflate');
const out = resolve(root, '.运行/output/图片批次与保存重连验收');
mkdirSync(out, { recursive: true });
function crc32(data) {
    let crc = 0xffffffff;
    for (const byte of data) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, bytes) {
    const name = Buffer.from(type), size = Buffer.alloc(4), crc = Buffer.alloc(4);
    size.writeUInt32BE(bytes.length); crc.writeUInt32BE(crc32(Buffer.concat([name, bytes])));
    return Buffer.concat([size, name, bytes, crc]);
}
function png(width, height, color) {
    const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
    const row = Buffer.alloc(1 + width * 3);
    for (let x = 0; x < width; x++) row.set(color, 1 + x * 3);
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
        chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))), chunk('IEND', Buffer.alloc(0))]);
}
const archive = {}, manifest = [];
function media(name, width, height, color) {
    const bytes = png(width, height, color), path = `media/${name}.png`, storageKey = `image:批次验收-${name}`;
    archive[path] = bytes; manifest.push({ storageKey, path, bytes: bytes.length, mimeType: 'image/png' });
    return { storageKey, width, height, bytes: bytes.length, mimeType: 'image/png', content: `data:image/png;base64,${bytes.toString('base64')}` };
}
function image(id, width, height, color) {
    const original = media(`${id}原图`, width * 2, height * 2, color), delivery = media(`${id}交付`, width, height, color);
    return { id, name: `主图-${id}`, status: 'success', content: delivery.content, storageKey: delivery.storageKey,
        naturalWidth: width, naturalHeight: height, bytes: delivery.bytes, mimeType: delivery.mimeType,
        originalStorageKey: original.storageKey, originalWidth: original.width, originalHeight: original.height, originalBytes: original.bytes, originalMimeType: original.mimeType,
        deliveryStorageKey: delivery.storageKey, deliveryWidth: width, deliveryHeight: height, deliveryBytes: delivery.bytes, deliveryMimeType: delivery.mimeType };
}
const red = { ...image('1', 600, 300, [228, 75, 62]), status: 'error', errorDetails: '重试失败保留旧结果的本地样本，请勿重试生成' };
const blue = image('2', 200, 600, [42, 113, 222]);
const empty = { id: 'empty', name: '主图-3', status: 'error', content: '', errorDetails: '本地空槽样本，请勿重试生成', naturalWidth: 0, naturalHeight: 0, bytes: 0, mimeType: '' };
const nodes = [{ id: 'batch', type: 'image', title: '主图-1', position: { x: 100, y: 550 }, width: 400, height: 200,
    metadata: { ...red, status: 'success', images: [red, empty, blue], primaryImageId: red.id, count: 3,
        generationType: 'generation', generationStartedAt: Date.now(), model: '本地验收样本', quality: 'high', size: '600x300', prompt: '本地红色横图与蓝色竖图，用于批次主图切换、复制、删除和下载核验。' } }];
const project = { id: '图片批次验收画布', title: '图片批次操作验收（可回收）', nodes, connections: [], viewport: { x: 150, y: 100, k: .8 },
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
archive['projects.json'] = strToU8(JSON.stringify({ app: 'infinite-canvas', version: 3, projects: [{ project, files: manifest }] }));
const target = resolve(out, '图片批次操作验收.zip'); writeFileSync(target, zipSync(archive));
console.log(JSON.stringify({ 导入包: target, 节点: nodes.length, 素材: manifest.length }));
