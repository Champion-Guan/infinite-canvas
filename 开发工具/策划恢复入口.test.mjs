import test from 'node:test';
import assert from 'node:assert/strict';
import { variantModules } from './产品变体生成夹具.mjs';

const task = { taskId: 'original-task', slotId: 'product-image-plan', binding: 'old-binding', requestHash: 'old-hash' };
const node = metadata => ({ id: 'parameter', metadata });
const recovery = variantModules().load('Excel画布/商品策划恢复入口.ts');
const copies = variantModules().load('Excel画布/商品策划副本规则.ts');
test('旧副本缺少任务ID的孤立保存标记可修复，原卡、同卡新任务及未知缺失任务仍保留恢复保护', () => {
    const original=node({productPlanningPendingCommit:task});
    assert.equal(copies.inheritedProductPlanningPatch(original,'product'),undefined);
    const copy=node({...original.metadata,generationNotificationCopy:true,productBrief:{nameCategory:'新商品'}});
    const patch=copies.inheritedProductPlanningPatch(copy,'product');
    assert.ok(patch);assert.equal(recovery.productPlanningRecovery({...copy,metadata:{...copy.metadata,...patch}}),undefined);
    assert.equal(original.metadata.productPlanningPendingCommit.taskId,task.taskId);
    const owned=node({generationNotificationCopy:true,gatewayGenerationTasks:[task],
        productPlanningTaskOwner:{productId:'product',nodeId:'parameter',taskId:task.taskId}});
    assert.equal(copies.inheritedProductPlanningPatch(owned,'product'),undefined);
    assert.equal(copies.inheritedProductPlanningPatch(node({generationNotificationCopy:true,
        productPlanningTask:{id:'new-planning',status:'loading'}}),'product'),undefined,
        '副本开始新策划但尚未登记任务时，不能把新运行状态误清理');
    assert.equal(copies.inheritedProductPlanningPatch(node({generationNotificationCopy:true,gatewayGenerationTasks:[task]}),'product'),undefined,
        '没有归属证据时，查不到任务也不自动重提');
    const foreign={...owned,id:'copied-parameter'};
    const detached=copies.inheritedProductPlanningPatch(foreign,'product');
    assert.equal(detached.gatewayGenerationTasks,undefined);
    assert.equal(recovery.productPlanningRecovery({...foreign,metadata:{...foreign.metadata,...detached}}),undefined);
});
test('重新打开卡片即可区分继续保存、查询原任务、继续修正和已确认完成', () => {
    assert.equal(recovery.productPlanningRecovery(node({})), undefined);
    assert.equal(recovery.productPlanningRecovery(node({ productPlanningPendingCommit: task })).label, '继续保存');
    assert.equal(recovery.productPlanningRecovery(node({ gatewayGenerationTasks: [task] })).label, '查询原任务');
    const metadata = { gatewayGenerationTasks: [task], gatewayGenerationReceipts: [{ taskId: task.taskId }], productImagePlan: { imageCount: 1 } };
    assert.equal(recovery.productPlanningRecovery(node(metadata)).label, '继续保存');
    assert.equal(recovery.productPlanningRecovery(node({ ...metadata, productPlanningCandidate: { taskId: task.taskId } })).label, '继续修正');
    assert.equal(recovery.productPlanningRecovery(node({ ...metadata, productPlanningResolution: { taskId: task.taskId, status: 'succeeded' } })), undefined);
    assert.match(recovery.productPlanningRecoveryError(Object.assign(Error('本机请求未完成'), { code: 'generation_canvas_unsaved' }), 'save'), /卡片已生成.*自动保存.*重试保存/);
    assert.match(recovery.productPlanningRecoveryError(Object.assign(Error('disconnected'), { code: 'generation_connection_unknown' }), 'query'), /查询原任务.*不会重复提交/);
    assert.match(recovery.productPlanningRecoveryError(Object.assign(Error('未找到'),{code:'generation_not_found'}),'query'),/复制此参数卡为独立新卡.*原卡任务记录保留/);
    assert.equal(recovery.productPlanningRecoveryError(Error('原任务与收据不匹配'), 'save'), '原任务与收据不匹配');
    assert.match(recovery.productPlanningRecoveryError(Object.assign(Error('模型原始错误'), { code: 'product_plan_repair_incomplete' }), 'repair'),
        /图片编号或待确认条件.*继续修正.*不会重做整套策划/);
});
test('真实策划按钮将恢复入口绑定仅恢复意图，普通策划与继续修正分别明确执行', async () => {
    const jsx = (type, props) => ({ type, props }), calls = [];
    let automatic;
    const ui = variantModules({
        react: { useState: value => [value, () => {}], useRef: current => ({ current }), useEffect() {} },
        'react/jsx-runtime': { jsx, jsxs: jsx },
        'lucide-react': { LoaderCircle: 'Spinner', Sparkles: 'Sparkles', RotateCcw: 'Retry', X: 'X' },
        './商品提示词画布': {}, '../主题/苹果交互按钮': { AppleActionButton: 'Button' },
        '../主题/任务阶段反馈': { TextTaskStatus: 'Status' }, './商品待确认编辑': {},
        './商品策划流式预览': { useProductPlanningText: () => '' }, './图片引用标签': {},
        './商品策划请求': { planProductImages: async (...args) => calls.push(args) },
        './策划自动保存': { useAutomaticPlanningSave: options => { automatic = options; }, retryPlanningSave: () => false },
    }).load('Excel画布/商品策划按钮.tsx');
    const cases = [
        [{}, 'AI写提示词', false, false],
        [{ gatewayGenerationTasks: [task] }, '查询原任务', true, false],
        [{ productPlanningPendingCommit: task }, '重试保存', true, false],
        [{ gatewayGenerationTasks: [task], productPlanningCandidate: { taskId: task.taskId } }, '继续修正', false, true],
        [{ gatewayGenerationTasks: [task], productPlanningResolution: { taskId: task.taskId, status: 'succeeded' } }, '重新策划', false, false],
        [{generationNotificationCopy:true,productPlanningPendingCommit:task},'AI写提示词',false,false],
        [{gatewayGenerationTasks:[task],productPlanningTaskOwner:{nodeId:'old-parameter',productId:'product',taskId:task.taskId}},'AI写提示词',false,false],
    ];
    for (const [metadata, label, recoverOnly, repairOnly] of cases) {
        const ctx = { node: node(metadata), getNode: () => ctx.node }, tree = ui.ProductPlanningButton({ ctx, productId: 'product' });
        const button = tree.props.children[0];
        assert.equal(button.props['aria-label'], label);
        if (label === '重试保存') {
            assert.equal(automatic.identity, 'product:parameter:original-task');
            await automatic.start();
        } else {
            assert.equal(automatic.identity, '');
            button.props.onClick();
        }
        await new Promise(done => setImmediate(done));
        assert.deepEqual(calls.at(-1)[4], { recoverOnly, repairOnly });
        assert.equal(calls.at(-1)[0], ctx);
    }
});
