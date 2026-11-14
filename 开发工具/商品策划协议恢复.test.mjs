import assert from 'node:assert/strict';
import test from 'node:test';
import { variantFixture, variantModules } from './产品变体生成夹具.mjs';

const confirmation = { id: 'brakes', label: '是否带刹车', question: '销售款是否带刹车？',
    kind: 'choice', unit: '', scope: 'shared', scopes: [], imageKeys: ['detail'], fallback: '未知时只展示可见脚轮。' };
const body = { chinese: '完整展示实物商品，保留白色外观、三层结构和参考图可见脚轮。', english: 'Show the complete actual product, preserving its white appearance, three-tier structure, and the casters visible in the reference.' };
const design = { chinese: '深棕异形大标题底板搭配米白文字、浴室图标及手绘放射短线。', english: 'Use a large irregular dark-brown heading panel with cream lettering, a bathroom icon, and short hand-drawn radiating strokes.' };
const conditions = [{ factId: 'brakes',
    unknown: { chinese: '只展示实拍可见脚轮，不宣称有刹车。', english: 'Show only the casters visible in the reference photograph without claiming brakes are present.' },
    yes: { chinese: '展示已确认带刹车的实拍脚轮。', english: 'Show the confirmed caster with brakes from the reference photograph.' },
    no: { chinese: '展示无刹车脚轮，不补造拨片。', english: 'Show the caster without brakes and do not invent a lever.' } }];
