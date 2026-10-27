import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from '../.运行/3100源/画布副本/web/node_modules/typescript/lib/typescript.js';
import { transformWithEsbuild } from '../.运行/3100源/画布副本/web/node_modules/vite/dist/node/index.js';

async function load(file, dependencies = {}) {
  const { code } = await transformWithEsbuild(readFileSync(file, 'utf8'), file, { loader: file.endsWith('tsx') ? 'tsx' : 'ts', jsx: 'automatic', format: 'cjs', target: 'es2022', tsconfigRaw: '{}' });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(id => {
    assert.ok(id in dependencies, '未声明依赖：' + id); return dependencies[id];
  }, module, module.exports);
  return module.exports;
}
const { createCanvasGenerationRegistry, useCanvasGenerationRequests } = await load('扩展功能/画布生成/并发生成状态.ts', { react: {
  useState: initialize => [initialize()], useRef: value => ({ current: value }),
  useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
} });
const projectFile = '.运行/3100源/画布副本/web/src/pages/canvas/project.tsx';
const ast = ts.createSourceFile(projectFile, readFileSync(projectFile, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function callbackSource(name) {
  let found;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) found = node.initializer.arguments[0].getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast); assert.ok(found, '找不到真实画布回调：' + name); return found;
}
async function callback(name, scope) {
  const { code } = await transformWithEsbuild('module.exports = ' + callbackSource(name), '真实画布回调.tsx', { loader: 'tsx', jsx: 'automatic', format: 'cjs', target: 'es2022', tsconfigRaw: '{}' });
  const module = { exports: {} };
  new Function(...Object.keys(scope), 'module', code)(...Object.values(scope), module);
  return module.exports;
}
function ids(registry) { return [...registry.getSnapshot()].sort(); }
function createThree() {
  const registry = createCanvasGenerationRegistry();
  const controllers = ['A', 'B', 'C'].map(id => registry.startGenerationRequest(id, id));
  return { registry, controllers };
}

test('三张配置并发，结束一张只移除本卡，其他两张继续生成', () => {
  const { registry: r, controllers } = createThree();
  assert.deepEqual(ids(r), ['A', 'B', 'C']);
  r.finishGenerationRequest('B', controllers[1]); assert.deepEqual(ids(r), ['A', 'C']);
  r.finishGenerationRequest('A', controllers[0]); assert.deepEqual(ids(r), ['C']);
  r.finishGenerationRequest('C', controllers[2]); assert.deepEqual(ids(r), []);
});
test('一个配置的来源和多结果请求按运行ID聚合，最后请求完成才结束状态', () => {
  const r = createCanvasGenerationRegistry(), controller = r.startGenerationRequest('配置', '配置');
  r.startGenerationRequest('结果1', '配置', '配置', controller);
  r.startGenerationRequest('结果2', '配置', '配置', controller);
  r.finishGenerationRequest('结果1', controller); r.finishGenerationRequest('配置', controller);
  assert.deepEqual(ids(r), ['配置']);
  r.finishGenerationRequest('结果2', controller); assert.deepEqual(ids(r), []);
});
test('停止B只取消B来源和结果，A/C不中断，迟到完成不清掉新重试', () => {
  const { registry: r, controllers } = createThree();
  r.startGenerationRequest('B结果', 'B', 'B', controllers[1]);
  assert.deepEqual([...r.stopGenerationRequests('B')].sort(), ['B', 'B结果']);
  assert.equal(controllers[1].signal.aborted, true);
  assert.equal(controllers[0].signal.aborted, false); assert.equal(controllers[2].signal.aborted, false);
  const retry = r.startGenerationRequest('B', 'B');
  r.finishGenerationRequest('B', controllers[1]); assert.equal(r.requests.get('B').controller, retry);
  assert.deepEqual(ids(r), ['A', 'B', 'C']);
});
test('覆盖同目标时中止旧请求，旧finally不能删除新任务', () => {
  const r = createCanvasGenerationRegistry(), old = r.startGenerationRequest('A', 'A'), next = r.startGenerationRequest('A', 'A');
  assert.equal(old.signal.aborted, true); r.finishGenerationRequest('A', old);
  assert.equal(r.requests.get('A').controller, next); assert.deepEqual(ids(r), ['A']);
});
test('仅运行卡片集合变化才通知React，不因结果子请求频繁重渲染或写入画布', () => {
  const r = createCanvasGenerationRegistry(), empty = r.getSnapshot(); let notifications = 0;
  assert.equal(r.getSnapshot(), empty);
  const unsubscribe = r.subscribe(() => notifications++);
  const controller = r.startGenerationRequest('A', 'A'), active = r.getSnapshot();
  r.startGenerationRequest('结果', 'A', 'A', controller); r.finishGenerationRequest('结果', controller);
  assert.equal(r.getSnapshot(), active); assert.equal(notifications, 1);
  r.finishGenerationRequest('A', controller); assert.equal(notifications, 2); unsubscribe();
  r.startGenerationRequest('B', 'B'); assert.equal(notifications, 2);
  const hook = useCanvasGenerationRequests(); assert.equal(hook.generationRequestsRef.current.size, 0); assert.equal(hook.runningNodeIds.size, 0);
});

