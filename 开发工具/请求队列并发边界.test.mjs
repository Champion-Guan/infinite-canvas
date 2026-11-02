import test from 'node:test';
import assert from 'node:assert/strict';
import { createPacedDataClient } from '../扩展功能/本机存储/请求调度.mjs';

test('已授权免频率阈值的200个并发读取仍遵守6个在途名额，失败释放名额', async () => {
    let active = 0, peak = 0, completed = 0;
    const client = createPacedDataClient({ async readDocument(id) {
        active++; peak = Math.max(peak, active);
        try { await new Promise(resolve => setImmediate(resolve)); if (id % 9 === 0) throw Error('合成读取失败'); return id; }
        finally { active--; completed++; }
    } }, { requestLimit: 0, maxConcurrent: 6 });
    const results = await Promise.allSettled(Array.from({ length: 200 }, (_, id) => client.readDocument(id)));
    assert.equal(completed, 200); assert.equal(peak, 6); assert.equal(active, 0);
    assert.equal(results.filter(result => result.status === 'rejected').length, 23);
});

test('排队期间不能提前预支频率预算，实际发送时才计数', async () => {
    let clock = 0, active = 0; const times = [];
    const client = createPacedDataClient({ async readDocument() {
        assert.equal(++active, 1); times.push(clock);
        await new Promise(resolve => setImmediate(resolve)); clock += 100; active--;
    } }, { requestLimit: 2, maxConcurrent: 1, now: () => clock, wait: async ms => { clock += ms; } });
    await Promise.all(Array.from({ length: 12 }, () => client.readDocument()));
    assert.equal(times.length, 12);
    for (let i = 2; i < times.length; i++) assert.ok(times[i] - times[i - 2] >= 10050);
});

test('等待预算的读取让出名额，前台写入可以使用保留预算', async () => {
    let clock = 0, release; const waiting = new Promise(resolve => { release = resolve; });
    const client = createPacedDataClient({ readDocument: async () => 1, writeDocument: async () => 'saved' },
        { reserveWrites: true, now: () => clock, wait: () => waiting, maxConcurrent: 1 });
    await Promise.all(Array.from({ length: 64 }, () => client.readDocument()));
    const background = client.readDocument();
    assert.equal(await client.writeDocument(), 'saved');
    clock = 10051; release(); await background;
});

test('并发名额被占满时过期等待者从队列移除，后续上传仍可进入', async () => {
    let finishActive;
    const active = new Promise(resolve => { finishActive = resolve; });
    const client = createPacedDataClient({
        readDocument: async () => active,
        writeMedia: async blob => ({ size: blob.size }),
    }, { requestLimit: 0, maxConcurrent: 1, queueTimeoutMs: 15 });

    const occupying = client.readDocument('占位');
    await new Promise(resolve => setImmediate(resolve));
    await assert.rejects(client.writeMedia(new Blob(['等待中的文件'])), error => error.code === 'storage_queue_timeout');

    finishActive('释放');
    assert.equal(await occupying, '释放');
    assert.deepEqual(await client.writeMedia(new Blob(['再次上传'])), { size: 12 });
});

test('超时配置校验，且名额及时释放的等待请求不会被误判超时', async () => {
    assert.throws(() => createPacedDataClient({ readDocument() {} }, { queueTimeoutMs: 0 }), /队列等待时间/);
    let finishActive;
    const active = new Promise(resolve => { finishActive = resolve; });
    const client = createPacedDataClient({ readDocument: async () => active, writeMedia: async () => 'ok' },
        { requestLimit: 0, maxConcurrent: 1, queueTimeoutMs: 500 });
    const occupying = client.readDocument('占位');
    const queued = client.writeMedia(new Blob(['文件']));
    finishActive('完成');
    await occupying;
    assert.equal(await queued, 'ok');
});

test('批量媒体写入通过调度端口作为一个前台请求发送', async () => {
    let batchCalls = 0, singleCalls = 0, active = 0, peak = 0;
    const client = createPacedDataClient({
        readDocument: async () => null,
        writeMedia: async blob => { singleCalls++; return { id: 'single', size: blob.size }; },
        async writeMediaBatch(items) {
            batchCalls++; active++; peak = Math.max(peak, active);
            try {
                await new Promise(resolve => setImmediate(resolve));
                return items.map((item, index) => ({ id: `batch-${index}`, size: item.blob.size }));
            } finally { active--; }
        },
    }, { requestLimit: 0, maxConcurrent: 1 });
    const items = [{ blob: new Blob(['one']) }, { blob: new Blob(['two']) }];
    assert.deepEqual(await client.writeMediaBatch(items), [
        { id: 'batch-0', size: 3 },
        { id: 'batch-1', size: 3 },
    ]);
    assert.equal(batchCalls, 1);
    assert.equal(singleCalls, 0, '调度封装不能让批量媒体退化为逐张写入');
    assert.equal(peak, 1);
});
