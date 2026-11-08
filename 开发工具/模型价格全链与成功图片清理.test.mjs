// 七文件后继，来源 开发工具/模型价格与成功图片清理.test.mjs SHA256 202b5aedd4e5c0cc6ab0e345caf0a01b8fd48224301880b50f928c8e92d023e9；原测试保持。
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ts } from './检查首批功能适配.mjs';
import { 构建模型价格全链与成功图片清理候选 } from './预审模型价格全链与成功图片清理.mjs';
import { clearConfirmedImageErrors, createImageConfirmationRecovery, imageConfirmationErrorKey } from '../扩展功能/画布生成/图片任务确认恢复与清理.mjs';
import { editFallback, emptyFallback } from '../扩展功能/故障切换/原版策略.mjs';

const preview = 构建模型价格全链与成功图片清理候选();
const source = path => preview.delta.get('画布副本/web/src/' + path)?.产物 ?? readFileSync(join(preview.integration.副本, 'web/src', path), 'utf8');
const { createGenerationClient } = await import(pathToFileURL(join(preview.integration.副本, 'web/src/guan/generation/生成任务客户端.mjs')).href);
const { serializeProductResult } = await import(pathToFileURL(join(preview.integration.副本, 'web/src/guan/generation/图片任务衔接.mjs')).href);
const plain = value => JSON.parse(JSON.stringify(value));
function evaluate(code, globals = {}, tail = '') {
  const module = { exports: {} };
  const output = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(output + '\n' + tail, { module, exports: module.exports, ...globals });
  return module.exports;
}
function declaration(path, name, callback = false) {
  const parsed = ts.createSourceFile(path, source(path), ts.ScriptTarget.Latest, true, path.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found = [];
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found.push(node.getText(parsed));
    if (ts.isVariableDeclaration(node) && node.name.getText(parsed) === name) found.push('const ' + name + ' = ' + (callback ? node.initializer.arguments[0] : node.initializer).getText(parsed) + ';');
    ts.forEachChild(node, visit);
  }
  visit(parsed); assert.equal(found.length, 1, name); return found[0];
}
const storePath = 'stores/use-config-store.ts';
const storeHelpers = ['VIDEO_KEYWORDS', 'AUDIO_KEYWORDS', 'IMAGE_KEYWORDS', 'guessCapability', 'normalizeChannelModels'];
const store = evaluate(storeHelpers.map(name => declaration(storePath, name)).join('\n'));
function selection(channel, prices, selected = channel.models.map(model => model.name), fetched = []) {
  let received, closed = 0;
  const f = evaluate(declaration('components/layout/model-select-modal.tsx', 'confirm'), {
    channel, prices, selected: new Set(selected), fetched, existing: channel.models.map(model => model.name),
    guessCapability: store.guessCapability, onConfirm: models => { received = models; }, onClose: () => { closed++; },
  }, 'exports.confirm = confirm;');
  f.confirm(); assert.equal(closed, 1); return received;
}
function applySelection(draft, models) {
  let result;
  const f = evaluate(declaration('components/layout/channel-editor-drawer.tsx', 'applySelection'), {
    draft, guessCapability: store.guessCapability, setModels: value => { result = value; },
  }, 'exports.apply = applySelection;');
  f.apply(models); return result;
}
test('选择确认可修改/清空已有价格，并保留脚本与能力；新增模型不丢价格', () => {
  const channel = { models: [{ name: 'A', capability: 'audio', script: 'legacy', price: 9 }, { name: 'B', capability: 'text', price: 8 }] };
  const models = selection(channel, { A: 0.123456, B: undefined, C: 2.5 }, ['A', 'B', 'C'], ['C', 'A']);
  const applied = applySelection(channel, models), normalized = plain(store.normalizeChannelModels(applied));
  assert.deepEqual(normalized, [{ name: 'A', capability: 'audio', script: 'legacy', price: 0.123456 }, { name: 'B', capability: 'text' }, { name: 'C', capability: 'text', price: 2.5 }]);
  assert.equal(channel.models[0].price, 9); assert.equal(channel.models[1].price, 8);
});
test('取消勾选按旧顺序移除，未改价格继续保留；重新确认不会复活清空的价格', () => {
  const channel = { models: [{ name: 'A', capability: 'image', price: 1 }, { name: 'B', capability: 'text', price: 2 }] };
  const once = applySelection(channel, selection(channel, { A: 1, B: undefined }, ['B']));
  assert.deepEqual(plain(store.normalizeChannelModels(once)), [{ name: 'B', capability: 'text' }]);
  const next = { models: store.normalizeChannelModels(once) };
  assert.deepEqual(plain(store.normalizeChannelModels(applySelection(next, selection(next, { B: undefined })))), [{ name: 'B', capability: 'text' }]);
});
test('旧版规范化语义：零值视为未定价，有限小数保存，空值/非数值不保存，按首次名称去重', () => {
  const normalized = store.normalizeChannelModels([{ name: 'zero', price: 0 }, { name: 'small', price: 0.000001 }, { name: 'nil', price: null }, { name: 'nan', price: NaN }, { name: 'infinite', price: Infinity }, 'text-model', { name: ' small ', price: 99 }, { name: ' ', price: 10 }]);
  assert.deepEqual(plain(normalized).map(model => [model.name, model.price]), [['zero', undefined], ['small', 0.000001], ['nil', undefined], ['nan', undefined], ['infinite', undefined], ['text-model', undefined]]);
  assert.deepEqual(plain(store.normalizeChannelModels(plain(normalized))), plain(normalized));
});
test('保存模型经JSON冷读和真实normalizeChannels后保留价格与凭据引用', () => {
  const code = [...storeHelpers, 'normalizeApiFormat', 'defaultBaseUrlForApiFormat', 'createModelChannel', 'normalizeChannels'].map(name => declaration(storePath, name)).join('\n');
  const api = evaluate(code, { defaultConfig: { channels: [] }, i18n: { t: key => key }, nanoid: () => 'synthetic', OPENAI_BASE_URL: 'https://api.example.test', GEMINI_BASE_URL: 'https://gemini.example.test' }, 'exports.normalizeChannels = normalizeChannels;');
  const config = { channelMode: 'local', channels: [{ id: 'A', name: '合成渠道', baseUrl: 'https://api.example.test', apiKey: 'secret:synthetic', apiFormat: 'openai', models: [{ name: 'test-image', capability: 'image', price: 0.123456 }] }] };
  const cold = api.normalizeChannels(JSON.parse(JSON.stringify(config)));
  assert.equal(cold[0].models[0].price, 0.123456); assert.equal(cold[0].apiKey, 'secret:synthetic');
});
test('原Fallback重置排序读到迁入价格，版本优先、同版本低价优先，手动顺序不变', () => {
  const profiles = [{ id: 'expensive', models: store.normalizeChannelModels([{ name: 'gpt-image-2', capability: 'image', price: 9 }]) }, { id: 'cheap', models: store.normalizeChannelModels([{ name: 'gpt-image-2', capability: 'image', price: 1 }]) }, { id: 'version', models: store.normalizeChannelModels([{ name: 'gpt-image-2.5', capability: 'image', price: 99 }]) }];
  const enabled = editFallback(emptyFallback(), profiles, { type: 'group', capability: 'image', enabled: true });
  const reset = editFallback(enabled, profiles, { type: 'reset', capability: 'image' });
  assert.deepEqual(reset.capabilities.image.entries.map(item => item.profileId), ['version', 'cheap', 'expensive']);
  assert.deepEqual(enabled.capabilities.image.entries.map(item => item.profileId), ['expensive', 'cheap', 'version']);
});
const responseHash = 'a'.repeat(64);
const target = { id: 'aaaaaaaa-1111-4444-8888-000000000001', productId: 'product-A', nodeId: 'node-A', responseHash };
function nodesFixture() {
  return [{ id: 'node-A', type: 'image', metadata: { errorDetails: '保留节点错误', primaryImageId: 'slot-A', gatewayGenerationTasks: [{ taskId: target.id, slotId: 'slot-A' }], gatewayGenerationReceipts: [{ taskId: target.id, responseHash }], images: [{ id: 'slot-A', status: 'success', content: 'blob:synthetic', storageKey: 'image:synthetic', bytes: 1089, errorDetails: '保存响应未确认' }, { id: 'slot-B', status: 'error', errorDetails: '另一张失败' }] } }, { id: 'node-B', type: 'image', metadata: { images: [{ id: 'slot-A', status: 'success', content: 'blob:other', errorDetails: '其他卡片错误' }] } }];
}
test('成功清理只改原槽位错误，媒体/身份/失败槽位和其他节点保持', () => {
  const nodes = nodesFixture(), before = structuredClone(nodes), result = clearConfirmedImageErrors(nodes, target);
  assert.equal(result[0].metadata.images[0].errorDetails, undefined);
  assert.equal(result[0].metadata.errorDetails, '保留节点错误');
  assert.equal(result[0].metadata.images[1], nodes[0].metadata.images[1]); assert.equal(result[1], nodes[1]);
  const expected = structuredClone(before); delete expected[0].metadata.images[0].errorDetails;
  assert.deepEqual(plain(result), expected); assert.deepEqual(nodes, before);
  assert.equal(clearConfirmedImageErrors(result, target), result);
});
for (const [label, change] of [
  ['原任务已被替换', nodes => { nodes[0].metadata.gatewayGenerationTasks[0].taskId = 'new'; }],
  ['收据不同', nodes => { nodes[0].metadata.gatewayGenerationReceipts[0].responseHash = 'b'.repeat(64); }],
  ['任务重复', nodes => { nodes[0].metadata.gatewayGenerationTasks.push(nodes[0].metadata.gatewayGenerationTasks[0]); }],
  ['收据重复', nodes => { nodes[0].metadata.gatewayGenerationReceipts.push(nodes[0].metadata.gatewayGenerationReceipts[0]); }],
  ['槽位重复', nodes => { nodes[0].metadata.images.push(nodes[0].metadata.images[0]); }],
  ['图片仍失败', nodes => { nodes[0].metadata.images[0].status = 'error'; }],
  ['无媒体落盘', nodes => { delete nodes[0].metadata.images[0].storageKey; }],
]) test('不清理：' + label, () => {
  const nodes = nodesFixture(); change(nodes); assert.equal(clearConfirmedImageErrors(nodes, target), nodes);
});
function cleanupCallback(nodes = nodesFixture()) {
  const nodesRef = { current: nodes }, pendingImageErrorSaves = { current: new Set() }; let saves = 0, fail = false;
  const api = evaluate(declaration('pages/canvas/project.tsx', 'clearConfirmedImageError', true), {
    nodesRef, pendingImageErrorSaves, projectId: target.productId, restoredProjectIdRef: { current: target.productId }, clearConfirmedImageErrors,
    setNodes: next => { nodesRef.current = next; }, async saveProductCanvas() { saves++; if (fail) throw Error('synthetic-cleanup-save-failure'); },
  }, 'exports.clear = clearConfirmedImageError;');
  return { clear: api.clear, nodesRef, saves: () => saves, fail: value => { fail = value; } };
}
function recoveryFixture(callback) {
  const job = { id: target.id, productId: target.productId, nodeId: target.nodeId, state: 'succeeded', applied: false, result: { id: responseHash } }, calls = [];
  let failure;
  const host = createGenerationClient({ async command(value) {
    calls.push(value.operation); if (failure === value.operation) throw Error('synthetic-' + failure);
    let result;
    if (value.operation === 'list') result = [structuredClone(job)];
    else if (value.operation === 'get') result = structuredClone(job);
    else if (value.operation === 'checkpoint') result = { rootRevision: 1, rootHash: 'b'.repeat(64) };
    else if (value.operation === 'applied') { job.applied = true; if (failure === 'applied-ack') throw Error('synthetic-lost-ack'); result = structuredClone(job); }
    else assert.fail('禁止提交、读取结果或渠道请求');
    return { protocol: 'guan-generation.v1', result };
  } });
  const recovery = createImageConfirmationRecovery({ host, targets: [target], serialize: serializeProductResult,
    save: async () => { if (failure === 'save') throw Error('synthetic-save-failure'); }, afterConfirmed: callback });
  return { recovery, job, calls, fail: value => { failure = value; } };
}
for (const phase of ['list', 'save', 'get', 'checkpoint', 'applied', 'applied-ack']) test('确认' + phase + '失败不提前清理；恢复只确认原任务后保存清理', async () => {
  const c = cleanupCallback(), f = recoveryFixture(c.clear); f.fail(phase);
  assert.deepEqual((await f.recovery.run()).pending, [target.id]);
  assert.equal(c.nodesRef.current[0].metadata.images[0].errorDetails, '保存响应未确认'); assert.equal(c.saves(), 0);
  f.fail(undefined); assert.deepEqual((await f.recovery.run()).pending, []);
  assert.equal(c.nodesRef.current[0].metadata.images[0].errorDetails, undefined); assert.equal(c.saves(), 1); assert.equal(f.job.applied, true);
  assert.ok(f.calls.every(value => ['list', 'get', 'checkpoint', 'applied'].includes(value)));
});
test('清理保存失败后仍待确认；即使内存已清理，重试仍保存，不重发applied', async () => {
  const c = cleanupCallback(), f = recoveryFixture(c.clear); c.fail(true);
  assert.deepEqual((await f.recovery.run()).pending, [target.id]); assert.equal(f.job.applied, true); assert.equal(c.saves(), 1);
  c.fail(false); assert.deepEqual((await f.recovery.run()).pending, []); assert.equal(c.saves(), 2);
  assert.equal(f.calls.filter(value => value === 'applied').length, 1);
});
test('冷重开已确认且无残留错误不重写画布；异步新错误改变恢复键', async () => {
  const clean = clearConfirmedImageErrors(nodesFixture(), target), c = cleanupCallback(clean), f = recoveryFixture(c.clear); f.job.applied = true;
  assert.deepEqual((await f.recovery.run()).pending, []); assert.equal(c.saves(), 0); assert.deepEqual(f.calls, ['list']);
  assert.notEqual(imageConfirmationErrorKey(clean), imageConfirmationErrorKey(nodesFixture()));
  const cold = recoveryFixture(cleanupCallback(nodesFixture()).clear); cold.job.applied = true;
  assert.deepEqual((await cold.recovery.run()).pending, []); assert.deepEqual(cold.calls, ['list']);
});
test('产品切换后不改其他产品，不保存；并发确认合并同一次恢复', async () => {
  const c = cleanupCallback(); await c.clear({ ...target, productId: 'other-product' }); assert.equal(c.saves(), 0);
  const f = recoveryFixture(c.clear), first = f.recovery.run(), second = f.recovery.run(); assert.equal(first, second); await first; assert.equal(c.saves(), 1);
});
