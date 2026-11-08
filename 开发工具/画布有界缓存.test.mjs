import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(resolve(root, '.运行/3100源/画布副本/web/package.json'));
const ts = require('typescript');
function load(name, dependencies = {}) {
    const source = readFileSync(resolve(root, '扩展功能/产品', name), 'utf8');
    const module = { exports: {} };
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    new Function('require', 'module', 'exports', code)(id => {
        assert.ok(Object.hasOwn(dependencies, id), `未注入依赖：${id}`); return dependencies[id];
    }, module, module.exports);
    return module.exports;
}
const { createProductCanvasCache, retainedProductCanvases, PRODUCT_CANVAS_IDLE_TIMEOUT_MS } = load('画布缓存规则.ts');
const residencyModule = load('画布驻留保护.ts');
const { ProductCanvasResidency } = residencyModule;
const { ProductCommitCheckpoint } = load('产品保存检查点.ts');
const settle = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

function cacheFixture(initial = ['A', 'B', 'C']) {
    let residents = initial, active = initial.at(-1), prepare = async () => () => true;
    const busy = new Set(), scheduled = new Map(), releases = [], preparations = [], delayed = [];
    let sequence = 0, delayedRelease = false, now = 0;
    const activity = new Map();
    const manager = createProductCanvasCache({
        residents: () => residents, active: () => active, eligible: id => !busy.has(id),
        activity: id => activity.get(id) || 0, now: () => now,
        prepare: async id => { preparations.push(id); return prepare(id); },
        release: (id, proof) => {
            const apply = () => { if (proof()) { residents = residents.filter(item => item !== id); releases.push(id); manager.changed(); } };
            if (delayedRelease) delayed.push(apply); else apply();
        },
        schedule: (fn, delay) => { const id = ++sequence; scheduled.set(id, { fn, due: now + delay }); return () => scheduled.delete(id); },
    });
    return { manager, busy, scheduled, releases, preparations, delayed, residents: () => residents,
        prepare: fn => { prepare = fn; }, delayRelease: () => { delayedRelease = true; },
        visit(id) { active = id; residents = retainedProductCanvases(residents, id, new Set([...residents, id])); manager.changed(); },
        activity(id) { activity.set(id, (activity.get(id) || 0) + 1); manager.request(); },
        async advance(ms) { now += ms;
            for (let i = 0; i < 30; i++) {
                const due = [...scheduled].filter(([, item]) => item.due <= now);
                if (!due.length) break;
                due.forEach(([id, item]) => { scheduled.delete(id); item.fn(); }); await settle();
            }
        },
    };
}

