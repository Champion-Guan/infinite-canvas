import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { transformWithEsbuild } from '../.运行/3100源/画布副本/web/node_modules/vite/dist/node/index.js';
import { createImageConfirmationRecovery, imageConfirmationErrorKey, imageConfirmationTargets } from '../扩展功能/画布生成/图片任务确认恢复.mjs';

const digest = 'a'.repeat(64), productId = 'product-A';
const targets = Array.from({ length: 3 }, (_, index) => ({ id: 'task-' + index, productId, nodeId: 'node-' + index, responseHash: digest }));
function hostFixture() {
  const jobs = targets.map(target => ({ ...target, state: 'succeeded', applied: false, result: { id: digest } }));
  let lists = 0, confirmations = 0;
  return { jobs, calls: () => ({ lists, confirmations }), host: {
    async list() { lists++; return structuredClone(jobs); },
    async confirmSaved(target) { confirmations++; jobs.find(job => job.id === target.id).applied = true; },
  } };
}

test('整批三个成功任务共用一次保存；保存失败不确认原任务，重试沿用同一批次', async () => {
  const f = hostFixture(); let failSave = true, saves = 0;
  const recovery = createImageConfirmationRecovery({ host: f.host, targets, serialize: (_id, operation) => operation(), async save() {
    saves++;
    if (failSave) { const error = Error('素材校验失败'); error.code = 'invalid_media'; throw error; }
  } });
  const failed = await recovery.run();
  assert.deepEqual(failed.pending, targets.map(target => target.id));
  assert.deepEqual(failed.failures, targets.map(target => ({ id: target.id, phase: 'save', code: 'invalid_media' })));
  assert.equal(saves, 1); assert.equal(f.calls().confirmations, 0); assert.ok(f.jobs.every(job => !job.applied));
  failSave = false;
  const retried = await recovery.run();
  assert.deepEqual(retried.pending, []); assert.equal(saves, 2); assert.equal(f.calls().confirmations, 3);
  assert.ok(f.jobs.every(job => job.applied));
});

test('批量门控期间不确认任务，最终画布持久ACK后恰确认一次', async () => {
  const f = hostFixture(); let release;
  const finalSave = new Promise(resolve => { release = resolve; });
  const recovery = createImageConfirmationRecovery({
    host: f.host, targets,
    serialize: (_id, operation) => operation(),
    save: async () => ({ persisted: false, deferred: true }),
    waitForBatchSave: () => finalSave,
  });
  const running = recovery.run();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.calls().confirmations, 0, '批量最终保存未确认前不得确认任务');
  release('saved');
  const result = await running;
  assert.deepEqual(result.pending, []);
  assert.equal(f.calls().confirmations, targets.length, '最终ACK后每个原任务只确认一次');
  assert.equal(f.calls().confirmations, 3);
});

test('保存调用返回deferred时不得把空返回当作持久ACK', async () => {
  const f = hostFixture();
  const recovery = createImageConfirmationRecovery({
    host: f.host, targets,
    serialize: (_id, operation) => operation(),
    save: async () => ({ persisted: false, deferred: true }),
  });
  const result = await recovery.run();
  assert.deepEqual(result.pending, targets.map(target => target.id));
  assert.equal(f.calls().confirmations, 0);
  assert.ok(result.failures.every(failure => failure.code === 'batch_save_deferred'));
});

test('重试暴露查询、保存、确认阶段；共享段不重复确认已成功任务', async () => {
  const f = hostFixture(), phases = [];
  const recovery = createImageConfirmationRecovery({ host: f.host, targets, serialize: (_id, operation) => operation(),
    save: async () => {}, onProgress: value => phases.push(value.phase) });
  assert.deepEqual((await recovery.run()).pending, []);
  for (const phase of ['task-list', 'scope', 'save', 'confirm', 'cleanup']) assert.ok(phases.includes(phase), phase);
  const count = f.calls(); await recovery.run();
  assert.deepEqual(f.calls(), count);
});

