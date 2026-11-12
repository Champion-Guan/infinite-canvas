import test from 'node:test';
import assert from 'node:assert/strict';
import { variantModules } from './产品变体生成夹具.mjs';

const task = { taskId: 'original-task', slotId: 'product-image-plan', binding: 'old-binding', requestHash: 'old-hash' };
const node = metadata => ({ id: 'parameter', metadata });
const recovery = variantModules().load('Excel画布/商品策划恢复入口.ts');
test('重新打开卡片即可区分继续保存、查询原任务、继续修正和已确认完成', () => {
    assert.equal(recovery.productPlanningRecovery(node({})), undefined);
    assert.equal(recovery.productPlanningRecovery(node({ productPlanningPendingCommit: task })).label, '继续保存');
    assert.equal(recovery.productPlanningRecovery(node({ gatewayGenerationTasks: [task] })).label, '查询原任务');
    const metadata = { gatewayGenerationTasks: [task], gatewayGenerationReceipts: [{ taskId: task.taskId }], productImagePlan: { imageCount: 1 } };
    assert.equal(recovery.productPlanningRecovery(node(metadata)).label, '继续保存');
    assert.equal(recovery.productPlanningRecovery(node({ ...metadata, productPlanningCandidate: { taskId: task.taskId } })).label, '继续修正');
    assert.equal(recovery.productPlanningRecovery(node({ ...metadata, productPlanningResolution: { taskId: task.taskId, status: 'succeeded' } })), undefined);
    assert.match(recovery.productPlanningRecoveryError(Object.assign(Error('本机请求未完成'), { code: 'generation_canvas_unsaved' }), 'save'), /卡片已生成.*继续保存/);
    assert.match(recovery.productPlanningRecoveryError(Object.assign(Error('disconnected'), { code: 'generation_connection_unknown' }), 'query'), /查询原任务.*不会重复提交/);
    assert.equal(recovery.productPlanningRecoveryError(Error('原任务与收据不匹配'), 'save'), '原任务与收据不匹配');
    assert.match(recovery.productPlanningRecoveryError(Object.assign(Error('模型原始错误'), { code: 'product_plan_repair_incomplete' }), 'repair'),
        /图片编号或待确认条件.*继续修正.*不会重做整套策划/);
});
test('真实策划按钮将恢复入口绑定仅恢复意图，普通策划与继续修正分别明确执行', async () => {
    const jsx = (type, props) => ({ type, props }), calls = [];
    const ui = variantModules({
        react: { useState: value => [value, () => {}], useRef: current => ({ current }), useEffect() {} },
        'react/jsx-runtime': { jsx, jsxs: jsx },
        'lucide-react': { LoaderCircle: 'Spinner', Sparkles: 'Sparkles', RotateCcw: 'Retry', X: 'X' },
        './商品提示词画布': {}, '../主题/苹果交互按钮': { AppleActionButton: 'Button' },
        '../主题/任务阶段反馈': { TextTaskStatus: 'Status' }, './商品待确认编辑': {},
        './商品策划流式预览': { useProductPlanningText: () => '' }, './图片引用标签': {},
        './商品策划请求': { planProductImages: async (...args) => calls.push(args) },
    }).load('Excel画布/商品策划按钮.tsx');
    const cases = [
        [{}, 'AI写提示词', false, false],
        [{ gatewayGenerationTasks: [task] }, '查询原任务', true, false],
        [{ productPlanningPendingCommit: task }, '继续保存', true, false],
        [{ gatewayGenerationTasks: [task], productPlanningCandidate: { taskId: task.taskId } }, '继续修正', false, true],
        [{ gatewayGenerationTasks: [task], productPlanningResolution: { taskId: task.taskId, status: 'succeeded' } }, '重新策划', false, false],
    ];
    for (const [metadata, label, recoverOnly, repairOnly] of cases) {
        const ctx = { node: node(metadata) }, tree = ui.ProductPlanningButton({ ctx, productId: 'product' });
        const button = tree.props.children[0];
        assert.equal(button.props['aria-label'], label);
        await button.props.onClick();
        assert.deepEqual(calls.at(-1)[4], { recoverOnly, repairOnly });
        assert.equal(calls.at(-1)[0], ctx);
    }
});
