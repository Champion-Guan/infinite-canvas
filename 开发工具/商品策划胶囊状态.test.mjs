import test from 'node:test';
import assert from 'node:assert/strict';
import { variantModules } from './产品变体生成夹具.mjs';
import { canvasTaskSummary } from '../扩展功能/产品/产品任务摘要.js';
import { readCanvasCapsuleStatus } from '../扩展功能/产品/旧版产品胶囊状态.js';

const { runProductPlanningTask } = variantModules().load('Excel画布/商品策划任务状态.ts');
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function fixture() {
    let nodes = [{ id: 'parameter', type: 'guan:prompt-variables', metadata: { status: 'success' } }];
    const values = new Map(), storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
    const ctx = { node: nodes[0], getNode: id => nodes.find(node => node.id === id),
        updateMetadata: patch => { nodes = nodes.map(node => node.id === 'parameter' ? { ...node, metadata: { ...node.metadata, ...patch } } : node); } };
    return { ctx, controller: new AbortController(), node: () => nodes[0],
        status(clear = false) {
            values.set('guan-canvas-status:p', JSON.stringify(canvasTaskSummary(nodes, [], true)));
            return readCanvasCapsuleStatus('p', true, storage, true, clear);
        }, nodes: () => structuredClone(nodes), remove() { nodes = []; } };
}
test('策划准备、请求、协议修正及保存阶段都为黄色，工作流完成后才变绿且可点击清空', async () => {
    const f = fixture(), pending = deferred();
    assert.equal(f.status(), 'idle');
    const job = runProductPlanningTask(f.ctx, f.controller.signal, async () => {
        assert.equal(f.status(), 'loading');
        await pending.promise;
        assert.equal(f.status(), 'loading', '请求回执不是整个策划完成');
        return 'saved';
    });
    assert.equal(f.status(), 'loading');
    assert.equal(f.status(true), 'loading', '点击运行中胶囊不会取消策划');
    pending.resolve(); assert.equal(await job, 'saved');
    assert.equal(f.status(), 'success');
    assert.equal(f.status(true), 'idle');
    assert.equal(f.status(), 'idle');
    f.ctx.updateMetadata({ productImagePlan: { imageCount: 17 }, gatewayGenerationTasks: [{ taskId: 'old', slotId: 'product-image-plan' }] });
    assert.equal(f.status(), 'idle', '元数据及旧模型任务变化不重新点亮已读结果');
});
test('策划失败及保存失败变红，新任务完成仍会提醒，普通参数卡不会因旧就绪状态变绿', async () => {
    const f = fixture();
    assert.equal(f.status(), 'idle');
    await assert.rejects(runProductPlanningTask(f.ctx, f.controller.signal, async () => { throw Error('保存尚未确认'); }), /保存尚未确认/);
    assert.equal(f.status(), 'error');
    f.status(true); assert.equal(f.status(), 'idle');
    const oldId = f.node().metadata.productPlanningTask.id;
    await runProductPlanningTask(f.ctx, f.controller.signal, async () => {});
    assert.notEqual(f.node().metadata.productPlanningTask.id, oldId);
    assert.equal(f.status(), 'success');
});
test('取消等待立即结束黄色，不把迟到结果当成功；旧任务收尾不覆盖同卡新任务', async () => {
    const f = fixture(), pending = deferred();
    const old = runProductPlanningTask(f.ctx, f.controller.signal, () => pending.promise);
    f.controller.abort(); assert.equal(f.status(), 'idle');
    const currentController = new AbortController();
    await runProductPlanningTask(f.ctx, currentController.signal, async () => {});
    const current = structuredClone(f.node().metadata.productPlanningTask);
    pending.resolve();
    await assert.rejects(old, error => error.name === 'AbortError');
    assert.deepEqual(f.node().metadata.productPlanningTask, current);
    assert.equal(f.status(), 'success');
});
test('删除参数卡后迟到状态不回写；持久快照保持任务事件身份且不纳入图片重试', async () => {
    const f = fixture(), pending = deferred();
    const job = runProductPlanningTask(f.ctx, f.controller.signal, () => pending.promise);
    f.remove(); pending.resolve(); await job;
    assert.deepEqual(f.nodes(), []);
    const g = fixture(); await runProductPlanningTask(g.ctx, g.controller.signal, async () => {});
    const copy = JSON.parse(JSON.stringify(g.nodes()));
    assert.deepEqual(canvasTaskSummary(copy, [], true), canvasTaskSummary(g.nodes(), [], true));
});

test('新策划状态绑定产品和参数卡，同ID跨画布及复制卡不点亮原产品胶囊', async () => {
    const f = fixture();
    await assert.rejects(runProductPlanningTask(f.ctx, f.controller.signal, async () => { throw Error('模拟请求拒绝'); }, 'product-11'));
    const nodes = f.nodes();
    assert.equal(nodes[0].metadata.productPlanningTask.productId, 'product-11');
    assert.equal(nodes[0].metadata.productPlanningTask.nodeId, 'parameter');
    assert.equal(canvasTaskSummary(nodes, [], true, 'product-11').status, 'error');
    assert.equal(canvasTaskSummary(nodes, [], true, 'original-product').status, 'idle');
    const copied = structuredClone(nodes);
    copied[0].id = 'copy-parameter';
    assert.equal(canvasTaskSummary(copied, [], true, 'product-11').status, 'idle');
    const rules = variantModules().load('Excel画布/商品策划副本规则.ts');
    assert.ok(rules.inheritedProductPlanningPatch(nodes[0], 'original-product'));
    assert.ok(rules.inheritedProductPlanningPatch(copied[0], 'product-11'));
    assert.equal(rules.inheritedProductPlanningPatch(nodes[0], 'product-11'), undefined);
});

test('兼容旧策划记录时也核对保存的任务归属，不将外来失败加入胶囊事件', () => {
    const node = { id: 'parameter', type: 'guan:prompt-variables', metadata: {
        status: 'success', productPlanningTask: { id: 'old-ui-task', startedAt: 100, status: 'error' },
        productPlanningTaskOwner: { productId: 'product-11', nodeId: 'parameter', taskId: 'gateway-task' },
    } };
    assert.equal(canvasTaskSummary([node], [], true, 'product-11').status, 'error');
    assert.deepEqual(canvasTaskSummary([node], [], true, 'original-product').events, []);
    assert.equal(canvasTaskSummary([node], [], true, 'original-product').status, 'idle');
});