test('频繁切换保留热实例，连续安全空闲满五分钟后释放所有非当前画布', async () => {
    assert.equal(PRODUCT_CANVAS_IDLE_TIMEOUT_MS, 300000);
    assert.deepEqual(retainedProductCanvases(['A', 'B', 'deleted'], 'A', new Set(['A', 'B'])), ['B', 'A']);
    const f = cacheFixture(); f.manager.request(); await f.advance(299999);
    assert.deepEqual(f.residents(), ['A', 'B', 'C']); assert.deepEqual(f.preparations, []);
    await f.advance(1); assert.deepEqual(f.residents(), ['C']); assert.deepEqual(f.releases, ['A', 'B']);
    for (let i = 0; i < 12; i++) { f.visit(`P${i}`); await f.advance(100); }
    assert.equal(f.residents().length, 13); assert.ok(f.scheduled.size <= 1);
    await f.advance(300000); assert.deepEqual(f.residents(), ['P11']);
    f.manager.dispose();
});
test('生成中、未确认保存和未完成编辑不开始计时，安全空闲后重新等待完整五分钟', async () => {
    const f = cacheFixture(['A', 'B', 'C', 'D']); f.busy.add('A'); f.busy.add('B'); f.busy.add('C');
    f.manager.request(); await f.advance(600000); assert.equal(f.preparations.length, 0);
    f.busy.delete('A'); f.manager.request(); await f.advance(299999); assert.equal(f.releases.length, 0);
    await f.advance(1); assert.deepEqual(f.residents(), ['B', 'C', 'D']);
    f.busy.delete('B'); f.manager.request(); await f.advance(150000);
    f.busy.add('B'); f.manager.request(); await f.advance(200000); assert.equal(f.releases.includes('B'), false);
    f.busy.delete('B'); f.manager.request(); await f.advance(299999); assert.equal(f.releases.includes('B'), false);
    await f.advance(1); assert.deepEqual(f.residents(), ['C', 'D']); f.manager.dispose();
});
test('慢保存不阻塞新产品访问，保存期间再次访问会使旧淘汰票据失效', async () => {
    const f = cacheFixture(), save = deferred(); let first = true;
    f.prepare(() => { if (first) { first = false; return save.promise; } return Promise.resolve(null); });
    f.manager.request(); await f.advance(300000);
    assert.deepEqual(f.preparations, ['A']);
    f.visit('A'); f.visit('C'); save.resolve(() => true); await settle(); await f.advance(0);
    assert.equal(f.releases.includes('A'), false); f.manager.dispose();
});
test('保存失败或未取得有效证明时保留画布，不假报释放或反复重试', async () => {
    const f = cacheFixture(); f.prepare(async id => { if (id === 'A') throw Error('磁盘失败'); return null; });
    f.manager.request(); await f.advance(300000);
    assert.deepEqual(f.residents(), ['A', 'B', 'C']); assert.deepEqual(f.releases, []);
    assert.deepEqual(f.preparations, ['A', 'B']); await f.advance(600000);
    assert.deepEqual(f.preparations, ['A', 'B']); f.manager.dispose();
});
test('准备期间自己的保存/状态通知不创建无限重试循环，失败后等新的外部变化', async () => {
    const f = cacheFixture();
    f.prepare(async () => { f.manager.request(); return null; });
    f.manager.request(); await f.advance(300000);
    assert.deepEqual(f.preparations, ['A', 'B']); assert.equal(f.scheduled.size, 0);
    f.manager.dispose();
});
test('快照稳定后重试可释放，活动产品从不参与淘汰且不会交错执行多轮prepare', async () => {
    const f = cacheFixture(), save = deferred(); let pending = false;
    f.prepare(async () => { assert.equal(pending, false); pending = true; await save.promise; pending = false; return () => true; });
    f.manager.request(); f.manager.request(); await f.advance(300000);
    assert.equal(f.preparations.length, 1); save.resolve(); await settle(); await f.advance(0);
    assert.deepEqual(f.releases, ['A', 'B']); assert.deepEqual(f.residents(), ['C']); f.manager.dispose();
});
test('排队的React淘汰更新再次校验，用户切回或组件卸载后旧更新不能删除当前实例', async () => {
    for (const action of ['visit', 'dispose']) {
        const f = cacheFixture(); f.delayRelease(); f.manager.request(); await f.advance(300000);
        assert.equal(f.delayed.length, 2);
        if (action === 'visit') f.visit('A'); else f.manager.dispose();
        f.delayed[0](); assert.equal(f.releases.length, 0);
        f.manager.dispose();
    }
});
test('保存结束后新编辑或新任务使释放证明失效', async () => {
    const f = cacheFixture(); let valid = true;
    f.prepare(async () => () => valid); f.delayRelease(); f.manager.request(); await f.advance(300000);
    valid = false; f.delayed[0](); assert.equal(f.releases.length, 0); f.manager.dispose();
});
test('离开前再次访问重置计时，准备期间短暂开始并结束的任务也会作废旧票据', async () => {
    const f = cacheFixture(['A', 'B']); f.manager.request(); await f.advance(299999);
    f.visit('A'); f.visit('B'); await f.advance(299999); assert.deepEqual(f.preparations, []);
    const saved = deferred(); f.prepare(() => saved.promise); await f.advance(1);
    assert.deepEqual(f.preparations, ['A']); f.activity('A'); saved.resolve(() => true); await settle();
    assert.equal(f.releases.length, 0); await f.advance(299999); assert.equal(f.preparations.length, 1);
    f.manager.dispose(); assert.equal(f.scheduled.size, 0);
});