async function executionFixture({ failPreparation = false, blank = false } = {}) {
  const registry = createCanvasGenerationRegistry(), tasks = [], errors = [];
  const nodesRef = { current: ['A','B','C'].map((id, index) => ({ id, type: 'config', position: { x: 0, y: index * 500 }, width: 300, height: 240, metadata: { prompt: '产品照片' } })) };
  const connectionsRef = { current: [] }; let sequence = 0, generated = 0;
  const scope = {
    ...registry, generationRequestsRef: { current: registry.requests }, nodesRef, connectionsRef,
    isGenerationModeEnabled: () => true, generationNodeForExecution: node => node,
    effectiveConfig: {}, buildGenerationConfig: () => ({ count: '1' }), isAiConfigReady: () => true, getNodeDefinition: () => undefined,
    openConfigDialog: () => assert.fail('不应打开配置'),
    buildNodeGenerationContext: () => ({}), hydrateNodeGenerationContext: async () => {
      if (failPreparation) throw Error('参考图读取失败');
      return { prompt: blank ? '' : '产品照片', referenceImages: [] };
    },
    setNodes(update) { nodesRef.current = update(nodesRef.current); }, setConnections(update) { connectionsRef.current = update(connectionsRef.current); },
    CanvasNodeType: { Config: 'config', Image: 'image', Text: 'text', Video: 'video', Audio: 'audio' },
    NODE_STATUS_LOADING: 'loading', NODE_STATUS_SUCCESS: 'success', NODE_STATUS_ERROR: 'error', NODE_STATUS_IDLE: 'idle',
    NODE_DEFAULT_SIZE: { config: { width: 300, height: 240 }, image: { width: 300, height: 400 } },
    getGenerationCount: () => 1, buildImageGenerationMetadata: () => ({}), nanoid: () => 'result-' + ++sequence,
    generatedImageCardTitle: () => '详情', findGeneratedImageSourcePrompt: () => undefined,
    nextGenerationResultPosition: () => ({ x: 500, y: 0 }), numberGeneratedImages: nodes => nodes,
    setSelectedNodeIds() {}, setSelectedConnectionId() {}, setDialogNodeId() {},
    requestCanvasImage: options => { generated++; return new Promise(resolve => tasks.push({ options, resolve })); },
    saveCanvasImageResult: async options => options.onApplied(), recordImageGatewayTask() {},
    projectId: '本机合成验收', isGenerationCanceled: error => error.name === 'AbortError', isVideoTaskFailed: () => false,
    message: { error: text => errors.push(text) }, t: key => key,
  };
  return { ...scope, registry, tasks, errors, generated: () => generated, run: await callback('handleGenerateNode', scope) };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
test('执行真实画布生成回调：三任务同时待响应，B先结束后A/C仍显示运行', async () => {
  const f = await executionFixture(), pending = ['A','B','C'].map(id => f.run(id, 'image', '产品照片'));
  await flush(); assert.equal(f.tasks.length, 3); assert.deepEqual(ids(f.registry), ['A','B','C']);
  assert.equal(f.nodesRef.current.filter(node => node.type === 'image' && node.metadata.status === 'loading').length, 3);
  await f.tasks[1].options.applyAndSave({}, {}); f.tasks[1].resolve(); await pending[1];
  assert.deepEqual(ids(f.registry), ['A','C']); assert.equal(f.registry.requests.size, 4);
  f.tasks[0].resolve(); f.tasks[2].resolve(); await Promise.all(pending); assert.deepEqual(ids(f.registry), []);
});
test('真实回调准备失败或空文本提前退出释放运行状态；同卡重复点击不提交第二次', async () => {
  const failed = await executionFixture({ failPreparation: true }); await failed.run('A', 'image', '产品照片');
  assert.deepEqual(ids(failed.registry), []); assert.match(failed.errors[0], /参考图读取失败/);
  const blank = await executionFixture({ blank: true }); await blank.run('A', 'text', '');
  assert.deepEqual(ids(blank.registry), []); assert.equal(blank.generated(), 0);
  const live = await executionFixture(), pending = live.run('A', 'image', '产品照片');
  await flush(); await live.run('A', 'image', '重复点击'); assert.equal(live.generated(), 1);
  live.tasks[0].resolve(); await pending; assert.deepEqual(ids(live.registry), []);
});

const jsx = (type, props) => ({ type, props });
const { CanvasConfigNodePanel } = await load('.运行/3100源/画布副本/web/src/components/canvas/canvas-config-node-panel.tsx', {
  'react/jsx-runtime': { jsx, jsxs: jsx }, '@/扩展功能/产品配置/精简与离线策略': { isGenerationModeEnabled: () => true },
  'lucide-react': Object.fromEntries(['Image','LoaderCircle','MessageSquare','Music2','Play','Settings2','Square','Video'].map(name => [name,name])),
  antd: { Button: 'Button', Segmented: 'Segmented' }, 'react-i18next': { useTranslation: () => ({ t: key => key }) },
  '@/components/model-picker': { ModelPicker: 'ModelPicker' },
  '@/stores/use-config-store': { defaultConfig: {}, useEffectiveConfig: () => ({}), useConfigStore: fn => fn({ openConfigDialog() {} }), resolveModelForCapability: () => '测试模型' },
  '@/lib/canvas-theme': { canvasThemes: { light: { node: {} } } }, '@/stores/use-theme-store': { useThemeStore: fn => fn({ theme: 'light' }) },
  './canvas-image-settings-popover': { CanvasImageSettingsPopover: 'ImageSettings' }, './canvas-audio-settings-popover': {}, './canvas-video-settings-popover': {}, './canvas-text-settings-popover': {},
});
function descendants(node) { return Array.isArray(node) ? node.flatMap(descendants) : node && typeof node === 'object' ? [node, ...descendants(node.props?.children)] : []; }
test('真实配置面板三按钮均为停止；点击B只传B，其余两个保持停止按钮', async () => {
  const { registry: r } = createThree();
  const render = id => descendants(CanvasConfigNodePanel({ node: { id, metadata: { prompt: '产品照片' } }, isRunning: r.getSnapshot().has(id), inputSummary: {},
    onStop: selected => r.stopGenerationRequests(selected), onGenerate: () => assert.fail('正在生成的按钮不能再次生成') })).find(node => node.type === 'Button');
  for (const id of ['A','B','C']) assert.equal(render(id).props.danger, true);
  render('B').props.onClick(); assert.equal(render('B').props.danger, false);
  for (const id of ['A','C']) assert.equal(render(id).props.danger, true);
  for (const [name, nodeName] of [['renderNodeContentPanel','contentNode'], ['renderNodePanel','panelNode']]) {
    assert.match(callbackSource(name), new RegExp('runningNodeIds\\.has\\(' + nodeName + '\\.id\\)'));
    assert.doesNotMatch(callbackSource(name), /runningNodeId ===/);
  }
});
