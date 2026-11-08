import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { ts } from './检查首批功能适配.mjs';
import { 构建任务确认与设置边界候选 } from './预审任务确认与设置边界.mjs';
import { createImageConfirmationRecovery, imageConfirmationTargets } from '../扩展功能/画布生成/图片任务确认恢复.mjs';
import { generationFixture } from './生成网关隔离夹具.mjs';
import { openGenerationTasks } from '../扩展功能/生成任务/SQLite生成任务.mjs';
import { createSavedCanvasVerifier } from '../扩展功能/生成任务/画布保存核验.mjs';
import { createCanvasCheckpointReader } from '../扩展功能/画布生成/画布检查点.mjs';
import { createValueCodec } from '../扩展功能/本机存储/应用值编码.mjs';
import { buildFragmentPlan } from '../扩展功能/本机存储/分片值编码.mjs';
import { openWorkspace } from '../扩展功能/本机存储/SQLite工作区.mjs';

const preview = 构建任务确认与设置边界候选();
const source = path => preview.delta.get('画布副本/web/src/' + path)?.产物 ?? readFileSync(join(preview.integration.副本, 'web/src', path), 'utf8');
async function candidateModule(path, original = false) {
  const full = join(preview.integration.副本, 'web/src', path);
  const code = original ? readFileSync(full, 'utf8') : source(path);
  const linked = code.replace(/from (['"])(\.[^'"]+)\1/g, (_match, _quote, relative) => 'from ' + JSON.stringify(pathToFileURL(resolve(dirname(full), relative)).href));
  return import('data:text/javascript;base64,' + Buffer.from(linked).toString('base64'));
}
const { createGenerationClient } = await candidateModule('guan/generation/生成任务客户端.mjs');
const { runCanvasImageTask, serializeProductResult } = await candidateModule('guan/generation/图片任务衔接.mjs');
const originalRunner = (await candidateModule('guan/generation/图片任务衔接.mjs', true)).runCanvasImageTask;
const protocol = 'guan-generation.v1', responseHash = 'a'.repeat(64);
const task = () => ({ id: randomUUID(), productId: 'product-A', nodeId: 'node-A' });
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; }
function fixture() {
  const target = { ...task(), responseHash }, calls = [];
  const job = { id: target.id, productId: target.productId, nodeId: target.nodeId, state: 'succeeded', applied: false, result: { id: responseHash } };
  let fail, saves = 0;
  const host = createGenerationClient({ async command(value) {
    calls.push(value.operation);
    if (fail === value.operation) throw Error('synthetic-before-' + fail);
    let result;
    if (value.operation === 'list') result = [structuredClone(job)];
    else if (value.operation === 'get') result = structuredClone(job);
    else if (value.operation === 'checkpoint') result = { rootRevision: 2, rootHash: 'b'.repeat(64) };
    else if (value.operation === 'applied') {
      job.applied = true;
      if (fail === 'applied-ack') throw Error('synthetic-lost-applied-ack');
      result = structuredClone(job);
    } else throw Error('禁止恢复调用: ' + value.operation);
    return { protocol, result };
  } });
  const recovery = createImageConfirmationRecovery({ host, targets: [target], serialize: serializeProductResult,
    async save() { saves++; if (fail === 'save') throw Error('synthetic-save-ack'); } });
  return { target, host, recovery, job, calls, fail: value => { fail = value; }, saves: () => saves };
}

for (const phase of ['save', 'list', 'get', 'checkpoint', 'applied', 'applied-ack']) test('确认恢复：' + phase + '失败保留原ID，再次确认不读取结果或提交渠道', async () => {
  const f = fixture(); f.fail(phase);
  assert.deepEqual((await f.recovery.run()).pending, [f.target.id]);
  assert.equal(f.job.applied, phase === 'applied-ack');
  f.fail(undefined); assert.equal((await f.recovery.run()).pending.length, 0); assert.equal(f.job.applied, true);
  assert.ok(f.calls.every(value => ['list', 'get', 'checkpoint', 'applied'].includes(value)));
  const count = f.calls.length; await f.recovery.run(); assert.equal(f.calls.length, count);
});
test('冷页恢复已确认任务只查询，不保存画布或重复确认', async () => {
  const f = fixture(); f.job.applied = true;
  assert.equal((await f.recovery.run()).pending.length, 0); assert.deepEqual(f.calls, ['list']); assert.equal(f.saves(), 0);
});
test('256个已确认历史任务只取一次产品清单，不逐任务请求或重写画布', async () => {
  const targets = Array.from({ length: 256 }, () => ({ ...task(), responseHash })); let lists = 0;
  const recovery = createImageConfirmationRecovery({ host: { list: async () => { lists++; return targets.map(item => ({ ...item, state: 'succeeded', applied: true, result: { id: responseHash } })); }, confirmSaved: () => assert.fail('已确认任务不能重复确认') },
    targets, serialize: serializeProductResult, save: () => assert.fail('已确认任务不能重写画布') });
  const result = await recovery.run(); assert.equal(result.pending.length, 0); assert.equal(result.confirmed.length, 256); assert.equal(lists, 1);
});
test('重复点击共享同一次恢复；卸载后不继续checkpoint/applied', async () => {
  const blocked = deferred(), f = fixture(); let active = true;
  const recovery = createImageConfirmationRecovery({ host: f.host, targets: [f.target], serialize: serializeProductResult,
    save: () => blocked.promise, isCurrent: () => active });
  const first = recovery.run(), second = recovery.run(); assert.equal(first, second);
  await new Promise(done => setImmediate(done)); active = false; blocked.resolve(); await first;
  assert.deepEqual(f.calls, ['list']); assert.equal(f.job.applied, false);
});
for (const field of ['productId', 'nodeId', 'responseHash']) test('拒绝原收据' + field + '与后台任务不匹配，不保存或确认', async () => {
  const f = fixture(), changed = { ...f.target, [field]: 'other' };
  const recovery = createImageConfirmationRecovery({ host: f.host, targets: [changed], serialize: serializeProductResult, save: () => { throw Error('禁止保存'); } });
  assert.deepEqual((await recovery.run()).pending, [f.target.id]); assert.equal(f.job.applied, false); assert.deepEqual(f.calls, ['list']);
});
test('独立确认客户端检查作用域、成功态、摘要和最终ACK', async () => {
  for (const patch of [{ productId: 'other' }, { nodeId: 'other' }, { state: 'failed' }, { result: { id: 'b'.repeat(64) } }]) {
    const f = fixture(); Object.assign(f.job, patch);
    await assert.rejects(f.host.confirmSaved(f.target, { responseHash })); assert.deepEqual(f.calls, ['get']);
  }
  const f = fixture(); await assert.rejects(f.host.confirmSaved(f.target, { responseHash: 'bad' })); assert.equal(f.calls.length, 0);
  const badAck = createGenerationClient({ command: async value => ({ protocol, result: value.operation === 'checkpoint' ? {} : structuredClone(f.job) }) });
  await assert.rejects(badAck.confirmSaved(f.target, { responseHash }));
});
test('收据发现只关联原图片的现存任务，不猜测其他节点或重复收据', () => {
  const f = fixture(), metadata = { gatewayGenerationTasks: [{ taskId: f.target.id }], gatewayGenerationReceipts: [{ taskId: f.target.id, responseHash }, { taskId: randomUUID(), responseHash }] };
  assert.deepEqual(imageConfirmationTargets('product-A', [{ id: 'node-A', type: 'image', metadata }, { id: 'text', type: 'text', metadata }]), [f.target]);
  assert.deepEqual(imageConfirmationTargets('product-A', [{ id: 'node-A', type: 'image', metadata: { gatewayGenerationReceipts: metadata.gatewayGenerationReceipts } }]), []);
  assert.throws(() => imageConfirmationTargets('product-A', [{ id: 'node-A', type: 'image', metadata: { ...metadata, gatewayGenerationReceipts: [...metadata.gatewayGenerationReceipts, metadata.gatewayGenerationReceipts[0]] } }]));
  assert.throws(() => imageConfirmationTargets('product-A', [{ id: 'node-A', type: 'image', metadata }, { id: 'node-B', type: 'image', metadata }]));
});
for (const [label, runner] of [['旧版复现提前解锁', originalRunner], ['候选保持到applied返回', runCanvasImageTask]]) test('同产品串行边界：' + label, async () => {
  const first = task(), second = { ...task(), nodeId: 'node-B' }, blocked = deferred(), entered = deferred(), order = [];
  const jobs = new Map([first, second].map(item => [item.id, { ...item, state: 'succeeded', applied: false, result: { id: responseHash } }]));
  const host = { get: async id => jobs.get(id), submit: () => { throw Error('禁止提交'); }, checkpoint: async () => ({}),
    async deliver(target, { applyAndSave }) { await applyAndSave(jobs.get(target.id)); order.push('checkpoint:' + target.nodeId); if (target.id === first.id) { entered.resolve(); await blocked.promise; } order.push('applied:' + target.nodeId); return jobs.get(target.id); } };
  const start = target => runner({ host, scope: { productId: target.productId, nodeId: target.nodeId, slotId: target.nodeId },
    previous: { taskId: target.id, slotId: target.nodeId, binding: 'provider:' + 'b'.repeat(64), requestHash: 'c'.repeat(64) },
    prepare: () => { throw Error('禁止准备'); }, bind: () => { throw Error('禁止绑定'); }, recordTask: () => { throw Error('禁止新任务'); },
    applyAndSave: async () => { order.push('save:' + target.nodeId); } });
  const a = start(first); await entered.promise; const b = start(second); await new Promise(done => setImmediate(done));
  if (runner === originalRunner) assert.deepEqual(order, ['save:node-A', 'checkpoint:node-A', 'save:node-B', 'checkpoint:node-B', 'applied:node-B']);
  else assert.deepEqual(order, ['save:node-A', 'checkpoint:node-A']);
  blocked.resolve(); await Promise.all([a, b]);
  if (runner !== originalRunner) assert.deepEqual(order, ['save:node-A', 'checkpoint:node-A', 'applied:node-A', 'save:node-B', 'checkpoint:node-B', 'applied:node-B']);
});

for (const fragmented of [false, true]) test('真实临时SQLite/' + (fragmented ? '分片' : '内联') + '：画布ACK故障后原任务确认，冷重开仍applied且渠道仅一次', async () => {
  const f = await generationFixture(); let tasks, reopened;
  try {
    await f.tasks.close();
    const verifyApplied = createSavedCanvasVerifier({ workspace: f.workspace });
    tasks = await openGenerationTasks({ workspace: f.workspace, gateway: f.gateway, coordinator: f.coordinator, verifyApplied });
    const checkpoint = createCanvasCheckpointReader({ workspace: f.workspace, tasks });
    const binding = await f.bind(), input = f.submit(binding.binding); await tasks.submit(input); await tasks.drain();
    const job = tasks.get(input.id), target = { id: job.id, productId: job.productId, nodeId: job.nodeId, responseHash: job.result.id }, calls = [];
    let staleOnce = true;
    const host = createGenerationClient({ async command(value) {
      calls.push(value.operation);
      if (value.operation === 'applied' && staleOnce) {
        staleOnce = false;
        const rootId = 'app-' + createHash('sha256').update('app_state').digest('hex'), before = f.workspace.readDocument('extension', rootId);
        f.workspace.writeDocument({ collection: 'extension', id: rootId, value: { ...before.value, syntheticRevision: 1 }, expectedRevision: before.revision, operationId: randomUUID() });
      }
      const result = value.operation === 'list' ? tasks.list(value.productId) : value.operation === 'get' ? tasks.get(value.id) : value.operation === 'checkpoint' ? await checkpoint(value.id) : value.operation === 'applied' ? await tasks.confirmApplied(value.id, value.checkpoint) : assert.fail('禁止恢复调用 ' + value.operation);
      return { protocol, result };
    } });
    const rootId = 'app-' + createHash('sha256').update('app_state').digest('hex');
    const codec = createValueCodec({ client: {} }); let failACK = true;
    const recovery = createImageConfirmationRecovery({ host, targets: [target], serialize: serializeProductResult, async save() {
      const value = { state: { projects: [{ id: job.productId, nodes: [{ id: job.nodeId, type: 'image', metadata: { status: 'success', gatewayGenerationReceipts: [{ taskId: job.id, responseHash: job.result.id }] } }] }] } };
      const encoded = await codec.encode(value), entries = [['infinite-canvas:canvas_store', encoded]];
      let root = { format: 'guan-app-storage.v1', namespace: 'app_state', entries };
      if (fragmented) {
        const plan = await buildFragmentPlan(entries);
        for (const fragment of plan.fragments.values()) if (!f.workspace.readDocument('extension', fragment.id)) f.workspace.writeDocument({ collection: 'extension', id: fragment.id, value: fragment.value, expectedRevision: 0, operationId: randomUUID() });
        root = { format: 'guan-app-storage.v2', namespace: 'app_state', entryCount: 1, head: plan.head };
      }
      const before = f.workspace.readDocument('extension', rootId);
      f.workspace.writeDocument({ collection: 'extension', id: rootId, value: root, expectedRevision: before?.revision || 0, operationId: randomUUID() });
      if (failACK) throw Error('synthetic-canvas-saved-ACK-lost');
    } });
    assert.deepEqual((await recovery.run()).pending, [job.id]); assert.equal(tasks.get(job.id).applied, false);
    assert.ok(f.workspace.readDocument('extension', rootId)); failACK = false;
    assert.deepEqual((await recovery.run()).pending, [job.id]); assert.equal(tasks.get(job.id).applied, false);
    assert.equal((await recovery.run()).pending.length, 0); assert.equal(tasks.get(job.id).applied, true); assert.equal(f.requests.length, 1);
    const media = tasks.result(job.id); await tasks.close(); f.vault.close(); f.workspace.close();
    reopened = openWorkspace({ dataRoot: f.dataRoot, initialize: false });
    tasks = await openGenerationTasks({ workspace: reopened, gateway: f.gateway, coordinator: f.coordinator, verifyApplied: createSavedCanvasVerifier({ workspace: reopened }) });
    assert.equal(tasks.get(job.id).applied, true); assert.deepEqual(tasks.result(job.id).bytes, media.bytes);
    assert.ok(calls.every(value => ['list', 'get', 'checkpoint', 'applied'].includes(value))); assert.equal(f.requests.length, 1);
  } finally { await tasks?.close(); reopened?.close(); await f.close(); }
});

function renderFunction(path, name, globals) {
  const code = source(path), file = ts.createSourceFile(path, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declaration = file.statements.find(item => ts.isFunctionDeclaration(item) && item.name?.text === name);
  assert.ok(declaration);
  const exports = {}, output = ts.transpileModule(declaration.getText(file), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const jsx = (type, props) => ({ type, props });
  vm.runInNewContext(output, { exports, require: value => { assert.equal(value, 'react/jsx-runtime'); return { jsx, jsxs: jsx }; }, ...globals });
  return exports[name];
}
test('设置弹窗使用公开容器及语义样式，按实际画布72%计算，保留全页独立入口', () => {
  const container = {}, state = { isConfigOpen: true, configTab: 'fallback', setConfigDialogOpen() {} };
  const render = viewport => renderFunction('components/layout/app-config-modal.tsx', 'AppConfigModal', { useSettingsViewport: () => viewport, useTranslation: () => ({ t: value => value }), useConfigStore: read => read(state), Modal: 'Modal', AppConfigPanel: 'Panel' })();
  const scoped = render(container).props, standalone = render(null).props;
  assert.equal(scoped.getContainer, container); assert.equal(scoped.styles.body.height, '72cqh'); assert.equal(scoped.styles.body.maxHeight, '72cqh');
  for (const part of ['root', 'wrapper', 'mask']) assert.equal(scoped.styles[part].position, 'absolute');
  assert.equal(scoped.width, 980); assert.equal(scoped.centered, true); assert.equal(scoped.children.props.initialTab, 'fallback');
  assert.equal(standalone.getContainer, undefined); assert.equal(standalone.styles.body.height, '72vh');
  const viewportCode = source('guan/设置视区.tsx'); assert.match(viewportCode, /containerType: "size"/); assert.doesNotMatch(viewportCode, /querySelector|document\.|ResizeObserver/);
  const layout = source('layouts/user-layout.tsx'), header = source('guan/旧版首页顶栏.tsx');
  assert.match(layout, /<LegacyHomeChrome \/>[\s\S]*<SettingsViewport>\{children\}<AppConfigModal \/><\/SettingsViewport>/); assert.doesNotMatch(header, /AppConfigModal/);
  assert.equal(preview.delta.size, 9);
});