test('驻留保护在第一个await前取得，嵌套任务全部完成才放行，异常也释放', async () => {
    const r = new ProductCanvasResidency(), work = deferred(); let idle = true;
    r.register('A', { idle: () => idle, prepare: async () => () => true });
    const first = r.run('A', () => work.promise); assert.equal(r.eligible('A'), false);
    const release = r.acquire('A'); work.resolve(); await first; assert.equal(r.eligible('A'), false);
    release(); release(); assert.equal(r.eligible('A'), true);
    await assert.rejects(r.run('A', async () => { throw Error('任务失败'); })); assert.equal(r.eligible('A'), true);
    idle = false; assert.equal(await r.prepare('A'), null);
});
test('准备期间任务仍运行或实例重挂载会阻止释放，已结束的无变更确认不永久固定画布', async () => {
    const r = new ProductCanvasResidency(), saving = deferred();
    const unregister = r.register('A', { idle: () => true, prepare: () => saving.promise });
    const proof = r.prepare('A'); const release = r.acquire('A'); saving.resolve(() => true);
    const first = await proof; assert.equal(first(), false); release(); assert.equal(first(), true);
    unregister(); const cleanup = r.register('A', { idle: () => true, prepare: async () => () => true });
    const valid = await r.prepare('A'); assert.equal(valid(), true); cleanup(); assert.equal(valid(), false);
});
test('旧画布切换保存保护可以与新产品操作并行，不锁定整个工作区', async () => {
    const r = new ProductCanvasResidency();
    for (const id of ['A', 'B']) r.register(id, { idle: () => true, prepare: async () => () => true });
    const release = r.acquire('A'); assert.equal(r.eligible('A'), false); assert.equal(r.eligible('B'), true); release();
    assert.equal(r.eligible('A'), true);
});

test('检查点必须等真实ACK才能释放，迟到编辑、卸载和手势状态会撤销证明', async () => {
    const requested = [], c = new ProductCommitCheckpoint(ticket => requested.push(ticket));
    c.mount(); c.commit(0, { saved: true }, true);
    const baseline = c.releaseProof(); assert.equal(baseline(), true);
    const changed = { edit: 1 }; c.commit(0, changed, true); assert.equal(baseline(), false);
    const disk = deferred(), flight = c.flush(() => disk.promise, { deferSQLiteFlush: true });
    c.commit(requested.at(-1), changed, true); await settle(); assert.equal(c.idle(), false);
    disk.resolve(); await flight; assert.equal(c.releaseProof()(), false);
    c.acknowledgeDeferredSave(); const valid = c.releaseProof(); assert.equal(valid(), true);
    c.commit(requested.at(-1), changed, false); assert.equal(valid(), false); c.unmount(); assert.equal(valid(), false);
});