test('只对原卡片现存任务和收据重试，不从失败状态推导新任务', () => {
  const nodes = targets.map(target => ({ id: target.nodeId, type: 'image', metadata: {
    gatewayGenerationTasks: [{ taskId: target.id, slotId: 'slot' }],
    gatewayGenerationReceipts: [{ taskId: target.id, responseHash: digest }],
    images: [{ id: 'slot', status: 'success', errorDetails: 'invalid_media' }],
  } }));
  assert.deepEqual(imageConfirmationTargets(productId, nodes), targets);
  assert.match(imageConfirmationErrorKey(nodes), /invalid_media/);
});

test('重试任务确认按钮会调用同一恢复器，且素材保存失败有明确提示', async () => {
  const path = '../扩展功能/画布生成/图片任务确认状态.tsx';
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const { code } = await transformWithEsbuild(source, path, { loader: 'tsx', jsx: 'automatic', format: 'cjs', target: 'es2022', tsconfigRaw: '{}' });
  const hooks = [], effects = []; let cursor = 0;
  const useState = initial => { const index = cursor++; if (!(index in hooks)) hooks[index] = initial; return [hooks[index], value => { hooks[index] = typeof value === 'function' ? value(hooks[index]) : value; }]; };
  const useRef = initial => { const index = cursor++; return hooks[index] ||= { current: initial }; };
  const jsx = (type, props) => ({ type, props });
  const module = { exports: {} }, target = targets[0], f = hostFixture(); let saves = 0;
  const browser = { __guanGenerationHost: f.host, addEventListener() {}, removeEventListener() {} };
  const node = { id: target.nodeId, type: 'image', metadata: {
    gatewayGenerationTasks: [{ taskId: target.id, slotId: 'slot' }],
    gatewayGenerationReceipts: [{ taskId: target.id, responseHash: digest }],
  } };
  const save = async () => {
    saves++;
    if (saves === 1) { const error = Error('素材校验失败'); error.code = 'invalid_media'; throw error; }
  };
  const useMemo = (factory, deps) => { const index = cursor++, old = hooks[index]; if (!old || JSON.stringify(old.deps) !== JSON.stringify(deps)) hooks[index] = { deps, value: factory() }; return hooks[index].value; };
  const useEffect = effect => effects.push(effect);
  new Function('require', 'module', 'exports', 'window', code)(id => {
    if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (id === 'react') return { useEffect, useMemo, useRef, useState };
    if (id === '../存储界面/状态通知区') return { LocalStatusNotice: 'Notice' };
    if (id === '../产品/产品操作') return { saveProductCanvas: save };
    if (id === '../本机存储/上游浏览器存储桥') return { storageStatus: () => ({ state: 'error', pending: true, retrying: false }) };
    if (id === './图片任务衔接.mjs') return { serializeProductResult: (_id, operation) => operation() };
    if (id === './图片任务确认恢复.mjs') return { createImageConfirmationRecovery, imageConfirmationTargets, imageConfirmationErrorKey };
    if (id === './批量保存协调') return { waitForBatchCanvasSave: () => null };
    if (id === '../产品/画布驻留保护') return { productCanvasResidency: { run: (_id, operation) => operation() } };
    throw Error('未声明测试依赖：' + id);
  }, module, module.exports, browser);
  const flatten = value => !value || typeof value !== 'object' ? [] : [value, ...[].concat(value.props?.children || []).flatMap(flatten)];
  const render = () => { cursor = 0; return module.exports.ImageTaskConfirmation({ productId, nodes: [node], ready: true, afterConfirmed: async () => {} }); };
  render(); for (const effect of effects) effect(); await new Promise(resolve => setImmediate(resolve));
  let tree = render(), button = flatten(tree).find(item => item.type === 'button');
  assert.ok(button); assert.equal(button.props.disabled, false);
  tree = render();
  assert.equal(f.calls().lists, 1); assert.equal(saves, 1); assert.equal(f.calls().confirmations, 0);
  const alert = flatten(tree).find(item => item.props?.role === 'alert');
  assert.match(alert.props.children, /invalid_media/);
  button = flatten(tree).find(item => item.type === 'button'); assert.ok(button); assert.equal(button.props.disabled, false);
  button.props.onClick(); await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve));
  tree = render();
  assert.equal(f.calls().lists, 2); assert.equal(saves, 2); assert.equal(f.calls().confirmations, 1);
  assert.equal(flatten(tree).some(item => item.type === 'button'), false, '确认成功后重试状态关闭');
});
