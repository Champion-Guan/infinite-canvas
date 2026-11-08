import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ts, 生成审查差异 } from './检查首批功能适配.mjs';
import { 根目录 } from './公共.mjs';
import { 构建迁移扩大整批候选, 合并同前态候选, 扩大输入指纹 } from './预审迁移扩大整批.mjs';
import { 哈希 } from './检查运行副本.mjs';

// Real candidate code, mocked React state/DOM/network ports. This is not browser
// or paid-provider acceptance; existing SQLite and CONNECT/TLS suites run too.
const preview = 构建迁移扩大整批候选();
const source = path => preview.delta.get('画布副本/web/src/' + path)?.产物 ?? readFileSync(join(preview.integration.副本, 'web/src', path), 'utf8');
function evaluate(code, globals = {}, imports = {}, tail = '') {
  const module = { exports: {} };
  const output = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const context = vm.createContext({ module, exports: module.exports, Error, Blob, URL, AbortSignal, AbortController, TextEncoder, Uint8Array, crypto: webcrypto, console, setTimeout, clearTimeout,
    require: name => { if (!(name in imports)) throw Error('Unexpected fixture import: ' + name); return imports[name]; }, ...globals });
  vm.runInContext(output + '\n' + tail, context); return module.exports;
}
const parsed = ts.createSourceFile('project.tsx', source('pages/canvas/project.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = new Set(['promptGenerationPatch', 'detectedPromptConfig', 'generationSettingsFromNode', 'generationNodeWithConnectedSettings', 'generationNodeForExecution']);
const helpers = parsed.statements.filter(node => ts.isFunctionDeclaration(node) && names.has(node.name?.text) || ts.isVariableStatement(node) && node.declarationList.declarations.some(item => item.name.getText(parsed) === 'INHERITED_GENERATION_SETTINGS')).map(node => node.getText(parsed)).join('\n');
function callback(name) {
  let found;
  function visit(node) { if (ts.isVariableDeclaration(node) && node.name.getText(parsed) === name) { assert.equal(found, undefined); found = node.initializer.arguments[0].getText(parsed); } ts.forEachChild(node, visit); }
  visit(parsed); assert.ok(found, name); return `const ${name} = ${found};\n`;
}
const plain = value => JSON.parse(JSON.stringify(value));
const types = { Text: 'text', Config: 'config', Image: 'image', Video: 'video', Audio: 'audio' };
const modeApi = evaluate(source('guan/recovery/prompt-generation-mode.ts'));
const placementApi = evaluate(readFileSync(join(根目录, '扩展功能/画布布局/卡片自动避让.ts'), 'utf8'));
const prompt = (id, title = '详情页提示词', metadata = {}) => ({ id, type: 'text', title, position: { x: 0, y: 0 }, width: 300, height: 200, metadata: { content: 'Product 1600 x 2000 px 4 : 5 DETAIL IMAGE', ...metadata } });
const config = (id, metadata = {}) => ({ id, type: 'config', title: '生成配置', position: { x: 500, y: 0 }, width: 300, height: 250, metadata });
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
const tick = () => new Promise(resolve => setImmediate(resolve));
function pageFixture(nodes = [], connections = [], extra = {}, actions = ['useImageAsGlobalReference', 'generateImageFromTextNode', 'createConnectedNode', 'connectNodes', 'downloadNodeImage', 'downloadBatchImage']) {
  let id = 0; const nodesRef = { current: nodes }, connectionsRef = { current: connections }, messages = [], downloaded = [];
  const globals = {
    nodesRef, connectionsRef, CanvasNodeType: types, NODE_STATUS_LOADING: 'loading', NODE_STATUS_SUCCESS: 'success', NODE_STATUS_ERROR: 'error', NODE_STATUS_IDLE: 'idle',
    effectiveConfig: { imageModel: 'image-model', model: 'image-model', videoModel: 'video-model', audioModel: 'audio-model', textModel: 'text-model', size: '1024x1024', canvasImageCount: '1', count: '1' },
    message: Object.fromEntries(['info', 'success', 'warning', 'error'].map(key => [key, text => messages.push([key, text])])),
    getGenerationCount: value => Number(value) || 1, promptGenerationMode: modeApi.promptGenerationMode,
    placeCanvasNode: placementApi.placeCanvasNode, nanoid: () => 'id-' + ++id, getNodeSpec: () => ({ width: 300, height: 250 }),
    createCanvasNode: (type, center, metadata) => ({ id: 'node-' + ++id, type, title: type, position: { x: center.x - 150, y: center.y - 125 }, width: 300, height: 250, metadata }),
    setNodes: value => { nodesRef.current = typeof value === 'function' ? value(nodesRef.current) : value; },
    setConnections: value => { connectionsRef.current = typeof value === 'function' ? value(connectionsRef.current) : value; },
    setSelectedNodeIds: () => {}, setSelectedConnectionId: () => {}, setDialogNodeId: () => {}, setPendingConnectionCreate: () => {}, setConnecting: () => {}, setContextMenu: () => {},
    t: key => key, normalizeConnection: (fromNodeId, toNodeId) => ({ fromNodeId, toNodeId }), bindExcelParameters: () => undefined, excelFactory: {},
    readDownloadBlob: async () => new Blob(['image'], { type: 'image/webp' }), saveAs: (...args) => downloaded.push(args),
    imageExtension: mime => mime.split('/')[1] || 'png', audioExtension: mime => mime.includes('wav') ? 'wav' : 'mp3',
    ...extra,
  };
  const code = helpers + '\n' + actions.map(callback).join('\n');
  const api = evaluate(code, globals, {}, 'exports.actions = { ' + actions.join(',') + ' };');
  return { ...api.actions, nodesRef, connectionsRef, messages, downloaded, globals };
}

test('同前态三方合并保留双方改动，拒绝同位置冲突/不同前态/新增路径冲突', () => {
  const base = 'a\nb\nc\nd\ne\nf\ng\n';
  const merged = 合并同前态候选({ 原文: base, 产物: base.replace('a\n', 'A\n') }, { 原文: base, 产物: base.replace('g\n', 'G\n') });
  assert.equal(merged.产物, 'A\nb\nc\nd\ne\nf\nG\n');
  assert.throws(() => 合并同前态候选({ 原文: base, 产物: 'X' }, { 原文: base, 产物: 'Y' }), /冲突/);
  assert.throws(() => 合并同前态候选({ 原文: base, 产物: 'X' }, { 原文: 'other', 产物: 'Y' }), /前态/);
  assert.throws(() => 合并同前态候选({ 原文: null, 产物: 'X' }, { 原文: null, 产物: 'Y' }), /冲突/);
});
test('扩大整批包含安全、代理、Fallback、任务及新操作，冻结14文件未改写', () => {
  assert.equal(preview.delta.size, 67); assert.equal(preview.combinedFileCount, 49); assert.equal(preview.safetyFileCount, 14);
  assert.equal(preview.merged.length, 2);
  for (const [name, hash] of Object.entries(扩大输入指纹)) assert.equal(哈希(readFileSync(join(根目录, '上游适配/待审查', name))), hash);
  assert.equal(new Set(preview.delta.keys()).size, preview.delta.size);
  assert.ok(生成审查差异(preview.delta).length > 100_000);
  const project = source('pages/canvas/project.tsx');
  assert.match(project, /requestCanvasImage/); assert.match(project, /recordImageGatewayTask/); assert.match(project, /gatewayGenerationReceipts/);
  assert.match(source('stores/use-asset-store.ts'), /assetReadGate.assertWritable/);
  assert.match(source('guan/generation/原画布图片调用.ts'), /prepareRoutedImageRequest/);
});
test('全局参考只新增缺失配置连线，连续点击不重复，保留原连接', () => {
  const image = { id: 'img', type: 'image', metadata: { content: 'blob:image' } };
  const f = pageFixture([image, config('c1'), config('c2'), prompt('p')], [{ id: 'old', fromNodeId: 'img', toNodeId: 'c1' }, { id: 'other', fromNodeId: 'p', toNodeId: 'c2' }]);
  f.useImageAsGlobalReference(image); assert.equal(f.connectionsRef.current.length, 3);
  assert.equal(f.connectionsRef.current[2].toNodeId, 'c2'); f.useImageAsGlobalReference(image); assert.equal(f.connectionsRef.current.length, 3);
  assert.ok(f.messages.some(([, value]) => value.includes('已经连接')));
});
test('全局参考对无配置、空图和非图片保留画布并提示', () => {
  const image = { id: 'img', type: 'image', metadata: { content: 'blob:i' } };
  const f = pageFixture([image]); f.useImageAsGlobalReference(image);
  assert.ok(f.messages.some(([, value]) => value.includes('没有生成配置')));
  f.useImageAsGlobalReference({ id: 'empty', type: 'image' }); f.useImageAsGlobalReference(prompt('p'));
  assert.equal(f.connectionsRef.current.length, 0);
});
test('全局参考操作前重读图片，已删除或已清空的旧工具条不创建悬空连线', () => {
  const old = { id: 'img', type: 'image', metadata: { content: 'blob:old' } }, f = pageFixture([config('c')]);
  f.useImageAsGlobalReference(old); assert.equal(f.connectionsRef.current.length, 0);
  f.nodesRef.current.push({ ...old, metadata: { content: '' } }); f.useImageAsGlobalReference(old); assert.equal(f.connectionsRef.current.length, 0);
});
for (const [title, expected] of [['详情页提示词', 'image-model'], ['视频提示词', 'video-model'], ['语音提示词', 'audio-model'], ['文本提示词', 'text-model']]) test('单条配置创建识别' + title + '并快照像素/比例', () => {
  const node = prompt('p', title), f = pageFixture([node]); f.generateImageFromTextNode(node);
  const created = f.nodesRef.current.at(-1);
  assert.equal(created.type, 'config'); assert.equal(created.metadata.model, expected); assert.equal(created.metadata.size, '1600x2000');
  assert.equal(created.metadata.generationAspectRatio, '4:5'); assert.equal(created.metadata.generationParamsSourceNodeId, 'p');
  assert.equal(f.connectionsRef.current[0].toNodeId, created.id);
});
test('拖连创建识别上游最终提示词的类型与显式参数，同时保留原卡', () => {
  const raw = prompt('raw', '视频提示词'), final = prompt('final', '最终提示词', { promptVariableSourceNodeId: 'raw', size: '1920x1080' });
  const f = pageFixture([raw, final]); f.createConnectedNode('config', { connection: { nodeId: 'final', handleType: 'source' }, position: { x: 700, y: 100 } });
  const node = f.nodesRef.current.at(-1); assert.equal(node.metadata.generationMode, 'video'); assert.equal(node.metadata.model, 'video-model'); assert.equal(node.metadata.size, '1920x1080');
  assert.equal(f.nodesRef.current[0], raw);
});
test('已有提示词连接配置时识别尺寸/模式，重复连线不覆写后续人工设置', () => {
  const p = prompt('p', '视频提示词'), c = config('c', { generationMode: 'image', model: 'old', quality: 'high' });
  const f = pageFixture([p, c]); f.connectNodes({ nodeId: 'p', handleType: 'source' }, 'c');
  const linked = f.nodesRef.current.find(node => node.id === 'c'); assert.equal(linked.metadata.model, 'video-model'); assert.equal(linked.metadata.size, '1600x2000'); assert.equal(linked.metadata.quality, 'high');
  linked.metadata.size = 'manual'; f.connectNodes({ nodeId: 'p', handleType: 'source' }, 'c'); assert.equal(f.connectionsRef.current.length, 1); assert.equal(linked.metadata.size, 'manual');
});
test('配置执行维持自身参数快照，正文中偶然video不改变模式', () => {
  const p = prompt('p', '普通提示词', { content: 'a video camera 1200x1600 px' }), c = config('c', { model: 'fixed', size: '1024x1024' });
  const api = evaluate(helpers, { CanvasNodeType: types, promptGenerationMode: modeApi.promptGenerationMode }, {}, 'exports.execute = generationNodeForExecution;');
  assert.equal(api.execute(c, c.id, [p, c], [{ fromNodeId: 'p', toNodeId: 'c' }]), c);
  const f = pageFixture([p]); f.generateImageFromTextNode(p); assert.equal(f.nodesRef.current.at(-1).metadata.generationMode, 'image');
});
const highlight = evaluate(source('guan/prompt/prompt-variable-highlight.js')).promptHighlightSegments;
test('变量高亮保留重复值的来源，拼接始终等于正文，不篡改存储', () => {
  const content = '红色 与 红色', raw = '[颜色] 与 [款式]', values = { '[颜色]': ' 红色 ', '[款式]': '红色' }, before = JSON.stringify(values);
  const result = highlight(content, raw, values); assert.equal(result.map(item => item.text).join(''), content);
  assert.deepEqual(plain(result.filter(item => item.token).map(item => item.token)), ['[颜色]', '[款式]']); assert.equal(JSON.stringify(values), before);
});
test('人工修改后的正文不按旧模板猜测高亮，未替换占位符可辨认', () => {
  const result = highlight('蓝色 与 [款式]', '[颜色] 与 [款式]', { '[颜色]': '红色' });
  assert.equal(result.map(item => item.text).join(''), '蓝色 与 [款式]'); assert.deepEqual(plain(result.filter(item => item.token).map(item => item.token)), ['[款式]']);
  assert.equal(highlight('<script>x</script>\n[颜色]', undefined).map(item => item.text).join(''), '<script>x</script>\n[颜色]');
});
test('迁入旧TextContent与主题本地化，编辑仍传原始正文', () => {
  const localize = evaluate(source('guan/prompt/prompt-theme-labels.js')).localizePromptTheme;
  assert.equal(localize('Detail Image'), '详情页图片'); assert.equal(localize('unknown special'), 'unknown special');
  const node = source('components/canvas/canvas-node.tsx'); assert.match(node, /value=\{content\}/); assert.match(node, /onContentChange\(node.id, value\)/);
  assert.match(node, /<mark key=\{index\}/); assert.doesNotMatch(node, /dangerouslySetInnerHTML/);
});
test('Fallback模型选择器在同一渠道配置下随外部设置刷新选项', () => {
  const code = source('components/model-picker.tsx'), file = ts.createSourceFile('model-picker.tsx', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const component = file.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'ModelPicker');
  let enabled = false, subscribed = 0;
  const jsx = (type, props) => ({ type, props });
  const api = evaluate(component.getText(file), {
    useTranslation: () => ({ t: value => value }), useId: () => 'fixture-picker', useState: value => [value, () => {}], useEffect: () => {},
    useFallbackRevision: () => ++subscribed, hasEnabledFallback: () => enabled, FALLBACK_MODEL_OPTION: '__fallback__',
    selectableModelsByCapability: () => ['A::image'], modelOptionLabel: (_config, value) => value, cn: (...items) => items.filter(Boolean).join(' '),
    Select: 'Select', SelectContent: 'Content', SelectItem: 'Item', SelectTrigger: 'Trigger', ModelIcon: 'Icon', ModelLabel: 'Label',
  }, { 'react/jsx-runtime': { jsx, jsxs: jsx } });
  const config = { channelMode: 'remote' }, values = tree => tree.props.children[1].props.children.map(item => item.props.value);
  assert.deepEqual(plain(values(api.ModelPicker({ config, capability: 'image' }))), ['A::image']);
  enabled = true; assert.deepEqual(plain(values(api.ModelPicker({ config, capability: 'image' }))), ['__fallback__', 'A::image']);
  enabled = false; assert.deepEqual(plain(values(api.ModelPicker({ config, capability: 'image' }))), ['A::image']); assert.equal(subscribed, 3);
});
function downloadFixture() {
  const images = new Map(), media = new Map(), requests = [], writes = []; let response = { ok: true, status: 200, blob: async () => new Blob(['download'], { type: 'image/webp' }) };
  const imports = {
    '@/services/image-storage': { getImageBlob: async key => images.get(key), setImageBlob: async (key, blob) => { writes.push(key); images.set(key, blob); } },
    '@/services/file-storage': { getMediaBlob: async key => media.get(key), setMediaBlob: async (key, blob) => { writes.push(key); media.set(key, blob); } },
    '@/stores/use-config-store': { withLocalProxy: url => url },
  };
  const api = evaluate(source('services/media-download.ts'), { fetch: async (...args) => { requests.push(args); if (response instanceof Error) throw response; return response; } }, imports);
  return { ...api, images, media, requests, writes, respond: value => { response = value; } };
}
test('下载优先持久原文件，即使旧blob URL失效也不发网络请求', async () => {
  const f = downloadFixture(), original = new Blob(['original'], { type: 'image/png' }); f.images.set('image:original', original);
  const result = await f.readDownloadBlob({ kind: 'image', storageKey: 'image:original', url: 'blob:stale' }); assert.equal(result, original); assert.equal(f.requests.length, 0);
});
test('并发相同下载共享一次请求，缓存后可离线重读', async () => {
  const wait = deferred(), f = downloadFixture(); f.respond({ ok: true, blob: () => wait.promise });
  const a = f.readDownloadBlob({ kind: 'video', storageKey: 'video:x', url: 'https://synthetic.example/x' }), b = f.readDownloadBlob({ kind: 'video', storageKey: 'video:x', url: 'https://synthetic.example/x' });
  await tick(); assert.equal(f.requests.length, 1); const blob = new Blob(['v'], { type: 'video/webm' }); wait.resolve(blob);
  assert.equal(await a, blob); assert.equal(await b, blob); assert.equal(f.writes.length, 1);
  f.respond(Error('offline')); assert.equal(await f.readDownloadBlob({ kind: 'video', storageKey: 'video:x' }), blob);
});
test('没有旧storageKey时按URL哈希缓存，不把凭据URL写进键', async () => {
  const f = downloadFixture(), item = { kind: 'image', url: 'https://synthetic.example/a?token=synthetic' };
  await f.readDownloadBlob(item); await f.readDownloadBlob(item); assert.equal(f.requests.length, 1); assert.match(f.writes[0], /^image:download:[a-f0-9]{64}$/); assert.ok(!f.writes[0].includes('synthetic'));
});
for (const [label, response] of [['HTTP错误', { ok: false, status: 403 }], ['空体', { ok: true, blob: async () => new Blob([]) }], ['HTML', { ok: true, blob: async () => new Blob(['error'], { type: 'text/html' }) }], ['JSON', { ok: true, blob: async () => new Blob(['{}'], { type: 'application/json' }) }], ['网络错误', Error('offline')]]) test('下载' + label + '不缓存，失败后允许重试', async () => {
  const f = downloadFixture(), item = { kind: 'image', storageKey: 'image:x', url: 'https://synthetic.example/image' }; f.respond(response);
  await assert.rejects(f.readDownloadBlob(item)); assert.equal(f.writes.length, 0);
  f.respond({ ok: true, blob: async () => new Blob(['valid'], { type: 'image/png' }) }); assert.equal((await f.readDownloadBlob(item)).type, 'image/png'); assert.equal(f.requests.length, 2);
});
test('节点与批次下载使用Blob实际MIME后缀，缺失远程URL也可下载缓存', async () => {
  const f = pageFixture([], [], { readDownloadBlob: async ({ kind }) => new Blob(['x'], { type: kind === 'video' ? 'video/webm' : kind === 'audio' ? 'audio/wav' : 'image/webp' }) });
  await f.downloadNodeImage({ id: 'v', type: 'video', metadata: { storageKey: 'video:v' } }); await f.downloadNodeImage({ id: 'a', type: 'audio', metadata: { storageKey: 'audio:a' } });
  await f.downloadBatchImage({ id: 'root', type: 'image', metadata: { images: [{ id: 'slot', storageKey: 'image:slot' }] } }, 'slot');
  assert.deepEqual(f.downloaded.map(item => item[1]), ['canvas-video-v.webm', 'canvas-audio-a.wav', 'canvas-image-root-slot.webp']); assert.ok(f.downloaded.every(item => item[0] instanceof Blob));
});
test('下载失败提示且不伪装交付成功', async () => {
  const f = pageFixture([], [], { readDownloadBlob: async () => { throw Error('synthetic-disk'); } });
  await f.downloadNodeImage({ id: 'i', type: 'image', metadata: { storageKey: 'image:i' } }); assert.equal(f.downloaded.length, 0); assert.ok(f.messages.some(([kind, text]) => kind === 'error' && text.includes('synthetic-disk')));
});

test('扩大整批实际批量入口到图片任务调用，三并发、保存收据及产品身份共存', async () => {
  const wait = deferred(), requests = [], saves = []; let active = 0, maximum = 0;
  const f = pageFixture(Array.from({ length: 5 }, (_, i) => config('c' + i, { prompt: '合成提示词', count: 1 })), [], {
    projectId: 'synthetic-product', batchGenerationRunning: { current: false }, completeAndGenerateRunning: { current: false },
    isGenerationModeEnabled: () => true, isAiConfigReady: () => true, getNodeDefinition: () => undefined,
    buildGenerationConfig: (cfg, node) => ({ ...cfg, ...node.metadata }), setRunningNodeId: () => {},
    startGenerationRequest: () => new AbortController(), finishGenerationRequest: () => {},
    buildNodeGenerationContext: (_id, _nodes, _connections, prompt) => ({ prompt, referenceImages: [] }), hydrateNodeGenerationContext: async context => context,
    buildImageGenerationMetadata: () => ({}), NODE_DEFAULT_SIZE: { config: { width: 300, height: 250 }, image: { width: 300, height: 250 } },
    nextGenerationResultPosition: () => ({ x: 700, y: 0 }),
    uploadImage: async () => ({ url: 'blob:synthetic-result', storageKey: 'image:synthetic', width: 1024, height: 768, bytes: 4, mimeType: 'image/png' }),
    fitNodeSize: () => ({ width: 300, height: 225 }), isGenerationCanceled: () => false,
    requestGeneration: () => { throw Error('旧收费入口不得用于本测试普通图片'); }, requestEdit: () => { throw Error('旧编辑入口不得用于本测试普通图片'); },
    recordImageGatewayTask: async () => {}, saveProductCanvas: async product => saves.push(product),
    requestCanvasImage: async options => {
      requests.push(options); active++; maximum = Math.max(maximum, active); await wait.promise;
      await options.recordTask({ taskId: 'task-' + options.scope.slotId, slotId: options.scope.slotId });
      await options.applyAndSave({ dataUrl: 'data:image/png;base64,aW1hZ2U=' }, { taskId: 'task-' + options.scope.slotId, responseHash: 'synthetic-hash' }); active--;
    },
    settleActivityGroup: async values => { const settled = await Promise.allSettled(values); const failed = settled.find(item => item.status === 'rejected'); if (failed) throw failed.reason; },
  }, ['handleGenerateNode', 'generateAllConfigNodes']);
  const work = f.generateAllConfigNodes(); await tick(); assert.equal(requests.length, 3); await f.generateAllConfigNodes(); assert.equal(requests.length, 3);
  wait.resolve(); await work; assert.equal(requests.length, 5); assert.equal(maximum, 3); assert.equal(saves.length, 5);
  assert.ok(requests.every(item => item.scope.productId === 'synthetic-product'));
  assert.equal(f.nodesRef.current.filter(node => node.type === 'image' && node.metadata.gatewayGenerationReceipts?.length === 1).length, 5);
});
