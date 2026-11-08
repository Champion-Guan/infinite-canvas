import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

// 只制作标准导入包，经原3100“导入产品”入口验收，不写工作台数据库。
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(resolve(root, '.运行/3100源/画布副本/web/package.json'));
const { zipSync, strToU8 } = require('fflate');
const out = resolve(root, '.运行/output/生成历史总览验收'); mkdirSync(out, { recursive: true });
const archive = {}, manifest = [];
const images = ['完成后原3100.png', '原配置图像设置.png', '生成历史入口.png'].map((name, index) => {
    const source = resolve(root, '.运行/output/图片结果归并验收', name);
    const bytes = readFileSync(source);
    const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const mimeType = png ? 'image/png' : 'image/jpeg';
    const dimensions = execFileSync('/usr/bin/sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', source], { encoding: 'utf8' });
    const width = Number(dimensions.match(/pixelWidth: (\d+)/)?.[1]), height = Number(dimensions.match(/pixelHeight: (\d+)/)?.[1]);
    if (!width || !height) throw Error('无法读取验收图片尺寸');
    const path = `media/${index + 1}.${png ? 'png' : 'jpg'}`, storageKey = `image:总览验收${index + 1}`;
    archive[path] = bytes;
    manifest.push({ storageKey, path, bytes: bytes.length, mimeType });
    return { id: `image-${index + 1}`, status: 'success', name: `验收图片${index + 1}`, content: `data:${mimeType};base64,${bytes.toString('base64')}`, storageKey,
        naturalWidth: width, naturalHeight: height, bytes: bytes.length, mimeType };
});
const common = { generationType: 'image', generationStartedAt: Date.now(), model: '验收样本', channel: '本地文件', prompt: '本地界面截图，仅用于总览、勾选、预览和下载验收。' };
const nodes = [
    { id: 'batch', type: 'image', title: '主图 · 两张成功与一张失败', position: { x: 100, y: 100 }, width: 500, height: 220,
        metadata: { ...common, ...images[0], status: 'success', images: [images[0], images[1], { id: 'failed-slot', status: 'error', errorDetails: '本地验收失败样本' }], count: 3, primaryImageId: images[0].id } },
    { id: 'single', type: 'image', title: '详情页01 · 单张成功', position: { x: 700, y: 100 }, width: 500, height: 220,
        metadata: { ...common, ...images[2], status: 'success' } },
    { id: 'failed', type: 'image', title: '详情页02 · 失败任务', position: { x: 100, y: 500 }, width: 400, height: 220,
        metadata: { ...common, status: 'error', errorDetails: '本地验收失败样本，请勿触发模型重试' } },
];
const project = { id: '总览验收画布', title: '生成历史总览验收（可回收）', nodes, connections: [], viewport: { x: 0, y: 0, k: .7 }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
archive['projects.json'] = strToU8(JSON.stringify({ app: 'infinite-canvas', version: 3, projects: [{ project, files: manifest }] }));
const target = resolve(out, '生成历史总览验收.zip'); writeFileSync(target, zipSync(archive, { level: 0 }));
console.log(JSON.stringify({ 导入包: target, 节点: nodes.length, 成功文件: images.length }));