function planData() {
    return {
        protocolVersion: 'product-image-plan.v2',
        overview: { buyers: '买家', sellingPoints: '真实结构', concerns: '脚轮配置', consistency: '按实物', sequence: '先整体后细节' },
        style: '真实摄影与趣味设计', assumptions: [], pendingFacts: [], confirmations: [structuredClone(confirmation)],
        images: ['main', 'detail'].map((key, index) => ({
            key, kind: index ? 'carousel' : 'main', name: index ? '脚轮细节' : '主视觉',
            buyerQuestion: '实际商品如何？', evidence: '用户提供的产品照片', composition: '完整实物与自然柔光',
            constraints: '保留销售款结构与数量', copyLayout: '旧版说明不能覆盖设计片段', checks: '核对商品、文案及导出规格',
            delivery: { width: 1800, height: 2400, format: 'png', maxMB: 10 },
            prompt: { segments: [{ ...body, ...(index ? {
                chinese: `${body.chinese}{{fact:brakes}}`, english: `${body.english} {{fact:brakes}}`,
            } : {}) }], designSegments: [structuredClone(design)], conditions: index ? structuredClone(conditions) : [] },
            variants: {}, confirmationImageIds: [],
        })),
    };
}
function badPlan() {
    const result = planData();
    result.images[1].prompt.segments = [structuredClone(body)];
    result.images[1].prompt.conditions = [{ factId: 'brakes', unknown: structuredClone(conditions[0].unknown),
        known: { chinese: '根据{{fact:brakes}}确认答案显示拨片。', english: 'Show the lever based on the confirmed answer {{fact:brakes}}.' } }];
    return result;
}
function fixture(responses, hooks = {}) {
    const base = variantFixture();
    Object.assign(base.parameter.metadata, { productPlatform: '未指定', productVariants: undefined, productSharedImageIds: undefined,
        productImagePlan: { pendingFacts: [], confirmations: [structuredClone(confirmation)] } });
    let sequence = 0, responseIndex = 0, taskSequence = 0, f;
    const events = [], requests = [], snapshots = [], operations = [], notices = [], noticeScopes = [], phases = [], confirmed = [];
    const loader = variantModules({
        nanoid: { nanoid: () => `new-${++sequence}` },
        '@/stores/use-config-store': { useConfigStore: { getState: () => ({
            config: { imageModel: 'synthetic-image', model: 'synthetic-text' }, isAiConfigReady: () => true,
        }) } },
        '@/lib/canvas/canvas-generation-helpers': { buildGenerationConfig: config => ({ ...config, model: 'synthetic-text' }) },
        './商品策划完成通知': { notifyProductPlanning: (_productId, _parameterId, completed, configNodeIds) => {
            events.push(completed ? 'notice-complete' : 'notice-start'); notices.push(completed);
            if (completed) noticeScopes.push(configNodeIds ? [...configNodeIds] : []);
        } },
        '../产品/产品操作': { saveProductCanvas: async () => {
            const count = snapshots.length + 1;
            events.push(`save-${count}-start`);
            const persisted = await hooks.save?.(count, f) ?? true;
            snapshots.push({ persisted, nodes: structuredClone(f.nodes) });
            events.push(`save-${count}-${persisted ? 'ack' : 'failed'}`);
            return { persisted };
        } },
        '../画布生成/原画布文本调用': { queryCanvasTextTask: async (scope, task, signal) => {
            signal.throwIfAborted(); events.push(`query-${task.taskId}`);
            return await hooks.query?.(scope, task, f) ?? { state: 'succeeded' };
        }, retireMissingCanvasText: async (scope, task, signal) => {
            signal.throwIfAborted(); events.push(`retire-${task.taskId}`);
            await hooks.retire?.(scope, task, f);
        }, confirmSavedCanvasText: async (scope, receipt, signal) => {
            signal.throwIfAborted();
            assert.equal(f.snapshots.at(-1).persisted, true, '确认原任务前必须先收到保存ACK');
            events.push(`confirm-${receipt.taskId}`);
            confirmed.push({ scope, receipt: structuredClone(receipt) });
            await hooks.confirm?.(scope, receipt, f);
            signal.throwIfAborted();
        }, requestCanvasText: async request => {
            const index = requests.length;
            requests.push(request); events.push(`request-${request.scope.slotId}`);
            await hooks.beforeRequest?.(index, request, f);
            if (request.retry === false && !request.recoverOnly) {
                assert.ok(request.previous?.taskId, '恢复旧任务不能新建任务身份');
                const recovered = await hooks.recover?.(request, f) ?? '旧资料的返回内容不得应用到新资料';
                await request.applyAndSave(recovered, { taskId: request.previous.taskId, responseHash: 'synthetic-old-result-hash' });
                return recovered;
            }
            taskSequence = Math.max(taskSequence, ...(f.parameter.metadata.gatewayGenerationTasks || [])
                .map(task => Number(task.taskId.match(/^task-(\d+)$/)?.[1]) || 0));
            const taskId = request.recoverOnly ? request.previous.taskId : `task-${++taskSequence}`;
            if (!request.recoverOnly) await request.recordTask({ slotId: request.scope.slotId, taskId });
            await hooks.beforeApply?.(index, request, f);
            const response = responses[responseIndex++];
            assert.ok(response, '不得额外发送未预期的模型请求');
            await request.applyAndSave(typeof response === 'string' ? response : JSON.stringify(response),
                { taskId, responseHash: `synthetic-result-hash-${taskId}` });
            return typeof response === 'string' ? response : JSON.stringify(response);
        } },
    });
    const rules = loader.load('Excel画布/商品提示词规则.ts');
    const seed = rules.parseProductImagePlan(JSON.stringify(planData()), []);
    const prompts = seed.images.map((image, index) => ({
        id: `prompt-${index}`, type: 'guan:product-prompt', title: image.name,
        position: { x: 500, y: index * 600 }, width: 440, height: 540,
        metadata: { status: 'success', productImagePrompt: { ...image, parameterId: base.parameter.id, generatedSignature: 'old' } },
    }));
    const configs = prompts.map(prompt => ({ id: `config-${prompt.id}`, type: 'config', title: `${prompt.title} · 生图`,
        metadata: { productPromptConfigKey: prompt.id, model: 'chosen-image-model', count: 1 } }));
    const nodes = [base.parameter, ...prompts, ...configs], connections = prompts.flatMap((prompt, index) => [
        { id: `parameter-edge-${index}`, fromNodeId: base.parameter.id, toNodeId: prompt.id },
        { id: `config-edge-${index}`, fromNodeId: prompt.id, toNodeId: configs[index].id },
    ]);
    const ctx = {
        node: base.parameter, getNode: id => nodes.find(node => node.id === id), getNodes: () => nodes, getConnections: () => connections,
        updateMetadata: patch => { base.parameter.metadata = { ...base.parameter.metadata, ...patch }; },
        applyOps: ops => {
            operations.push(structuredClone(ops)); events.push('apply-ops');
            for (const op of ops) {
                if (op.type === 'update_node') {
                    const node = nodes.find(node => node.id === op.id);
                    Object.assign(node, op.patch || {}); node.metadata = { ...node.metadata, ...op.metadata };
                }
                if (op.type === 'add_node') nodes.push({ id: op.id, type: op.nodeType, title: op.title, position: op.position,
                    width: op.width, height: op.height, metadata: op.metadata });
                if (op.type === 'connect_nodes' && !connections.some(edge => edge.fromNodeId === op.fromNodeId && edge.toNodeId === op.toNodeId))
                    connections.push({ id: `new-edge-${connections.length}`, fromNodeId: op.fromNodeId, toNodeId: op.toNodeId });
            }
        },
    };
    const controller = new AbortController();
    f = { loader, rules, parameter: base.parameter, nodes, prompts, configs, connections, ctx, controller,
        events, requests, snapshots, operations, notices, noticeScopes, phases, confirmed,
        run: (options = {}) => loader.load('Excel画布/商品策划请求.ts').planProductImages(ctx, 'product', controller.signal, phase => phases.push(phase), options) };
    return f;
}

test('首次候选ACK落盘后只修复一次，成功仅一次applyOps并在最终保存ACK后通知', async () => {
    const f = fixture([badPlan(), planData()], {
        beforeRequest(index, request, current) {
            assert.equal(current.parameter.metadata.productPlanningTask.status, 'loading', '完整策划及协议修正共用运行中状态');
            if (!index) return;
            assert.equal(index, 1);
            assert.equal(request.scope.slotId, 'product-image-plan-repair');
            assert.equal(current.snapshots.at(-1).persisted, true);
            const saved = current.snapshots.at(-1).nodes.find(node => node.id === current.parameter.id).metadata.productPlanningCandidate;
            assert.equal(saved.response, JSON.stringify(badPlan()));
            assert.ok(saved.issues.some(issue => issue.problem === 'missing_choice_branch'));
        },
    });
    await f.run();
    assert.deepEqual(f.requests.map(request => request.scope.slotId), ['product-image-plan', 'product-image-plan-repair']);
    assert.equal(f.operations.length, 1);
    assert.equal(f.parameter.metadata.productPlanningCandidate, undefined);
    assert.equal(f.snapshots.length, 5, '成功后单独保存清除待提交标记');
    assert.ok(f.events.indexOf('notice-complete') > f.events.indexOf('save-5-ack'));
    assert.equal(f.parameter.metadata.productPlanningPendingCommit, undefined);
    assert.deepEqual(f.notices, [false, true]);
    assert.equal(f.phases.at(-1), 'ready');
    assert.equal(f.parameter.metadata.productPlanningTask.status, 'success');
    assert.match(f.prompts[0].metadata.productImagePrompt.prompt.english, /bathroom icon.*hand-drawn radiating/);
    assert.equal(f.configs[0].metadata.model, 'chosen-image-model');
});

