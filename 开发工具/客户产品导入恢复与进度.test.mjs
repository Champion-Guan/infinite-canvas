import test from 'node:test';
import assert from 'node:assert/strict';
import { variantModules } from './产品变体生成夹具.mjs';

test('导入归档来源任务身份并保留全部结果、错误和历史，重复处理不嵌套归档', () => {
    const { portableTaskSnapshot } = variantModules().load('画布导入/导入任务快照.ts');
    const value = { nodes: [{ id: 'result', type: 'image', metadata: { status: 'success', storageKey: 'image:original',
        images: [{ id: 'slot', storageKey: 'image:original', content: 'local-image', status: 'success' }],
        gatewayGenerationTasks: [{ taskId: 'foreign', slotId: 'slot' }],
        gatewayGenerationReceipts: [{ taskId: 'foreign', responseHash: 'source-hash' }] } }],
        deletedNodeBatches: [{ nodes: [{ metadata: { videoTaskId: 'remote-video', content: 'saved-video' } }] }] };
    const before = structuredClone(value), result = portableTaskSnapshot(value);
    assert.deepEqual(value, before);
    const metadata = result.nodes[0].metadata;
    assert.equal(metadata.gatewayGenerationTasks, undefined);
    assert.equal(metadata.gatewayGenerationReceipts, undefined);
    assert.equal(metadata.importedTaskHistory.gatewayGenerationTasks[0].taskId, 'foreign');
    assert.deepEqual(metadata.images, value.nodes[0].metadata.images);
    assert.equal(result.deletedNodeBatches[0].nodes[0].metadata.content, 'saved-video');
    assert.deepEqual(portableTaskSnapshot(result), result);
});

test('媒体导入有进度且最多三个并发写入', async () => {
    let active = 0, peak = 0;
    const reports = [], completed = [];
    const media = Array.from({ length: 11 }, (_, i) => ({ key: 'image:' + i, blob: new Blob(['data']) }));
    const write = async key => { active++; peak = Math.max(peak, active); await new Promise(resolve => setImmediate(resolve)); completed.push(key); active--; };
    const { readCanvasExport } = variantModules({
        '@/lib/zip': { readZip: async () => new Map([['projects.json', new Blob(['{}'])]]) },
        './画布导入数据': { prepareCanvasExport: () => ({ projects: [{ project: { title: '导入' } }], media }) },
        './产品导入进度': { publishImportProgress: value => reports.push(value) },
        '@/services/image-storage': { setImageBlob: write, deleteStoredImages: async () => assert.fail('成功不删除') },
        '@/services/file-storage': { setMediaBlob: write, deleteStoredMedia: async () => assert.fail('成功不删除') },
    }).load('画布导入/画布导入.ts');
    const result = await readCanvasExport(new File(['zip'], '客户包.zip'));
    assert.equal(result.length, 1); assert.equal(peak, 3); assert.equal(active, 0); assert.equal(completed.length, 11);
    assert.equal(reports.at(-1).completed, 11); assert.equal(reports.at(-1).percent, 85);
    assert.ok(reports.every((value, index) => index === 0 || value.percent >= reports[index - 1].percent));
});

test('媒体写入失败等所有在途写入退出再清理本次媒体，不返回成功结果', async () => {
    let active = 0, cleaned = false;
    const media = Array.from({ length: 5 }, (_, i) => ({ key: 'image:' + i, blob: new Blob(['data']) }));
    const write = async key => {
        active++;
        try {
            await new Promise(resolve => setImmediate(resolve));
            if (key === 'image:1') throw new Error('磁盘写入失败');
        } finally { active--; }
    };
    const { readCanvasExport } = variantModules({
        '@/lib/zip': { readZip: async () => new Map([['projects.json', new Blob(['{}'])]]) },
        './画布导入数据': { prepareCanvasExport: () => ({ projects: [], media }) },
        './产品导入进度': { publishImportProgress() {} },
        '@/services/image-storage': { setImageBlob: write, deleteStoredImages: async keys => {
            assert.equal(active, 0); assert.deepEqual(keys, media.map(item => item.key)); cleaned = true;
        } },
        '@/services/file-storage': { setMediaBlob: write, deleteStoredMedia: async () => {} },
    }).load('画布导入/画布导入.ts');
    await assert.rejects(readCanvasExport(new File(['zip'], '客户包.zip')), /磁盘写入失败/);
    assert.equal(cleaned, true);
});

test('旧空视区与非数值缩放恢复合法坐标，调度器不绘制或提交无效数值', () => {
    const modules = variantModules(), { restoreValidViewport } = modules.load('画布交互/有效视区.ts');
    for (const value of [undefined, { x: 0, y: 0, k: null }, { x: 0, y: 0, k: NaN }, { x: Infinity, y: 0, k: 1 }])
        assert.deepEqual(restoreValidViewport(value), { x: 0, y: 0, k: 1 });
    const painted = [], committed = [], frames = [];
    const scheduler = modules.load('画布布局/画布平移调度.ts').createCanvasPanScheduler({
        paint: value => painted.push(value), commit: value => committed.push(value), frame: fn => (frames.push(fn), frames.length),
        cancel() {}, now: () => 0,
    });
    scheduler.begin({ x: 0, y: 0, k: null });
    scheduler.move({ x: NaN, y: 0, k: NaN });
    scheduler.flush(); assert.deepEqual(painted, [{ x: 0, y: 0, k: 1 }]); assert.deepEqual(committed, []);
});
