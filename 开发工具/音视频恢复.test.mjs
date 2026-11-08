import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { 生成音视频恢复候选 } from './预审音视频恢复.mjs';
import { ts } from './检查首批功能适配.mjs';
import { 运行目录 } from './检查运行副本.mjs';
import { 策略产物, 设置产物 } from '../上游适配/音视频恢复.mjs';
import { 合并恢复历史映射 } from '../上游适配/音视频提示词与节点信息恢复批准.mjs';
import { 哈希 } from './检查运行副本.mjs';
import { 生成精简主题候选 } from './预审精简离线与三态主题.mjs';

const files = 生成音视频恢复候选();
function load(text) {
  const module = { exports: {} };
  const result = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  new vm.Script(result.outputText).runInNewContext({ module, exports: module.exports });
  return module.exports;
}
const policy = load(files.get(策略产物).产物);
const oldPolicy = load(files.get(策略产物).原文);
const formKeys = ['videoResolution', 'audioVoice', 'audioFormat', 'audioSpeed', 'audioInstructions'];

test('早期两文件候选不接入；历史前态或精确合并后继均可核验', () => {
  assert.deepEqual([...files.keys()], [策略产物, 设置产物]);
  const successor = 合并恢复历史映射(运行目录);
  for (const [path, item] of files) assert.equal(successor.get(path)?.原始SHA256 ?? 哈希(readFileSync(join(运行目录, path))), 哈希(item.原文));
});

test('图片/文本/视频/音频全部开放；未知生成模式仍拒绝', () => {
  for (const mode of ['image', 'text', 'video', 'audio']) {
    assert.equal(policy.isGenerationModeEnabled(mode), true);
    assert.doesNotThrow(() => policy.requireGenerationMode(mode));
  }
  for (const mode of ['', 'unknown', 'script']) assert.throws(() => policy.requireGenerationMode(mode), { code: 'product_feature_disabled' });
});

test('S06/C15/超分/提示词联网仍拒绝；S03和来源调度模块未改', () => {
  for (const key of Object.keys(oldPolicy.auxiliaryFeatures)) {
    assert.equal(policy.auxiliaryFeatures[key], false);
    assert.throws(() => policy.requireAuxiliaryFeature(key), { code: 'product_feature_disabled' });
  }
  assert.deepEqual(Array.from(policy.closedFeatureIds), ['S06', 'C15', 'AI超分占位']);
  assert.equal(Object.isFrozen(policy.auxiliaryFeatures), true);
  assert.equal(files.has('web/src/guan/脚本与提示词来源.ts'), false);
  assert.equal(files.has('web/src/hooks/use-prompt-source-scheduler.ts'), false);
});

test('离线提示词读取投影保持相同输出且不改写原对象', () => {
  const item = { title: '合成', coverUrl: 'https://example.invalid/a.png', referenceImageUrls: ['data:image/png;base64,YQ==', 'https://example.invalid/b.png'], githubUrl: 'https://example.invalid', sourceUrl: 'https://example.invalid/s' };
  const before = JSON.stringify(item);
  assert.equal(JSON.stringify(policy.offlinePrompt(item)), JSON.stringify(oldPolicy.offlinePrompt(item)));
  assert.equal(JSON.stringify(item), before);
});

test('作者五项音视频默认参数与四类模型恢复，三态主题仅一处且无新增effect', () => {
  const config = files.get(设置产物).产物;
  for (const key of formKeys) assert.equal(config.split(`label={t("config.preferences.${key}")}`).length, 2);
  for (const capability of ['image', 'text', 'video', 'audio']) assert.ok(config.includes(`capability: "${capability}"`));
  assert.ok(config.includes('{modelGroups.map((group)'));
  assert.equal(config.split('<ThemePreference />').length, 2);
  assert.equal(config.split('useEffect(').length, files.get(设置产物).原文.split('useEffect(').length);
  assert.ok(config.includes('normalizeAudioSpeedValue(event.target.value)'));
});

test('现有画布/节点/API统一门禁跟随策略恢复，不触碰任务保存和独立路由', () => {
  for (const [path, needle] of [
    ['web/src/services/api/audio.ts', 'requireGenerationMode("audio")'],
    ['web/src/services/api/video.ts', 'requireGenerationMode("video")'],
    ['web/src/pages/canvas/project.tsx', 'if (!isGenerationModeEnabled(mode))'],
    ['web/src/components/canvas/canvas-config-node-panel.tsx', 'isGenerationModeEnabled(option.value)'],
    ['web/src/components/canvas/canvas-node-prompt-panel.tsx', 'if (!isGenerationModeEnabled(mode))'],
    ['web/src/components/canvas/canvas-node-hover-toolbar.tsx', 'isVideo && isGenerationModeEnabled("video")'],
  ]) {
    assert.ok(生成精简主题候选().get(path).产物.includes(needle));
    assert.equal(files.has(path), false);
  }
  assert.equal(files.has('web/src/services/file-storage.ts'), false);
  assert.equal(files.has('web/src/stores/canvas/use-canvas-store.ts'), false);
  assert.equal(files.has('web/src/guan/功能开关.ts'), false);
});