test('修复仍错保留原卡，下一次显式重试只发送repair，不重新发送全套策划', async () => {
    const f = fixture([badPlan(), badPlan(), planData()]);
    const prompts = structuredClone(f.prompts), connections = structuredClone(f.connections);
    await assert.rejects(f.run(), /修正后仍未通过检查/);
    assert.equal(f.operations.length, 0);
    assert.deepEqual(f.prompts, prompts); assert.deepEqual(f.connections, connections);
    assert.equal(f.requests.length, 2);
    assert.ok(f.parameter.metadata.productPlanningCandidate);
    assert.equal(f.notices.includes(true), false);
    await f.run();
    assert.deepEqual(f.requests.map(request => request.scope.slotId),
        ['product-image-plan', 'product-image-plan-repair', 'product-image-plan-repair']);
    assert.equal(f.operations.length, 1);
    assert.equal(f.parameter.metadata.productPlanningCandidate, undefined);
    assert.equal(f.notices.filter(Boolean).length, 1);
});

test('客户两类报错合并复现：重复编号与缺失条件保留候选，继续只修正已有方案', async () => {
    const duplicate = badPlan();
    duplicate.images[0].key = 'detail';
    const fixedKeys = badPlan();
    fixedKeys.images[0].key = 'sales-main';
    const corrected = planData();
    corrected.images[0].key = 'sales-main';
    const f = fixture([duplicate, fixedKeys, corrected]);
    const original = structuredClone(f.prompts);
    await assert.rejects(f.run(), /修正后仍未通过检查/);
    assert.deepEqual(f.requests.map(request => request.scope.slotId), ['product-image-plan', 'product-image-plan-repair']);
    assert.equal(f.operations.length, 0);
    assert.deepEqual(f.prompts, original);
    assert.equal(f.loader.load('Excel画布/商品策划恢复入口.ts').productPlanningRecovery(f.parameter).label, '继续修正');
    assert.ok(f.parameter.metadata.productPlanningCandidate.issues.some(issue => issue.problem === 'missing_choice_branch'));
    await f.run({ repairOnly: true });
    assert.deepEqual(f.requests.map(request => request.scope.slotId),
        ['product-image-plan', 'product-image-plan-repair', 'product-image-plan-repair']);
    assert.equal(f.operations.length, 1);
    assert.equal(f.parameter.metadata.productPlanningCandidate, undefined);
    assert.deepEqual(f.prompts.map(node => node.title), original.map(node => node.title));
    assert.equal(f.notices.filter(Boolean).length, 1);
});

test('带重复编号和条件错误的候选刷新恢复后只修正，取消或手改仍不覆盖原卡', async () => {
    const duplicate = badPlan(); duplicate.images[0].key = 'detail';
    const first = fixture([duplicate, duplicate]);
    await assert.rejects(first.run(), /修正后仍未通过检查/);
    const metadata = structuredClone(first.snapshots.at(-1).nodes.find(node => node.id === 'parameter').metadata);
    const corrected = planData(); corrected.images[0].key = 'main-repaired';
    const restored = fixture([corrected]);
    restored.parameter.metadata = metadata;
    await restored.run({ repairOnly: true });
    assert.deepEqual(restored.requests.map(request => request.scope.slotId), ['product-image-plan-repair']);
    assert.equal(restored.operations.length, 1);
    assert.equal(restored.parameter.metadata.productPlanningCandidate, undefined);
    for (const mode of ['cancel', 'edit']) {
        const blocked = fixture([corrected], { beforeApply(_index, _request, f) {
            if (mode === 'cancel') f.controller.abort();
            else f.prompts[0].metadata.productImagePrompt.prompt.chinese += '用户最新编辑';
        } });
        blocked.parameter.metadata = structuredClone(metadata);
        await assert.rejects(blocked.run({ repairOnly: true }), mode === 'cancel' ? { name: 'AbortError' } : /商品资料或参考图已更改/);
        assert.equal(blocked.operations.length, 0);
        assert.deepEqual(blocked.requests.map(request => request.scope.slotId), ['product-image-plan-repair']);
        assert.ok(blocked.parameter.metadata.productPlanningCandidate);
    }
});