function dormantFixture() {
    const records = new Map(), writes = [], reads = []; let failWrite = false;
    const saving = load('画布保存判定.ts');
    const dormant = load('画布休眠状态.ts', { './画布保存判定': saving, '../本机存储/上游浏览器存储桥': { sqliteForage: { createInstance: () => ({
        async setItem(key, value) { writes.push({ key, value }); if (failWrite) throw Error('休眠写入失败'); records.set(key, value); },
        async getItem(key) { reads.push(key); return records.get(key) ?? null; },
    }) } } });
    const node = { id: 'node', type: 'text', position: { x: 2, y: 3 }, metadata: { content: '正文', optional: undefined } };
    const deletedNodeBatches = [{ id: 'batch', nodes: [{ ...node, id: 'recycled' }], connections: [], relatedNodes: [node], deletedAt: '2026-11-07T00:00:00Z' }];
    const current = { nodes: [node], connections: [], deletedNodeBatches, chatSessions: [], activeChatId: null, backgroundMode: 'dots', showImageInfo: true };
    const value = { version: 1, projectRevision: 'revision', current, history: { past: [current], future: [current] },
        selectedNodeIds: ['node'], selectedConnectionId: null, canvasTool: 'select' };
    return { ...dormant, records, writes, reads, value, fail: () => { failWrite = true; } };
}
test('休眠记录使用Blob而不是常驻对象树，图序列化保持共享引用、undefined和完整撤销栈', async () => {
    const f = dormantFixture(); await f.saveDormantProduct('A', f.value);
    assert.ok(f.writes[0].value instanceof Blob);
    const restored = await f.readDormantProduct('A');
    assert.deepEqual(restored, f.value); assert.equal(restored.current, restored.history.past[0]);
    assert.equal(restored.history.future[0], restored.current);
    assert.equal(restored.current.deletedNodeBatches, restored.history.past[0].deletedNodeBatches);
    assert.equal(restored.current.deletedNodeBatches[0].relatedNodes[0], restored.current.nodes[0]);
    assert.ok(Object.hasOwn(restored.current.nodes[0].metadata, 'optional'));
    assert.equal(await f.readDormantProduct('B'), null);
});
test('休眠写入失败和坏记录明确报错，插件未知实例不静默丢字段', async () => {
    const f = dormantFixture(); f.fail(); await assert.rejects(f.saveDormantProduct('A', f.value), /写入失败/);
    assert.throws(() => f.packDormantProduct({ ...f.value, custom: new Date() }), /不可休眠/);
    f.records.set('product-dormant:v1:A', {}); await assert.rejects(f.readDormantProduct('A'), /类型异常/);
});
test('首次访问跳过其他页会话的旧休眠Blob，本页休眠后仍读取原历史且不常驻对象树', async () => {
    const f = dormantFixture();
    f.records.set('product-dormant:v1:A', new Blob(['旧会话的大记录']));
    assert.equal(await f.readDormantProduct('A'), null); assert.deepEqual(f.reads, []);
    await f.saveDormantProduct('A', f.value);
    assert.deepEqual(await f.readDormantProduct('A'), f.value);
    assert.deepEqual(f.reads, ['product-dormant:v1:A']);
});
test('同页休眠能恢复，新页面会话不复活旧Blob URL或旧撤销记录，外部编辑使旧历史失效', async () => {
    const f = dormantFixture(), blob = f.packDormantProduct(f.value);
    const otherPage = JSON.parse(await blob.text()); otherPage.pageSession = 'other-page';
    assert.equal(await f.unpackDormantProduct(new Blob([JSON.stringify(otherPage)])), null);
    assert.equal(f.matchingDormantProduct(f.value, f.value.current, 'revision'), f.value);
    assert.equal(f.matchingDormantProduct(f.value, f.value.current, 'changed'), null);
});

test('实际工作区按五分钟空闲释放，保留保存门禁和可清理订阅', () => {
    const workspace = readFileSync(resolve(root, '扩展功能/产品/产品工作区.tsx'), 'utf8');
    assert.match(workspace, /retainedProductCanvases/); assert.match(workspace, /createProductCanvasCache/);
    assert.match(workspace, /productCanvasResidency\.prepare/); assert.match(workspace, /manager\.dispose\(\)/);
    assert.match(workspace, /PRODUCT_CANVAS_IDLE_TIMEOUT_MS/); assert.doesNotMatch(workspace, /PRODUCT_CANVAS_CACHE_LIMIT/);
    assert.doesNotMatch(workspace, /previous\.includes\(activeId\) \? previous : \[\.\.\.previous, activeId\]/);
});
