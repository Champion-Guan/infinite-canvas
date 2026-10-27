import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID, createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { openRemoteVideoLedger } from '../扩展功能/生成任务/视频远端任务账本.mjs';
import { createSavedVideoVerifier } from '../扩展功能/生成任务/视频结果保存核验.mjs';
import { createGenerationHTTPHandler } from '../扩展功能/生成网关/生成HTTP入口.mjs';
import { createGenerationClient } from '../扩展功能/生成任务/生成任务客户端.mjs';
import { StorageError } from '../扩展功能/本机存储/协议.mjs';
import { GENERATION_PROTOCOL } from '../扩展功能/生成网关/生成协议.mjs';
import { NO_RESULT_ACK } from '../扩展功能/生成任务/未决任务核实.mjs';
import { generationFixture, listen, closeServer } from './生成网关隔离夹具.mjs';

const code = name => error => error?.code === name;
const ledgerId = 'guan-video-remote-tasks';
async function fixture(options = {}) {
    const f = await generationFixture(options);
    let saved = false;
    const videos = openRemoteVideoLedger({ workspace: options.ledgerWorkspace?.(f.workspace) || f.workspace, gateway: f.gateway, coordinator: f.coordinator, verifySaved: async () => saved, maxTasks: options.maxVideos || 256 });
    return { ...f, videos, setSaved() { saved = true; },
        async scope(provider = 'openai') { return { id: randomUUID(), productId: 'video-product', nodeId: 'video-node', binding: (await f.bind(provider)).binding, provider, model: 'video-model' }; },
        request(path = '/v1/videos') { return { method: 'POST', path, contentType: 'application/json', body: Buffer.from('{"prompt":"synthetic-video","model":"synthetic"}').toString('base64') }; },
        replyJSON(value) { f.reply.bytes = Buffer.from(JSON.stringify(value)); },
        async close() { await videos.close(); await f.close(); },
    };
}
test('发送前SQLite意图可见，原绑定认证；拿到ID后绑定，重复创建不重发', async () => {
    let f;
    f = await fixture({ beforeReply() { assert.equal(f.videos.find('video-product', 'video-node').remoteId, null); assert.equal(f.videos.updateBlockers()[0].canConfirmNoResult, false); assert.throws(() => f.videos.assertCanClose()); } });
    try {
        const scope = await f.scope(); f.replyJSON({ id: 'video_123' });
        const job = await f.videos.create(scope, f.request());
        assert.equal(job.remoteId, 'video_123'); assert.equal(f.requests.length, 1); assert.match(f.requests[0].headers.authorization, /^Bearer synthetic-/);
        assert.equal((await f.videos.create(scope, f.request())).remoteId, job.remoteId); assert.equal(f.requests.length, 1);
        assert.throws(() => f.videos.assertCanUpdate(), code('install_tasks_pending'));
    } finally { await f.close(); }
});
test('创建断线与冷重开保留未知记录；同ID和新ID均不重发；只有明确渠道无结果才收口', async () => {
    const f = await fixture();
    try {
        const scope = await f.scope(); f.reply.disconnect = true;
        await assert.rejects(f.videos.create(scope, f.request()));
        await f.videos.close();
        const cold = openRemoteVideoLedger({ workspace: f.workspace, gateway: f.gateway, coordinator: f.coordinator, verifySaved: async () => false });
        await assert.rejects(cold.create(scope, f.request()), code('video_remote_unknown'));
        await assert.rejects(cold.create({ ...scope, id: randomUUID() }, f.request()), code('video_remote_unknown'));
        assert.equal(f.requests.length, 1); assert.equal(cold.updateBlockers()[0].canConfirmNoResult, true);
        await assert.rejects(cold.confirmNoResult(scope.id, 'cancel'), code('video_confirmation_required'));
        assert.equal((await cold.confirmNoResult(scope.id, NO_RESULT_ACK)).reason, 'operator_confirmed_no_result'); cold.assertCanUpdate(); await cold.close();
    } finally { await f.close(); }
});
test('意图保存失败不发送；SQLite提交丢ACK按后态确认只发送一次', async () => {
    let fail = true, lose = false;
    const f = await fixture({ ledgerWorkspace: workspace => ({ ...workspace, writeDocument(input) {
        if (fail && input.id === ledgerId) throw Error('synthetic full disk');
        const ack = workspace.writeDocument(input);
        if (lose && input.id === ledgerId) { lose = false; throw Error('synthetic lost ack'); }
        return ack;
    } }) });
    try {
        const scope = await f.scope(); f.replyJSON({ id: 'video_123' });
        await assert.rejects(f.videos.create(scope, f.request())); assert.equal(f.requests.length, 0);
        fail = false; lose = true;
        assert.equal((await f.videos.create(scope, f.request())).remoteId, 'video_123'); assert.equal(f.requests.length, 1);
    } finally { await f.close(); }
});
test('并发重复点击与同节点新ID不会重复创建，发送中禁止人工解除', async () => {
    let enter, release;
    const entered = new Promise(resolve => { enter = resolve; }), gate = new Promise(resolve => { release = resolve; });
    const f = await fixture({ beforeReply: async () => { enter(); await gate; } });
    try {
        const scope = await f.scope(); f.replyJSON({ id: 'video_123' });
        const flight = f.videos.create(scope, f.request()); await entered;
        await assert.rejects(f.videos.create(scope, f.request()), code('video_create_busy'));
        await assert.rejects(f.videos.create({ ...scope, id: randomUUID() }, f.request()), code('video_remote_unknown'));
        await assert.rejects(f.videos.confirmNoResult(scope.id, NO_RESULT_ACK), code('video_confirmation_required'));
        release(); await flight; assert.equal(f.requests.length, 1);
    } finally { release(); await f.close(); }
});
test('只有原渠道已终态且原结果已保存才解除升级保护；GET轮询不写盘', async () => {
    const f = await fixture();
    try {
        const scope = await f.scope(); f.replyJSON({ id: 'video_123' }); await f.videos.create(scope, f.request());
        const revision = f.workspace.readDocument('extension', ledgerId).revision;
        f.replyJSON({ id: 'video_123', status: 'in_progress' });
        await assert.rejects(f.videos.confirmTerminal(scope.id), code('video_remote_pending'));
        assert.equal(f.workspace.readDocument('extension', ledgerId).revision, revision);
        f.replyJSON({ id: 'other_video', status: 'completed' }); await assert.rejects(f.videos.confirmTerminal(scope.id), code('video_check_mismatch'));
        f.replyJSON({ id: 'video_123', status: 'completed' }); await assert.rejects(f.videos.confirmTerminal(scope.id), code('video_result_unsaved'));
        f.setSaved(); assert.equal((await f.videos.confirmTerminal(scope.id)).state, 'succeeded'); f.videos.assertCanUpdate();
        const finishedRevision = f.workspace.readDocument('extension', ledgerId).revision;
        await f.videos.confirmTerminal(scope.id); assert.equal(f.workspace.readDocument('extension', ledgerId).revision, finishedRevision);
        assert.equal(f.requests.filter(request => request.method === 'POST').length, 1);
    } finally { await f.close(); }
});
test('失败终态可解除保护；已知ID不接受人工无结果绕过查询', async () => {
    const f = await fixture();
    try {
        const scope = await f.scope(); await f.videos.ensure(scope, 'video_old');
        await assert.rejects(f.videos.confirmNoResult(scope.id, NO_RESULT_ACK), code('video_resolution_denied'));
        f.replyJSON({ id: 'video_old', status: 'failed' }); assert.equal((await f.videos.confirmTerminal(scope.id)).state, 'failed'); f.videos.assertCanUpdate();
    } finally { await f.close(); }
});
test('Gemini模型下operations可核实；跨路径、认证查询和类型错配拒绝', async () => {
    const f = await fixture();
    try {
        const scope = await f.scope('gemini'), remoteId = 'models/veo-3/operations/abc-123';
        f.replyJSON({ name: remoteId }); assert.equal((await f.videos.create(scope, f.request('/v1beta/models/veo-3:predictLongRunning'))).remoteId, remoteId);
        f.replyJSON({ name: remoteId, done: true, error: { message: 'synthetic failed' } });
        assert.equal((await f.videos.confirmTerminal(scope.id)).state, 'failed'); assert.equal(f.requests.at(-1).path, '/v1beta/' + remoteId);
        for (const id of ['../operations/a', 'operations/a?key=hidden', 'https://other.test/a', 'models/x/operations/a/content'])
            await assert.rejects(f.videos.ensure({ ...scope, id: randomUUID(), nodeId: randomUUID() }, id), code('invalid_video_remote_id'));
        await assert.rejects(f.videos.create({ ...scope, id: randomUUID(), nodeId: 'second' }, f.request('/v1beta/models/veo:generateContent')), code('invalid_video_request'));
    } finally { await f.close(); }
});
test('账本有界仅淘汰终态，未决不能被容量回收；损坏账本拒绝当空账本', async () => {
    const f = await fixture({ maxVideos: 2 });
    try {
        const scope = await f.scope(); await f.videos.ensure(scope, 'video_1');
        const second = { ...scope, id: randomUUID(), nodeId: 'second' }; await f.videos.ensure(second, 'video_2');
        await assert.rejects(f.videos.ensure({ ...scope, id: randomUUID(), nodeId: 'third' }, 'video_3'), code('video_ledger_full'));
        f.replyJSON({ id: 'video_2', status: 'failed' }); await f.videos.confirmTerminal(second.id);
        await f.videos.ensure({ ...scope, id: randomUUID(), nodeId: 'third' }, 'video_3');
        assert.equal(f.videos.find(scope.productId, scope.nodeId).id, scope.id); assert.equal(f.workspace.readDocument('extension', ledgerId).value.jobs.length, 2);
        const doc = f.workspace.readDocument('extension', ledgerId);
        f.workspace.writeDocument({ collection: 'extension', id: ledgerId, value: { ...doc.value, jobs: [{ broken: true }] }, expectedRevision: doc.revision, operationId: randomUUID() });
        assert.throws(() => f.videos.updateBlockers(), code('video_ledger_invalid'));
    } finally { await f.close(); }
});
test('视频保存核验必须匹配原产品、节点、远端ID、本机媒体和成功状态', async () => {
    const f = await fixture();
    try {
        const scope = await f.scope(), media = f.workspace.writeMedia(Buffer.from('synthetic-video'), 'video/mp4');
        const tree = value => typeof value === 'string' ? ['string', value] : Array.isArray(value) ? ['array', value.map(tree)] : ['object', Object.entries(value).map(([key, item]) => [key, tree(item)])];
        const rootId = 'app-' + createHash('sha256').update('app_state').digest('hex');
        const save = metadata => {
            const doc = f.workspace.readDocument('extension', rootId);
            f.workspace.writeDocument({ collection: 'extension', id: rootId, value: { namespace: 'app_state', format: 'guan-app-storage.v1', entries: [['infinite-canvas:canvas_store', { tree: tree({ state: { projects: [{ id: scope.productId, nodes: [{ id: scope.nodeId, type: 'video', metadata }] }] } }) }]] }, expectedRevision: doc?.revision || 0, operationId: randomUUID(), mediaIds: [media.id] });
        };
        const verify = createSavedVideoVerifier({ workspace: f.workspace }), job = { ...scope, remoteId: 'video_123' };
        const metadata = { status: 'success', videoTaskId: job.remoteId, videoTaskProvider: 'openai', storageKey: 'media:' + media.id };
        save(metadata); assert.equal(await verify(job), true); assert.equal(await verify({ ...job, nodeId: 'other' }), false);
        save({ ...metadata, videoTaskId: 'other' }); assert.equal(await verify(job), false);
        save({ ...metadata, status: 'loading' }); assert.equal(await verify(job), false);
    } finally { await f.close(); }
});
test('视频HTTP沿用页面授权；无权限、越权操作拒绝；客户端闭环只发一次', async () => {
    const f = await fixture(); let handler, authorized = true;
    const server = createServer(async (request, response) => { if (!await handler(request, response)) { response.writeHead(404); response.end(); } });
    const origin = await listen(server);
    handler = createGenerationHTTPHandler({ origin, gateway: f.gateway, tasks: f.tasks, videos: f.videos, authorize() { if (!authorized) throw new StorageError('authorization_denied', 'synthetic denied', 401); } });
    const command = async value => {
        const response = await fetch(origin + '/__guan-local/generation', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Guan-Generation-Protocol': GENERATION_PROTOCOL }, body: JSON.stringify(value) });
        const reply = await response.json(); if (!response.ok) throw new StorageError(reply.error.code, reply.error.message, response.status); return reply;
    };
    const client = createGenerationClient({ command });
    try {
        const scope = await f.scope(); f.replyJSON({ id: 'video_123' });
        const job = await client.videoCreate(scope, f.request()); assert.equal((await client.videoFind(scope.productId, scope.nodeId)).id, job.id); assert.equal(f.requests.length, 1);
        await assert.rejects(command({ operation: 'video-ensure', scope, remoteId: 'video_123', extra: true }), code('generation_command_denied'));
        authorized = false; await assert.rejects(client.videoTerminal(scope.id), code('authorization_denied')); assert.equal(f.requests.length, 1);
    } finally { await closeServer(server); await f.close(); }
});

test('保护接入前、未打开的产品视频也阻止升级；盘点缓存不写盘，接管后去重', async () => {
    const { createLegacyVideoInventory } = await import('../扩展功能/生成任务/旧视频任务盘点.mjs');
    const f = await fixture();
    try {
        const scope = await f.scope(), rootId = 'app-' + createHash('sha256').update('app_state').digest('hex');
        const { createValueCodec } = await import('../扩展功能/本机存储/应用值编码.mjs');
        const { buildFragmentPlan } = await import('../扩展功能/本机存储/分片值编码.mjs');
        const encoded = await createValueCodec({ client: {} }).encode({ state: { projects: [{ id: scope.productId, nodes: [{ id: scope.nodeId, type: 'video', metadata: { videoTaskId: 'video_legacy', status: 'loading' } }] }] } });
        const entries = [['infinite-canvas:canvas_store', encoded]], plan = await buildFragmentPlan(entries);
        for (const fragment of plan.fragments.values()) f.workspace.writeDocument({ collection: 'extension', id: fragment.id, value: fragment.value, expectedRevision: 0, operationId: randomUUID() });
        f.workspace.writeDocument({ collection: 'extension', id: rootId, value: { format: 'guan-app-storage.v2', namespace: 'app_state', entryCount: 1, head: plan.head }, expectedRevision: 0, operationId: randomUUID() });
        let reads = 0;
        const inventory = createLegacyVideoInventory({ workspace: { ...f.workspace, readDocument(...args) { reads++; return f.workspace.readDocument(...args); } }, isTracked: f.videos.isTracked });
        const blocked = await inventory(); assert.equal(blocked.length, 1); assert.equal(blocked[0].productId, scope.productId); assert.equal(blocked[0].canConfirmNoResult, false);
        const firstReads = reads; assert.deepEqual(await inventory(), blocked); assert.equal(reads, firstReads + 1);
        await f.videos.ensure(scope, 'video_legacy'); assert.deepEqual(await inventory(), []); assert.equal(f.videos.updateBlockers().length, 1);
    } finally { await f.close(); }
});
test('画布视频接线先保存ID，保存结果后才确认；未知创建不重发，切换画布不覆盖', async () => {
    const { readFileSync } = await import('node:fs');
    const { transformWithEsbuild } = await import('../.运行/3100源/画布副本/web/node_modules/vite/dist/node/index.js');
    const file = '扩展功能/画布生成/视频任务保护.ts', { code } = await transformWithEsbuild(readFileSync(file, 'utf8'), file, { loader: 'ts', format: 'cjs', target: 'es2022', tsconfigRaw: '{}' });
    let pending = null, dispatches = 0, failedSave = false, failedRemote = false;
    const events = [], record = { id: randomUUID(), productId: 'product', nodeId: 'video', binding: 'provider:' + 'a'.repeat(64), provider: 'openai', model: 'veo', remoteId: 'video_123', state: 'uncertain' };
    const host = { async videoFind() { return pending; }, async videoCreate(_scope, request) { dispatches++; assert.equal(request.path, '/v1/videos'); return record; }, async videoTerminal() { events.push('terminal'); return { ...record, state: failedRemote ? 'failed' : 'succeeded' }; } };
    const deps = {
        react: { useCallback: fn => fn, useEffect() {}, useMemo: fn => fn() },
        '@/stores/use-config-store': { resolveModelScript: () => null, resolveModelRequestConfig: config => config },
        '@/services/api/video': { isVideoTaskFailed: error => error?.name === 'VideoTaskFailed' },
        '../生成任务/视频读取客户端.mjs': { waitForProtectedVideo: async () => { if (failedRemote) { const error = Error('synthetic failed'); error.name = 'VideoTaskFailed'; throw error; } return { blob: new Blob(['synthetic']) }; } },
        './原画布图片调用': { bindGenerationChannel: async () => record.binding },
        '../产品/产品操作': { saveProductCanvas: async () => { events.push('save'); if (failedSave) throw Error('synthetic save failure'); } },
        './图片任务衔接.mjs': { serializeProductResult: async (_id, action) => action() },
    };
    const module = { exports: {} }; new Function('require', 'module', 'exports', code)(name => { assert.ok(Object.hasOwn(deps, name), name); return deps[name]; }, module, module.exports);
    const previousWindow = globalThis.window;
    globalThis.window = { __guanGenerationHost: host };
    try {
        const nodesRef = { current: [{ id: 'video', type: 'video', metadata: {} }] }, surfaceRef = { current: { projectId: 'product', active: true, mounted: true } };
        const ports = module.exports.useCanvasVideoProtection({ projectId: 'product', nodesRef, restoredProjectIdRef: { current: 'product' }, surfaceRef, setNodes: update => { nodesRef.current = update(nodesRef.current); } });
        const signal = new AbortController().signal, config = { model: 'veo', apiFormat: 'openai' };
        const dispatch = send => send('/v1/videos', { model: 'veo', prompt: 'synthetic' });
        const task = await ports.create('video', config, dispatch, signal);
        assert.deepEqual(events, ['save']); assert.equal(nodesRef.current[0].metadata.videoTaskId, record.remoteId);
        failedSave = true;
        await assert.rejects(ports.saveResult(task, () => events.push('apply'), signal)); assert.equal(events.includes('terminal'), false);
        failedSave = false; await ports.saveResult(task, () => events.push('apply'), signal); assert.deepEqual(events.slice(-3), ['apply', 'save', 'terminal']);
        pending = { ...record, remoteId: null }; await assert.rejects(ports.create('video', config, dispatch, signal), /尚未确认/); assert.equal(dispatches, 1);
        pending = null; surfaceRef.current.active = false; await assert.rejects(ports.saveResult(task, () => assert.fail('cannot apply'), signal), /已关闭或切换/);
        surfaceRef.current.active = true; failedRemote = true; await assert.rejects(ports.wait(config, task, signal), error => error.name === 'VideoTaskFailed'); assert.equal(events.at(-1), 'terminal');
    } finally { if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow; }
});

test('正式服务装配合并视频升级门禁与核实入口，未决可正常退出但不可安装升级', async () => {
    const { assembleGenerationService } = await import('../扩展功能/生成网关/生成服务装配.mjs');
    const f = await fixture(); let service;
    try {
        const scope = await f.scope(); f.reply.disconnect = true; await assert.rejects(f.videos.create(scope, f.request()));
        service = await assembleGenerationService({ workspace: f.workspace, vault: f.vault, runTrustedWrite: action => f.coordinator.runWrite(action), authorize() {}, origin: 'http://localhost:3001', networkProxy: {} });
        assert.equal((await service.updateBlockers())[0].reason, 'video_remote_unknown');
        await assert.rejects(service.assertCanUpdate(), code('install_tasks_pending')); service.assertCanClose();
        assert.equal((await service.confirmNoResult(scope.id, NO_RESULT_ACK)).state, 'cancelled');
        await service.assertCanUpdate(); assert.deepEqual(await service.updateBlockers(), []);
    } finally { await service?.close(); await f.close(); }
});