test('候选保存失败或repair任务保存失败阻止后续请求及改卡', async () => {
    for (const failAt of [2, 3]) {
        const f = fixture([badPlan(), planData()], { save: count => count !== failAt });
        const prompts = structuredClone(f.prompts);
        await assert.rejects(f.run(), /保存尚未确认/);
        assert.equal(f.requests.length, failAt === 2 ? 1 : 2);
        assert.equal(f.operations.length, 0);
        assert.deepEqual(f.prompts, prompts);
        assert.equal(f.notices.includes(true), false);
    }
});

test('候选ACK后取消、商品资料改变或提示词手改均阻止自动repair，保留用户新编辑', async () => {
    for (const change of ['cancel', 'facts', 'prompt']) {
        const f = fixture([badPlan(), planData()], { save(count, current) {
            if (count === 2) {
                if (change === 'cancel') current.controller.abort();
                if (change === 'facts') current.parameter.metadata.productBrief.material = '用户改材质';
                if (change === 'prompt') current.prompts[0].metadata.productImagePrompt.prompt.chinese += '用户新编辑';
            }
            return true;
        } });
        await assert.rejects(f.run(), change === 'cancel' ? { name: 'AbortError' } : /商品资料或参考图已更改/);
        assert.equal(f.requests.length, 1);
        assert.equal(f.operations.length, 0);
        assert.equal(f.notices.includes(true), false);
        if (change === 'prompt') assert.match(f.prompts[0].metadata.productImagePrompt.prompt.chinese, /用户新编辑$/);
    }
});

test('repair在途取消或资料、提示词变更阻止应用迟到结果', async () => {
    for (const change of ['cancel', 'facts', 'prompt']) {
        const f = fixture([badPlan(), planData()], { beforeApply(index, _request, current) {
            if (index !== 1) return;
            if (change === 'cancel') current.controller.abort();
            if (change === 'facts') current.parameter.metadata.productBrief.colorModel = '用户改颜色';
            if (change === 'prompt') current.prompts[0].metadata.productImagePrompt.prompt.english += ' User edit.';
        } });
        await assert.rejects(f.run(), change === 'cancel' ? { name: 'AbortError' } : /商品资料或参考图已更改/);
        assert.equal(f.requests.length, 2);
        assert.equal(f.operations.length, 0);
        assert.equal(f.notices.includes(true), false);
        assert.ok(f.parameter.metadata.productPlanningCandidate);
        if (change === 'prompt') assert.match(f.prompts[0].metadata.productImagePrompt.prompt.english, /User edit\.$/);
    }
});

test('repair不得改变用途key、交付尺寸、顺序、数量或名称', async () => {
    for (const change of [
        plan => { plan.images[0].key = 'another'; },
        plan => { plan.images[0].delivery.width = 2048; },
        plan => { plan.images.reverse(); },
        plan => { plan.images.pop(); plan.confirmations = []; },
        plan => { plan.images[0].name = '另一用途'; },
    ]) {
        const repaired = planData(); change(repaired);
        const f = fixture([badPlan(), repaired]);
        await assert.rejects(f.run(), /修正后仍未通过检查/);
        assert.equal(f.operations.length, 0);
        assert.ok(f.parameter.metadata.productPlanningCandidate.issues.some(issue =>
            issue.problem === 'repair_changed_image_identity' || issue.problem === 'confirmation_definition_changed'));
    }
});

test('普通产品照片误填confirmationImageIds可归类，未知照片仍拒绝修复结果', async () => {
    const ordinary = planData(); ordinary.images[0].confirmationImageIds = ['red', 'shared'];
    const f = fixture([ordinary]);
    await f.run();
    assert.deepEqual(f.prompts[0].metadata.productImagePrompt.confirmationImageIds, []);
    assert.equal(f.requests.length, 1);
    const unknown = planData(); unknown.images[0].confirmationImageIds = ['not-an-uploaded-photo'];
    const rejected = fixture([unknown, unknown]);
    await assert.rejects(rejected.run(), /修正后仍未通过检查/);
    assert.equal(rejected.operations.length, 0);
    assert.ok(rejected.parameter.metadata.productPlanningCandidate.issues.some(issue => issue.problem === 'unavailable_confirmation_image'));
});

test('最终结果ACK失败或清标记ACK失败后只补保存并确认原任务，不重发模型或重做applyOps', async () => {
    for (const failAt of [2, 3]) {
        const f = fixture([planData()], { save: count => count !== failAt });
        await assert.rejects(f.run(), /保存尚未确认/);
        assert.equal(f.requests.length, 1);
        assert.equal(f.operations.length, 1);
        assert.equal(f.notices.includes(true), false);
        const marker = structuredClone(f.parameter.metadata.productPlanningPendingCommit);
        assert.deepEqual(marker, { slotId: 'product-image-plan', taskId: 'task-1', configNodeIds: f.configs.map(node => node.id) });
        f.nodes.push({ id: 'later-config', type: 'config', metadata: { prompt: '后来手工添加' } });
        f.prompts[0].metadata.productImagePrompt.prompt.chinese += '用户在失败后的新编辑';
        const start = f.events.length;
        await f.run();
        assert.equal(f.requests.length, 1, '恢复只确认原任务，不发送任何新请求');
        assert.equal(f.operations.length, 1, '恢复不能重新覆盖用户在失败后的编辑');
        assert.match(f.prompts[0].metadata.productImagePrompt.prompt.chinese, /用户在失败后的新编辑$/);
        assert.equal(f.parameter.metadata.productPlanningPendingCommit, undefined);
        assert.deepEqual(f.confirmed.map(item => item.receipt.taskId), ['task-1']);
        assert.deepEqual(f.confirmed[0].scope, { productId: 'product', nodeId: 'parameter' });
        const resumed = f.events.slice(start);
        assert.ok(resumed.indexOf(`save-${failAt + 1}-ack`) < resumed.indexOf('confirm-task-1'));
        assert.ok(resumed.indexOf('confirm-task-1') < resumed.indexOf(`save-${failAt + 2}-ack`));
        assert.equal(f.notices.filter(Boolean).length, 1);
        assert.deepEqual(f.noticeScopes, [marker.configNodeIds]);
    }
});

