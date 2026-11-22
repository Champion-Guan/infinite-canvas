import assert from 'node:assert/strict';
import test from 'node:test';
import { variantModules } from './产品变体生成夹具.mjs';

const { buildCanvasNodeRenderDependencies, reuseCanvasResourceReferences } = variantModules()
  .load('画布交互/画布节点渲染依赖.ts');

test('参数变体更新只使关联提示词卡和下游配置卡的渲染依赖失效', () => {
  const parameter = { id: 'parameter', type: 'guan:prompt-variables', metadata: { productVariants: [] } };
  const prompt = { id: 'prompt', type: 'guan:product-prompt', metadata: { productImagePrompt: { parameterId: parameter.id } } };
  const config = { id: 'config', type: 'config', metadata: {} };
  const unrelated = { id: 'unrelated', type: 'image', metadata: {} };
  const nodes = [parameter, prompt, config, unrelated];
  const connections = [{ id: 'prompt-config', fromNodeId: prompt.id, toNodeId: config.id }];
  const before = buildCanvasNodeRenderDependencies(nodes, connections);

  const changedParameter = { ...parameter, metadata: { productVariants: [{ id: 'red', enabled: false }] } };
  const after = buildCanvasNodeRenderDependencies([changedParameter, prompt, config, unrelated], connections, before);

  assert.notEqual(after.get(prompt.id), before.get(prompt.id));
  assert.notEqual(after.get(config.id), before.get(config.id));
  assert.equal(after.has(unrelated.id), false);
  assert.equal(after.get(prompt.id)[0], changedParameter);
  assert.deepEqual(after.get(config.id), [prompt, changedParameter]);
});

test('无关画布更新保留现有节点渲染依赖引用', () => {
  const parameter = { id: 'parameter', type: 'guan:prompt-variables', metadata: {} };
  const prompt = { id: 'prompt', type: 'guan:product-prompt', metadata: { productImagePrompt: { parameterId: parameter.id } } };
  const unrelated = { id: 'unrelated', type: 'image', metadata: {} };
  const nodes = [parameter, prompt, unrelated];
  const before = buildCanvasNodeRenderDependencies(nodes, []);
  const changedUnrelated = { ...unrelated, metadata: { content: 'new image' } };
  const after = buildCanvasNodeRenderDependencies([parameter, prompt, changedUnrelated], [], before);

  assert.equal(after.get(prompt.id), before.get(prompt.id));
  assert.equal(after.has(unrelated.id), false);
});

test('提示词引用内容未变化时保留引用数组，避免无关节点重复渲染', () => {
  const before = [{ id: 'image', nodeId: 'image', kind: 'image', label: '图片1', title: '正面图', active: true }];
  const same = before.map(item => ({ ...item }));
  const changed = [{ ...same[0], title: '新图片名' }];

  assert.equal(reuseCanvasResourceReferences(before, same), before);
  assert.equal(reuseCanvasResourceReferences(before, changed), changed);
  assert.equal(reuseCanvasResourceReferences(before, [] ).length, 0);
});
