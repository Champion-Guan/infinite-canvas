import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import vm from 'node:vm';
import { ts } from './检查首批功能适配.mjs';
import { 根目录 } from './公共.mjs';
import { 构建安全与批量候选, 唯一片段 } from './预审安全与批量迁移.mjs';

// Exercise the actual virtual candidate. Browser media and Zustand adapters
// below are explicit fixtures; these are not real-browser acceptance tests.
const preview = 构建安全与批量候选();
const source = path => preview.delta.get('web/src/' + path).产物;
function projectHelpers() {
  const parsed = ts.createSourceFile('project.tsx', source('pages/canvas/project.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const names = new Set(['promptGenerationPatch', 'generationSettingsFromNode', 'generationNodeWithConnectedSettings', 'generationNodeForExecution']);
  return parsed.statements.filter(node => (ts.isFunctionDeclaration(node) && names.has(node.name?.text)) ||
    (ts.isVariableStatement(node) && node.declarationList.declarations.some(item => item.name.getText(parsed) === 'INHERITED_GENERATION_SETTINGS'))).map(node => node.getText(parsed)).join('\n');
}
function evaluate(code, imports = {}, globals = {}, tail = '') {
  const module = { exports: {} };
  const js = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const context = vm.createContext({ module, exports: module.exports, require: name => {
    if (!(name in imports)) throw Error('Unexpected fixture import: ' + name);
    return imports[name];
  }, Blob, URL, AbortController, AbortSignal, setTimeout, clearTimeout, console, ...globals });
  vm.runInContext(js + '\n' + tail, context);
  return module.exports;
}
function recovery() {
  const cache = {};
  function load(name) {
    if (cache[name]) return cache[name];
    const code = source('guan/recovery/' + name + '.ts');
    const imports = {};
    for (const match of code.matchAll(/from "\.\/([^";]+)"/g)) imports['./' + match[1]] = load(match[1]);
    return cache[name] = evaluate(code, imports);
  }
  return { gate: load('recovery-read-gate'), checkpoint: load('persistence-checkpoint'), activity: load('update-activity'), settle: load('settle-activity-group') };
}
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
const tick = () => new Promise(resolve => setImmediate(resolve));
const plain = value => JSON.parse(JSON.stringify(value));

test('素材读门禁在未决、失败、重叠读后阻写，独立成功重读才解锁', async () => {
  const r = recovery(), gate = r.gate.createRecoveryReadGate(), a = deferred(), b = deferred();
  const pa = gate.read('assets', () => a.promise), pb = gate.read('assets', () => b.promise);
  assert.throws(() => gate.assertWritable('assets'), /incomplete/);
  a.reject(Error('synthetic-read')); await assert.rejects(pa, /synthetic-read/);
  b.resolve(null); await pb;
  assert.throws(() => gate.assertWritable('assets'), /incomplete/);
  await gate.read('assets', async () => null);
  assert.doesNotThrow(() => gate.assertWritable('assets'));
  assert.equal(r.activity.frontendActivity.snapshot().storage, 0);
});
test('同步读/then访问器异常不泄漏活动，不能抹掉失败', () => {
  const r = recovery(), gate = r.gate.createRecoveryReadGate();
  assert.throws(() => gate.read('assets', () => ({ get then() { throw Error('synthetic-then'); } })), /synthetic-then/);
  assert.equal(r.activity.frontendActivity.snapshot().storage, 0);
  assert.throws(() => gate.assertWritable('assets'));
  gate.read('assets', () => null); gate.assertWritable('assets');
});
test('读门禁容量溢出后保守阻写', () => {
  const r = recovery(), gate = r.gate.createRecoveryReadGate();
  for (let i = 0; i < 4097; i++) assert.throws(() => gate.read('item-' + i, () => { throw Error('synthetic'); }));
  assert.throws(() => gate.assertWritable('new-key'), /incomplete/);
});
test('checkpoint保留失败，成功重试后可排空', async () => {
  const r = recovery(), point = r.checkpoint.createPersistenceCheckpoint();
  await assert.rejects(point.run('write', () => Promise.reject(Error('synthetic-write'))));
  await assert.rejects(point.flush(), /incomplete/);
  await point.run('write', async () => 1); await point.flush();
});
test('并行组发生失败仍等待已开始的同伴结束', async () => {
  const r = recovery(), last = deferred(); let settled = false;
  const work = r.settle.settleActivityGroup([Promise.reject(Error('synthetic')), last.promise]).catch(error => { settled = true; throw error; });
  await tick(); assert.equal(settled, false); last.resolve(); await assert.rejects(work, /synthetic/);
});

function assetFixture() {
  const r = recovery(); let options, state, value = '{broken', failMedia = false, writes = 0;
  const storage = { getItem: async () => value, setItem: async () => { writes++; }, removeItem: async () => { writes++; } };
  const create = () => creator => {
    const api = () => {}; api.getState = () => state; api.setState = patch => { state = { ...state, ...patch }; };
    state = creator(api.setState, api.getState); return api;
  };
  const imports = {
    zustand: { create }, 'zustand/middleware': { persist: (creator, settings) => { options = settings; return creator; } }, nanoid: { nanoid: () => 'asset' },
    '@/guan/产品回收规则': { projectsWithRecycleMedia: () => [] }, '@/lib/localforage-storage': { localForageStorage: storage },
    '@/guan/recovery/recovery-read-gate': r.gate, '@/guan/recovery/persistence-checkpoint': r.checkpoint, '@/guan/recovery/settle-activity-group': r.settle,
    '@/services/image-storage': { ensureImagePreview: async () => {}, resolveImageUrl: async () => { if (failMedia) throw Error('synthetic-media'); return 'blob:restored'; }, cleanupUnusedImages: async () => {}, uploadImage: async () => {} },
    '@/services/file-storage': { resolveMediaUrl: async () => { if (failMedia) throw Error('synthetic-media'); return 'blob:restored'; }, cleanupUnusedMedia: async () => {} },
  };
  const api = evaluate(source('stores/use-asset-store.ts'), imports, {}, 'exports.storage = assetStorage;');
  return { api, setValue: data => { value = data; }, failMedia: () => { failMedia = true; }, get writes() { return writes; }, get state() { return state; }, callback: () => options.onRehydrateStorage() };
}
test('真实素材适配：损坏JSON不标记已恢复、不允许set/remove写回', async () => {
  const f = assetFixture(); await assert.rejects(f.api.storage.getItem('assets'));
  f.callback()(undefined, Error('synthetic')); assert.equal(f.state.hydrated, false);
  assert.throws(() => f.api.storage.setItem('assets', { state: { assets: [] } }));
  assert.throws(() => f.api.storage.removeItem('assets')); assert.equal(f.writes, 0);
  f.setValue(JSON.stringify({ state: { assets: [] } })); await f.api.storage.getItem('assets');
  f.callback()(f.state, undefined); assert.equal(f.state.hydrated, true);
  await f.api.storage.setItem('assets', { state: { assets: [] } }); assert.equal(f.writes, 1);
});
test('素材媒体恢复失败同样保护原记录', async () => {
  const f = assetFixture(); f.setValue(JSON.stringify({ state: { assets: [{ kind: 'video', data: { storageKey: 'video:a', url: 'blob:stale' } }] } }));
  f.failMedia(); await assert.rejects(f.api.storage.getItem('assets'), /synthetic-media/);
  f.callback()(undefined, Error('synthetic')); assert.equal(f.state.hydrated, false);
  assert.throws(() => f.api.storage.setItem('assets', { state: { assets: [] } })); assert.equal(f.writes, 0);
});

function mediaFixture({ response, thumbnail = async () => new Blob(['preview'], { type: 'image/webp' }) } = {}) {
  const stores = new Map(), writes = [], deletes = [], timers = new Map(), elements = [], requests = [], r = recovery(); let id = 0;
  const db = { createInstance: ({ storeName }) => {
    const data = new Map(); stores.set(storeName, data);
    return { setItem: async (key, value) => { writes.push([storeName, key]); data.set(key, value); }, getItem: async key => data.get(key) || null,
      removeItem: async key => { deletes.push([storeName, key]); data.delete(key); }, iterate: async callback => { for (const [key, value] of data) callback(value, key); } };
  } };
  const url = { createObjectURL: () => 'blob:synthetic-' + ++id, revokeObjectURL: () => {} };
  const window = { setTimeout: (fn, ms) => { const key = ++id; timers.set(key, { fn, ms }); return key; }, clearTimeout: key => timers.delete(key) };
  const document = { createElement: type => { const media = { type, videoWidth: 1920, videoHeight: 1080, duration: 2 }; elements.push(media); return media; } };
  class Image { naturalWidth = 1024; naturalHeight = 768; set src(_url) { queueMicrotask(() => this.onload?.()); } }
  const globals = { window, document, URL: url, Image, fetch: async (...args) => { requests.push(args); if (response instanceof Error) throw response; return response; } };
  const common = { '@/guan/上游浏览器存储桥': { sqliteForage: db }, nanoid: { nanoid: () => 'synthetic-' + ++id }, '@/stores/use-config-store': { withLocalProxy: value => value } };
  const media = evaluate(source('services/file-storage.ts'), common, globals);
  const image = evaluate(source('services/image-storage.ts'), { ...common, '@/i18n': { default: { t: key => key } }, '@/lib/image-thumbnail': { createImageThumbnail: thumbnail },
    '@/guan/recovery/persistence-checkpoint': r.checkpoint, '@/guan/recovery/settle-activity-group': r.settle }, globals);
  return { media, image, stores, writes, deletes, timers, elements, requests,
    expire(ms) { for (const [key, timer] of [...timers]) if (timer.ms === ms) { timers.delete(key); timer.fn(); } } };
}
for (const [label, response] of [
  ['HTTP失败', { ok: false, status: 503, blob: async () => new Blob(['oops']) }],
  ['空文件', { ok: true, blob: async () => new Blob([]) }],
  ['HTML错误体', { ok: true, blob: async () => new Blob(['error'], { type: 'text/html' }) }],
  ['JSON错误体', { ok: true, blob: async () => new Blob(['{}'], { type: 'application/json' }) }],
  ['网络失败', Error('synthetic-offline')],
]) test('媒体上传拒绝' + label + '，不写库', async () => {
  const f = mediaFixture({ response }); await assert.rejects(f.media.uploadMediaFile('https://synthetic.example/video', 'video'));
  assert.equal(f.writes.length, 0); assert.ok(f.requests[0][1].signal instanceof AbortSignal);
});
test('Blob上传也拒绝空/错误类型', async () => {
  const f = mediaFixture(); await assert.rejects(f.media.uploadMediaFile(new Blob([])));
  await assert.rejects(f.media.uploadMediaFile(new Blob(['bad'], { type: 'application/json' }))); assert.equal(f.writes.length, 0);
});
for (const type of ['video/mp4', 'audio/mpeg']) test(type + '元数据10秒超时后结束并移除监听', async () => {
  const f = mediaFixture(), work = f.media.uploadMediaFile(new Blob(['media'], { type }));
  await tick(); assert.equal(f.elements.length, 1); assert.equal(f.timers.size, 1); f.expire(10_000);
  const result = await work; assert.equal(result.bytes, 5); assert.ok(result.storageKey);
  assert.equal(f.elements[0].onerror, null); assert.equal(f.elements[0].onloadedmetadata, null); assert.equal(f.timers.size, 0);
  if (type.startsWith('video')) assert.equal(result.width, 1920);
});
test('视频元数据成功清除计时器', async () => {
  const f = mediaFixture(), work = f.media.uploadMediaFile(new Blob(['v'], { type: 'video/mp4' }));
  await tick(); f.elements[0].onloadedmetadata(); const result = await work;
  assert.equal(result.durationMs, 2000); assert.equal(f.timers.size, 0);
});
test('不完整引用清单只报告候选，原图/缩略图/媒体均保留，显式删除仍可用', async () => {
  const f = mediaFixture(); f.stores.get('media_files').set('video:history', new Blob(['v']));
  f.stores.get('image_files').set('image:undo', new Blob(['i'])); f.stores.get('image_previews').set('image:undo', { version: 1 });
  const media = await f.media.cleanupUnusedMedia({ assets: [] }), image = await f.image.cleanupUnusedImages({ projects: [] });
  assert.equal(media.status, 'retained'); assert.equal(media.candidates, 1); assert.equal(image.status, 'retained'); assert.equal(image.previews, 1);
  assert.equal(f.deletes.length, 0); await f.media.deleteStoredMedia(['video:history']); await f.image.deleteStoredImages(['image:undo']);
  assert.equal(f.stores.get('media_files').size, 0); assert.equal(f.stores.get('image_files').size, 0);
});
test('生成视频落盘失败向上传播，不返回远程URL假成功', async () => {
  const code = 唯一片段(source('services/api/video.ts'), 'export async function storeGeneratedVideo(', 'async function createOpenAIVideoTask(');
  const api = evaluate(code, {}, { uploadMediaFile: async () => { throw Error('synthetic-disk'); }, apiText: key => key });
  await assert.rejects(api.storeGeneratedVideo({ url: 'https://synthetic.example/video' }), /synthetic-disk/);
  await assert.rejects(api.storeGeneratedVideo({ blob: new Blob(['v']) }), /synthetic-disk/);
});
test('原图交付不等待后台缩略图', async () => {
  const pending = deferred(), f = mediaFixture({ thumbnail: () => pending.promise });
  const uploaded = await f.image.uploadImage(new Blob(['original'], { type: 'image/png' }));
  assert.ok(uploaded.storageKey); assert.equal(uploaded.bytes, 8); assert.ok(f.stores.get('image_files').has(uploaded.storageKey));
  assert.equal(f.stores.get('image_previews').size, 0); pending.resolve(undefined); await tick();
});
test('缩略图解码失败不写成功记录，下一次ensure可重试', async () => {
  let attempts = 0; const f = mediaFixture({ thumbnail: async () => { if (++attempts === 1) throw Error('synthetic-decode'); return new Blob(['preview'], { type: 'image/webp' }); } });
  const uploaded = await f.image.uploadImage(new Blob(['original'], { type: 'image/png' })); await tick();
  assert.equal(f.stores.get('image_previews').size, 0); await f.image.ensureImagePreview(uploaded.storageKey); await tick();
  assert.equal(attempts, 2); assert.equal(f.stores.get('image_previews').get(uploaded.storageKey).version, 2); assert.ok(f.image.previewUrlFor(uploaded.storageKey));
});
test('旧版已吞错误的version1空预览记录失效并重算', async () => {
  let attempts = 0; const f = mediaFixture({ thumbnail: async () => { attempts++; return undefined; } });
  f.stores.get('image_files').set('image:legacy', new Blob(['i'])); f.stores.get('image_previews').set('image:legacy', { version: 1 });
  await f.image.ensureImagePreview('image:legacy'); await tick(); assert.equal(attempts, 1);
  assert.equal(f.stores.get('image_previews').get('image:legacy').version, 2);
});

const modeApi = evaluate(source('guan/recovery/prompt-generation-mode.ts'));
const placementApi = evaluate(readFileSync(join(根目录, '扩展功能/画布布局/卡片自动避让.ts'), 'utf8'));
function batchFixture(nodes, connections = [], generate = async () => {}) {
  const project = source('pages/canvas/project.tsx'); let id = 0;
  const nodesRef = { current: nodes }, connectionsRef = { current: connections }, messages = [], calls = [];
  const nodeTypes = { Text: 'text', Config: 'config' };
  const globals = { nodesRef, connectionsRef, CanvasNodeType: nodeTypes, NODE_STATUS_LOADING: 'loading',
    useRef: value => ({ current: value }), useCallback: fn => fn,
    effectiveConfig: { imageModel: 'image-model', model: 'fallback', videoModel: 'video-model', audioModel: 'audio-model', textModel: 'text-model', size: '1024x1024', canvasImageCount: '2' },
    message: Object.fromEntries(['info', 'success', 'warning', 'error'].map(key => [key, text => messages.push([key, text])])),
    getGenerationCount: value => value || '1', promptGenerationMode: modeApi.promptGenerationMode,
    placeCanvasNode: placementApi.placeCanvasNode, nanoid: () => 'id-' + ++id, getNodeSpec: () => ({ width: 300, height: 250 }),
    createCanvasNode: (type, center, metadata) => ({ id: 'node-' + ++id, type, position: { x: center.x - 150, y: center.y - 125 }, width: 300, height: 250, metadata }),
    setNodes: value => { nodesRef.current = value; }, setConnections: value => { connectionsRef.current = value; }, setSelectedNodeIds: () => {}, setSelectedConnectionId: () => {},
    handleGenerateNode: async (...args) => { calls.push(args); await generate(...args); }, settleActivityGroup: recovery().settle.settleActivityGroup,
  };
  const batch = 唯一片段(project, '    const addGenerationConfigsForPromptNodes = useCallback(', '    const insertAssistantImage = useCallback(');
  const api = evaluate(projectHelpers() + '\n' + batch, {}, globals, 'exports.actions = { addGenerationConfigsForPromptNodes, generateAllConfigNodes, completeAndGenerateAll };');
  return { ...api.actions, nodesRef, connectionsRef, messages, calls };
}
const prompt = (id, metadata = {}, title = '提示词') => ({ id, type: 'text', title, position: { x: 0, y: 0 }, width: 300, height: 200, metadata: { content: 'A product on white 1600 x 2000 px 4 : 5 DETAIL IMAGE', ...metadata } });
const config = (id, metadata = {}) => ({ id, type: 'config', position: { x: 500, y: 0 }, width: 300, height: 250, metadata });
test('批量补齐跳过空正文和已有任意出线，保留已有卡参数，不重叠放置', () => {
  const existing = config('existing', { size: 'old-size', model: 'old-model' });
  const f = batchFixture([prompt('a'), prompt('b'), prompt('linked'), prompt('empty', { content: '' }), existing], [{ fromNodeId: 'linked', toNodeId: 'existing' }]);
  f.addGenerationConfigsForPromptNodes();
  const added = f.nodesRef.current.filter(node => node.type === 'config' && node.id !== 'existing');
  assert.equal(added.length, 2); assert.equal(added[0].metadata.size, '1600x2000'); assert.equal(added[0].metadata.generationAspectRatio, '4:5');
  assert.equal(added[0].metadata.generationImageType, 'detail image'); assert.equal(added[0].metadata.generationParamsDetected, true);
  assert.equal(placementApi.nodesOverlap(added[0], added[1], 48), false); assert.equal(existing.metadata.model, 'old-model');
  f.addGenerationConfigsForPromptNodes(); assert.equal(f.nodesRef.current.length, 7);
});
test('模式沿来源识别，正文偶然出现video不误判且能处理环', () => {
  const a = prompt('a', { content: 'video reference only', promptVariableSourceNodeId: 'b' }), b = prompt('b', { promptVariableSourceNodeId: 'a' }, '视频提示词');
  assert.equal(modeApi.promptGenerationMode(a, [a], []), undefined); assert.equal(modeApi.promptGenerationMode(a, [a, b], []), 'video');
  b.title = '普通提示词'; assert.equal(modeApi.promptGenerationMode(a, [a, b], []), undefined);
});
test('批量模式选择视频/音频/文本模型，源卡显式尺寸覆盖正文解析', () => {
  const f = batchFixture([prompt('v', { size: '1920x1080' }, '视频提示词'), prompt('a', {}, '语音提示词'), prompt('t', {}, '文本提示词')]);
  f.addGenerationConfigsForPromptNodes(); const added = f.nodesRef.current.filter(node => node.type === 'config');
  assert.deepEqual(plain(added.map(node => node.metadata.model)), ['video-model', 'audio-model', 'text-model']); assert.equal(added[0].metadata.size, '1920x1080');
});
test('批量最大3并发，防重入，单项失败后继续并排空', async () => {
  let active = 0, max = 0; const release = deferred();
  const f = batchFixture(Array.from({ length: 7 }, (_, i) => config('c' + i)), [], async id => { active++; max = Math.max(max, active); await release.promise; active--; if (id === 'c1') throw Error('synthetic'); });
  const work = f.generateAllConfigNodes(); await tick(); assert.equal(f.calls.length, 3); await f.generateAllConfigNodes(); assert.equal(f.calls.length, 3);
  release.resolve(); await work; assert.equal(f.calls.length, 7); assert.equal(max, 3); assert.equal(active, 0);
  assert.ok(f.messages.some(([kind, text]) => kind === 'warning' && text.includes('1 个任务')));
});
test('执行前重读最新节点，跳过已删除或已loading的排队项', async () => {
  const wait = deferred(), f = batchFixture(Array.from({ length: 6 }, (_, i) => config('c' + i)), [], async () => wait.promise);
  const work = f.generateAllConfigNodes(); await tick();
  f.nodesRef.current = f.nodesRef.current.filter(node => node.id !== 'c3').map(node => node.id === 'c4' ? { ...node, metadata: { status: 'loading' } } : node);
  wait.resolve(); await work; assert.deepEqual(f.calls.map(args => args[0]), ['c0', 'c1', 'c2', 'c5']);
});
test('补齐后无需React再渲染即可执行新配置，合并动作防重入', async () => {
  const wait = deferred(), f = batchFixture([prompt('p')], [], async () => wait.promise);
  const work = f.completeAndGenerateAll(); await tick(); assert.equal(f.calls.length, 1); assert.equal(f.nodesRef.current.length, 2);
  await f.completeAndGenerateAll(); assert.equal(f.calls.length, 1); wait.resolve(); await work;
});
test('已有配置执行时保持参数快照，不被连接来源覆盖', () => {
  const api = evaluate(projectHelpers(), {}, { CanvasNodeType: { Config: 'config' } }, 'exports.execute = generationNodeForExecution;');
  const p = prompt('p', { size: '9999x9999', model: 'changed' }), c = config('c', { size: '1024x1024', model: 'snapshot' });
  const out = api.execute(c, 'c', [p, c], [{ fromNodeId: 'p', toNodeId: 'c' }]); assert.equal(out, c); assert.equal(out.metadata.model, 'snapshot');
});
test('工具栏继承旧菜单、portal内点击保护与当前功能关闭策略', () => {
  const toolbar = source('components/canvas/canvas-toolbar.tsx');
  assert.match(toolbar, /batchMenuRef\.current\?\.contains/); assert.match(toolbar, /productFeatures\.nodePlugins/);
  for (const label of ['一键为未连接提示词补齐配置卡片并连线', '一键执行全部生成配置卡片', '一键补齐配置并执行全部生成任务']) assert.ok(toolbar.includes(label));
  assert.match(toolbar, /label=\{"产品参数设置"\}/);
  assert.equal(preview.delta.size, 14);
  for (const path of preview.delta.keys()) assert.equal(posix.normalize(path), path);
  assert.equal(plain(preview.integration).差异SHA256, '723841e0f57b5fb3bd21d9071b9223706833d4532ca3b3a463633e409eb1fb05');
});