test('候选冷恢复先保存和确认原收据，再只请求repair，原卡片仍保持直到修复通过', async () => {
    const first = fixture([badPlan(), badPlan()]);
    await assert.rejects(first.run(), /修正后仍未通过检查/);
    const metadata = structuredClone(first.snapshots.at(-1).nodes.find(node => node.id === 'parameter').metadata);
    const restored = fixture([planData()], { beforeRequest(_index, request, f) {
        assert.equal(request.scope.slotId, 'product-image-plan-repair');
        assert.deepEqual(f.confirmed.map(item => item.receipt.taskId), ['task-2']);
        assert.equal(f.operations.length, 0);
    } });
    restored.parameter.metadata = metadata;
    await restored.run();
    assert.equal(restored.requests.length, 1);
    assert.equal(restored.operations.length, 1);
    assert.equal(restored.parameter.metadata.productPlanningCandidate, undefined);
    assert.equal(restored.parameter.metadata.productPlanningPendingCommit, undefined);
});

test('旧source有收据时先保存并确认旧任务，随后才创建当前资料的新任务', async () => {
    const f = fixture([planData()], { beforeRequest(_index, request, current) {
        assert.equal(request.retry, true);
        assert.deepEqual(current.confirmed.map(item => item.receipt.taskId), ['old-task']);
        assert.ok(current.events.indexOf('save-1-ack') < current.events.indexOf('confirm-old-task'));
    } });
    Object.assign(f.parameter.metadata, {
        gatewayGenerationTasks: [{ slotId: 'product-image-plan', taskId: 'old-task' }],
        gatewayGenerationReceipts: [{ taskId: 'old-task', responseHash: 'old-receipt-hash' }],
        productPlanningTaskSources: { 'product-image-plan': 'old-source-key' },
    });
    await f.run();
    assert.equal(f.requests.length, 1);
    assert.equal(f.operations.length, 1);
    assert.notEqual(f.parameter.metadata.productPlanningTaskSources['product-image-plan'], 'old-source-key');
});

test('旧source无收据时仅消费旧结果保存收据，不应用旧卡片，然后才显式生成当前资料', async () => {
    const f = fixture([planData()], { beforeRequest(index, request, current) {
        if (!index) {
            assert.equal(request.retry, false);
            assert.equal(request.previous.taskId, 'old-task');
        } else {
            assert.equal(request.retry, true);
            assert.equal(current.operations.length, 0, '旧结果不可用于改写当前卡片');
            const receipt = current.snapshots.at(-1).nodes.find(node => node.id === 'parameter').metadata.gatewayGenerationReceipts;
            assert.ok(receipt.some(item => item.taskId === 'old-task'));
        }
    } });
    Object.assign(f.parameter.metadata, {
        gatewayGenerationTasks: [{ slotId: 'product-image-plan', taskId: 'old-task' }],
        productPlanningTaskSources: { 'product-image-plan': 'old-source-key' },
    });
    await f.run();
    assert.deepEqual(f.requests.map(request => request.retry), [false, true]);
    assert.equal(f.operations.length, 1);
    assert.doesNotMatch(f.prompts[0].metadata.productImagePrompt.prompt.chinese, /旧资料的返回/);
});

test('旧source恢复仅终态失败或取消可转入新请求，其他错误及恢复收据保存失败均不重发', async () => {
    for (const reason of ['generation_explicit_retry_required', 'generation_connection_unknown', 'save-failed']) {
        const f = fixture([planData()], {
            recover() {
                if (reason !== 'save-failed') throw Object.assign(Error('旧任务恢复失败'), { code: reason });
                return '旧结果只记录收据';
            },
            save: count => reason !== 'save-failed' || count !== 1,
        });
        Object.assign(f.parameter.metadata, {
            gatewayGenerationTasks: [{ slotId: 'product-image-plan', taskId: 'old-task' }],
            productPlanningTaskSources: { 'product-image-plan': 'old-source-key' },
        });
        if (reason === 'generation_explicit_retry_required') {
            await f.run();
            assert.deepEqual(f.requests.map(request => request.retry), [false, true]);
            assert.equal(f.operations.length, 1);
        } else {
            await assert.rejects(f.run(), reason === 'save-failed' ? /保存尚未确认/ : /旧任务恢复失败/);
            assert.deepEqual(f.requests.map(request => request.retry), [false]);
            assert.equal(f.operations.length, 0);
            assert.equal(f.notices.includes(true), false);
        }
    }
});

