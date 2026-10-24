import test from 'node:test';
import assert from 'node:assert/strict';
import { editFallback, emptyFallback, reconcileFallback } from '../扩展功能/故障切换/原版策略.mjs';
import { defaultModelOrder } from '../扩展功能/故障切换/模型默认排序.mjs';
import { validateFallback, createFallbackStore } from '../扩展功能/故障切换/SQLite切换配置.mjs';
import { generationFixture } from './生成网关隔离夹具.mjs';
const profiles = [
  { id: 'A', models: [{ name: 'gpt-image-2', capability: 'image', price: 1 }, { name: 'gpt-image-2.5', capability: 'image', price: 5 }, { name: 'text-A', capability: 'text' }] },
  { id: 'B', models: [{ name: 'gpt-image-2.5', capability: 'image', price: 2 }] },
];
const action = (state, type, rest = {}) => editFallback(state, profiles, { type, capability: 'image', ...rest });
const order = state => state.capabilities.image.entries.map(entry => [entry.modelName, entry.profileId]);
test('旧数据无需迁移即可读取；默认版本优先和同模型低价优先', () => {
  const state = action(emptyFallback(), 'reset'); validateFallback(state);
  assert.equal(Object.hasOwn(state.capabilities.image, 'modelOrder'), false);
  assert.deepEqual(order(state), [['gpt-image-2.5', 'B'], ['gpt-image-2.5', 'A'], ['gpt-image-2', 'A']]);
});
test('自定义新旧排序应用到全部渠道，保留开关，重置恢复自定义顺序', () => {
  let state = action(emptyFallback(), 'group', { enabled: true });
  state = action(state, 'model-order', { order: ['gpt-image-2', 'gpt-image-2.5'] }); validateFallback(state);
  assert.deepEqual(order(state), [['gpt-image-2', 'A'], ['gpt-image-2.5', 'B'], ['gpt-image-2.5', 'A']]);
  const saved = structuredClone(state);
  state = action(state, 'move', { index: 2, direction: -1 });
  state = action(state, 'reset'); assert.deepEqual(state, saved);
  assert.equal(state.enabled, true); assert.ok(state.capabilities.image.entries.every(e => e.enabled));
});
test('能力互不影响，关闭总开关及增删渠道后仍保留排序规则', () => {
  let state = action(emptyFallback(), 'model-order', { order: ['gpt-image-2', 'gpt-image-2.5', '未来模型'] });
  state = action(state, 'global', { enabled: false }); validateFallback(state);
  assert.deepEqual(state.capabilities.image.modelOrder, ['gpt-image-2', 'gpt-image-2.5', '未来模型']);
  assert.equal(Object.hasOwn(state.capabilities.text, 'modelOrder'), false);
  const changed = reconcileFallback(state, [profiles[0]]);
  assert.deepEqual(changed.capabilities.image.modelOrder, state.capabilities.image.modelOrder);
  assert.deepEqual(defaultModelOrder(changed.capabilities.image.entries, changed.capabilities.image.modelOrder), ['gpt-image-2', 'gpt-image-2.5']);
});
test('排序不接受重复、超长、控制字符、对象和未声明字段', () => {
  for (const invalid of [['a', 'a'], ['bad\nname'], ['x'.repeat(201)], [null], {}, Array.from({ length: 513 }, (_, i) => String(i))]) {
    const state = emptyFallback(); state.capabilities.image.modelOrder = invalid;
    assert.throws(() => validateFallback(state));
    assert.throws(() => action(emptyFallback(), 'model-order', { order: invalid }));
  }
  const extra = emptyFallback(); extra.capabilities.image.unknown = [];
  assert.throws(() => validateFallback(extra));
});
test('真实SQLite保留排序，重开可读；旧revision不能覆盖已保存配置', async () => {
  const fixture = await generationFixture();
  try {
    const make = () => createFallbackStore({ workspace: fixture.workspace, runTrustedWrite: job => fixture.coordinator.runWrite(job) });
    const state = action(emptyFallback(), 'model-order', { order: ['gpt-image-2', 'gpt-image-2.5'] });
    const ack = await make().save(state, 0); assert.equal(ack.revision, 1);
    assert.deepEqual(make().read().value, state);
    await assert.rejects(make().save(emptyFallback(), 0));
    assert.deepEqual(make().read().value, state);
  } finally { await fixture.close(); }
});