test('真实文本确认入口只确认原收据，不拥有新建提交或交付结果的能力，取消不调用端口', async () => {
    const calls = [];
    const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
    const controller = new AbortController();
    const loader = variantModules({
        '@/stores/use-config-store': {}, './原画布图片调用': {}, './图片任务衔接.mjs': {},
        './文本生成协议': {}, './文本临时显示.mjs': {},
    });
    const scope = { productId: 'product', nodeId: 'parameter' }, receipt = { taskId: 'original-task', responseHash: 'original-result-hash' };
    try {
        Object.defineProperty(globalThis, 'window', { configurable: true, value: { __guanGenerationHost: {
            confirmSaved: async (task, options) => { calls.push({ task, options }); },
        } } });
        const { confirmSavedCanvasText } = loader.load('画布生成/原画布文本调用.ts');
        await confirmSavedCanvasText(scope, receipt, controller.signal);
        assert.deepEqual(calls, [{ task: { id: 'original-task', ...scope }, options: { responseHash: 'original-result-hash', signal: controller.signal } }]);
        controller.abort();
        await assert.rejects(confirmSavedCanvasText(scope, receipt, controller.signal), { name: 'AbortError' });
        assert.equal(calls.length, 1);
        delete window.__guanGenerationHost.confirmSaved;
        await assert.rejects(confirmSavedCanvasText(scope, receipt, new AbortController().signal), /不会重新生成/);
        assert.equal(calls.length, 1);
    } finally {
        if (original) Object.defineProperty(globalThis, 'window', original);
        else delete globalThis.window;
    }
});

test('确认原收据失败保留pendingCommit，下次仅补保存及确认，不新请求或重做应用', async () => {
    let failConfirmation = true;
    const f = fixture([planData()], {
        save: count => count !== 2,
        confirm() { if (failConfirmation) throw Error('确认端口暂不可用'); },
    });
    await assert.rejects(f.run(), /保存尚未确认/);
    await assert.rejects(f.run(), /确认端口暂不可用/);
    assert.equal(f.requests.length, 1); assert.equal(f.operations.length, 1);
    assert.deepEqual(f.parameter.metadata.productPlanningPendingCommit, { slotId: 'product-image-plan', taskId: 'task-1',
        configNodeIds: f.configs.map(node => node.id) });
    assert.equal(f.notices.includes(true), false);
    failConfirmation = false;
    await f.run();
    assert.equal(f.requests.length, 1); assert.equal(f.operations.length, 1);
    assert.equal(f.parameter.metadata.productPlanningPendingCommit, undefined);
    assert.equal(f.notices.filter(Boolean).length, 1);
    assert.deepEqual(f.noticeScopes, [f.configs.map(node => node.id)], '恢复保存使用原策划的清单，不扫描整张画布');
});

test('策划成功通知只包含本次新增或更新的配置，排除手工卡、其他参数卡和退出用途', async () => {
    const plan = planData(); plan.images.pop();
    plan.confirmations[0].imageKeys = ['main'];
    const f = fixture([plan]);
    f.nodes.push({ id: 'manual', type: 'config', metadata: { prompt: '手工配置保留' } },
        { id: 'other-parameter-prompt', type: 'guan:product-prompt', metadata: {
            productImagePrompt: { ...plan.images[0], parameterId: 'other-parameter', generatedSignature: 'old' } } },
        { id: 'other-parameter-config', type: 'config', metadata: { productPromptConfigKey: 'other-parameter-prompt' } });
    await f.run();
    assert.deepEqual(f.noticeScopes, [[f.configs[0].id]]);
    assert.equal(f.configs[1].metadata.productPromptRetired, true);
    assert.equal(f.nodes.find(node => node.id === 'manual').metadata.prompt, '手工配置保留');
    assert.equal(f.nodes.find(node => node.id === 'other-parameter-config').metadata.productPromptRetired, undefined);
});

test('客户旧版卡片已出现但没有pendingCommit时，继续保存只确认原任务，不重复策划或改卡', async () => {
    let fail = true;
    const f = fixture([planData()], { save: count => count !== 2,
        confirm() { if (fail) throw Error('本机生成请求未完成'); } });
    await assert.rejects(f.run(), /保存尚未确认/);
    delete f.parameter.metadata.productPlanningPendingCommit;
    delete f.parameter.metadata.productPlanningResolution;
    const cards = structuredClone(f.prompts), modelRequests = f.requests.length;
    const recovery = f.loader.load('Excel画布/商品策划恢复入口.ts');
    assert.equal(recovery.productPlanningRecovery(f.parameter).label, '继续保存');
    await assert.rejects(f.run({ recoverOnly: true }), /本机生成请求未完成/);
    assert.equal(f.requests.length, modelRequests);
    assert.equal(f.operations.length, 1);
    assert.deepEqual(f.prompts, cards);
    fail = false; await f.run({ recoverOnly: true });
    assert.equal(f.requests.length, modelRequests);
    assert.equal(f.operations.length, 1);
    assert.equal(recovery.productPlanningRecovery(f.parameter), undefined);
    assert.equal(f.parameter.metadata.productPlanningResolution.taskId, 'task-1');
});

test('查询原任务沿用原身份并取回结果，不record新任务；原任务失败后才开放明确重新策划', async () => {
    let blocked = true;
    const f = fixture([planData()], { beforeApply() { if (blocked) throw Error('connection unknown'); } });
    await assert.rejects(f.run(), /connection unknown/);
    const original = structuredClone(f.parameter.metadata.gatewayGenerationTasks);
    blocked = false; await f.run({ recoverOnly: true });
    assert.ok(f.events.includes('query-task-1'));
    assert.equal(f.requests[1].recoverOnly, true);
    assert.equal(f.requests[1].previous.taskId, 'task-1');
    assert.deepEqual(f.parameter.metadata.gatewayGenerationTasks, original);
    assert.equal(f.operations.length, 1);
    const failed = fixture([planData()], { beforeApply() { throw Error('disconnected'); }, query: () => ({ state: 'failed' }) });
    await assert.rejects(failed.run(), /disconnected/);
    await assert.rejects(failed.run({ recoverOnly: true }), /原任务已失败/);
    assert.equal(failed.requests.length, 1);
    assert.equal(failed.parameter.metadata.productPlanningResolution.status, 'failed');
});
test('查询发现原任务早已确认完成时，只记录完成，不重取响应或执行新策划', async () => {
    let stopped = true;
    const f = fixture([planData()], { beforeApply() { if (stopped) throw Error('disconnected'); },
        query: () => ({ state: 'succeeded', applied: true }) });
    await assert.rejects(f.run(), /disconnected/);
    stopped = false;
    await f.run({ recoverOnly: true });
    assert.equal(f.requests.length, 1);
    assert.equal(f.operations.length, 0);
    assert.equal(f.parameter.metadata.productPlanningResolution.status, 'succeeded');
    assert.equal(f.phases.at(-1), 'ready');
});

test('旧客户缺失来源记录或来源已变化时只查询并停止，不把旧结果当新资料重发', async () => {
    for (const source of [undefined, 'old-system-or-source-key']) {
        const f = fixture([planData()]);
        Object.assign(f.parameter.metadata, {
            gatewayGenerationTasks: [{ taskId: 'old-task', slotId: 'product-image-plan' }],
            ...(source ? { productPlanningTaskSources: { 'product-image-plan': source } } : {}),
        });
        const original = structuredClone(f.prompts);
        await assert.rejects(f.run({ recoverOnly: true }), /原任务对应的商品资料或提示词已变化/);
        assert.ok(f.events.includes('query-old-task'));
        assert.equal(f.requests.length, 0);
        assert.equal(f.operations.length, 0);
        assert.deepEqual(f.prompts, original);
    }
});

test('服务仅在旧source请求变化且缺失旧任务成功收口后创建新任务，收口失败保留原任务', async () => {
    for (const retireFails of [false, true]) {
        const f = fixture([planData()], {
            recover() { throw Object.assign(Error('旧任务请求变化'), { code: 'generation_request_changed' }); },
            retire(scope, task, current) {
                assert.deepEqual(scope, { productId: 'product', nodeId: 'parameter' });
                assert.equal(task.taskId, 'old-task');
                assert.deepEqual(current.requests.map(request => request.retry), [false]);
                assert.equal(current.operations.length, 0);
                if (retireFails) throw Error('旧任务仍存在');
            },
        });
        Object.assign(f.parameter.metadata, {
            gatewayGenerationTasks: [{ slotId: 'product-image-plan', taskId: 'old-task' }],
            productPlanningTaskSources: { 'product-image-plan': 'old-source-key' },
        });
        if (retireFails) {
            await assert.rejects(f.run(), /旧任务仍存在/);
            assert.deepEqual(f.requests.map(request => request.retry), [false]);
            assert.equal(f.operations.length, 0);
        } else {
            await f.run();
            assert.deepEqual(f.requests.map(request => request.retry), [false, true]);
            assert.equal(f.operations.length, 1);
            assert.ok(f.events.indexOf('retire-old-task') < f.events.lastIndexOf('request-product-image-plan'));
        }
    }
});

test('真实缺失任务收口入口仅get确认不存在才retire，现存或网络错误不收口且非cancelled不继续', async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
    const loader = variantModules({
        '@/stores/use-config-store': {}, './原画布图片调用': {}, './图片任务衔接.mjs': {},
        './文本生成协议': {}, './文本临时显示.mjs': {},
    });
    const scope = { productId: 'product', nodeId: 'parameter' };
    const task = { taskId: 'old-task', binding: 'old-binding', requestHash: 'old-request-hash', slotId: 'product-image-plan' };
    const { retireMissingCanvasText } = loader.load('画布生成/原画布文本调用.ts');
    try {
        for (const state of ['missing', 'exists', 'network', 'retire-running']) {
            const calls = [];
            Object.defineProperty(globalThis, 'window', { configurable: true, value: { __guanGenerationHost: {
                get: async id => {
                    calls.push(['get', id]);
                    if (state === 'exists') return { state: 'running' };
                    throw Object.assign(Error(state === 'network' ? '网络中断' : '不存在'), {
                        code: state === 'network' ? 'generation_connection_unknown' : 'generation_not_found',
                    });
                },
                retirePreparedTask: async value => {
                    calls.push(['retire', value]);
                    return { state: state === 'retire-running' ? 'running' : 'cancelled' };
                },
            } } });
            if (state === 'missing') {
                await retireMissingCanvasText(scope, task, new AbortController().signal);
                assert.deepEqual(calls, [['get', 'old-task'], ['retire', {
                    id: 'old-task', ...scope, binding: 'old-binding', requestHash: 'old-request-hash',
                }]]);
            } else {
                await assert.rejects(retireMissingCanvasText(scope, task, new AbortController().signal),
                    state === 'exists' ? /旧任务仍存在/ : state === 'network' ? /网络中断/ : /状态已变化/);
                assert.equal(calls.length, state === 'retire-running' ? 2 : 1);
            }
        }
    } finally {
        if (original) Object.defineProperty(globalThis, 'window', original);
        else delete globalThis.window;
    }
});

test('真实复制参数卡后修改商品并完成新策划，原卡的候选、收据、配置和提示词全部保持', async () => {
    const f=fixture([planData()]);
    f.parameter.title='产品参数设置';
    f.configs.forEach((node,index)=>Object.assign(node,{position:{x:1100,y:index*700},width:340,height:240}));
    Object.assign(f.parameter.metadata,{
        productPlanningPendingCommit:{taskId:'original-task',slotId:'product-image-plan',configNodeIds:['original-config']},
        productPlanningCandidate:{taskId:'original-task',response:'原商品方案',requestKey:'old-source'},
        productPlanningTaskSources:{'product-image-plan':'old-source'},
        gatewayGenerationTasks:[{taskId:'original-task',slotId:'product-image-plan'}],
        gatewayGenerationReceipts:[{taskId:'original-task',responseHash:'original-hash'}],
        productPlanningTaskOwner:{nodeId:f.parameter.id,productId:'product',taskId:'original-task'},
    });
    const original=structuredClone(f.parameter), oldPrompts=structuredClone(f.prompts),oldConfigs=structuredClone(f.configs);
    const copy=f.loader.load('画布布局/节点复制操作.ts');
    const copied=copy.prepareCopiedNodes(copy.captureCopiedNodes(f.nodes,f.connections,new Set([f.parameter.id])),
        {x:1000,y:1000},f.nodes,()=> 'copied-parameter').nodes[0];
    Object.assign(f.parameter,copied);
    f.nodes.push(original);
    f.parameter.metadata.productBrief={...f.parameter.metadata.productBrief,nameCategory:'复制后修改的新商品'};
    await f.run();
    assert.equal(f.requests.length,1);
    assert.equal(f.requests[0].previous,undefined);
    assert.equal(f.requests[0].scope.nodeId,'copied-parameter');
    assert.match(JSON.stringify(f.requests[0].messages),/复制后修改的新商品/);
    assert.equal(f.parameter.metadata.productPlanningTaskOwner.nodeId,'copied-parameter');
    assert.deepEqual(f.nodes.find(node=>node.id===original.id),original);
    assert.deepEqual(f.prompts,oldPrompts);assert.deepEqual(f.configs,oldConfigs);
    assert.equal(f.parameter.metadata.productImagePlan.imageCount,2);
    assert.ok(f.snapshots.some(item=>item.persisted&&item.nodes.some(node=>node.id==='copied-parameter')));
    assert.ok(f.confirmed.every(item=>item.scope.nodeId==='copied-parameter'));
});

test('明确请求校验拒绝只收口未接受的任务，保留资料且下一次操作可以明确重新策划', async () => {
    let blocked = true;
    const f = fixture([planData()], { beforeApply: () => {
        if (blocked) throw Object.assign(Error('生成请求格式或大小不支持。'), { code: 'invalid_generation_request' });
    } });
    await assert.rejects(f.run(), /生成请求格式或大小/);
    const task = f.parameter.metadata.gatewayGenerationTasks.at(-1);
    assert.equal(f.parameter.metadata.productPlanningResolution.taskId, task.taskId);
    assert.equal(f.parameter.metadata.productPlanningResolution.status, 'failed');
    assert.ok(f.events.includes(`retire-${task.taskId}`));
    assert.equal(f.loader.load('Excel画布/商品策划恢复入口.ts').productPlanningRecovery(f.parameter), undefined);
    assert.equal(f.requests.length, 1);
    blocked = false;
    await f.run();
    assert.equal(f.parameter.metadata.productPlanningTask.status, 'success');
});

test('查询确认本机未接受旧任务后结束旧记录，本次不发送模型请求；未知连接失败仍保留查询入口', async () => {
    for (const code of ['generation_not_found', 'generation_connection_unknown']) {
        const f = fixture([], { query: () => { throw Object.assign(Error('查询失败'), { code }); } });
        f.parameter.metadata.gatewayGenerationTasks = [{ taskId: 'missing-task', slotId: 'product-image-plan' }];
        await assert.rejects(f.run({ recoverOnly: true }), code === 'generation_not_found' ? /已确认原策划未提交/ : /查询失败/);
        assert.equal(f.requests.length, 0);
        const recovery = f.loader.load('Excel画布/商品策划恢复入口.ts').productPlanningRecovery(f.parameter);
        if (code === 'generation_not_found') {
            assert.equal(recovery, undefined);
            assert.ok(f.events.includes('retire-missing-task'));
        } else {
            assert.equal(recovery.kind, 'query');
            assert.ok(!f.events.includes('retire-missing-task'));
        }
    }
});
