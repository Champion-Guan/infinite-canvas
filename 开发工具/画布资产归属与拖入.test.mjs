import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { ts } from './检查首批功能适配.mjs';

const source = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
function load(text, imports = {}, globals = {}) {
    const context = vm.createContext({ exports: {}, File, Blob, setTimeout, clearTimeout, console, ...globals, require(name) {
        assert.ok(name in imports, '未知导入：' + name); return imports[name];
    } });
    vm.runInContext(ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, context);
    return context.exports;
}
const rules = () => load(source('扩展功能/素材/上传资产规则.ts'));
const plain = value => JSON.parse(JSON.stringify(value));
const image = { url: 'blob:preview', storageKey: 'image:delivery', originalStorageKey: 'image:original', deliveryStorageKey: 'image:delivery', width: 900, height: 1200, bytes: 500, mimeType: 'image/jpeg', originalWidth: 1800, originalHeight: 2400, originalMimeType: 'image/heic', originalBytes: 6000000, deliveryWidth: 900, deliveryHeight: 1200 };
function registry(rule = rules()) {
    let state = { hydrated: true, assets: [], addAsset(asset) {
        const id = String(state.assets.length + 1); state.assets.push({ ...asset, id }); return id;
    } };
    const listeners = new Set();
    const store = { getState: () => state, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); } };
    return { rule, store, state, listeners, api: load(source('扩展功能/素材/上传资产登记.ts'), { '@/stores/use-asset-store': { useAssetStore: store }, './上传资产规则': rule }) };
}

test('上传开始捕获画布，异步结束前切换画布也不会串归属；旧激活清理不影响新激活', async () => {
    const { rule, state, api } = registry();
    const clearA = rule.activateAssetProject('A');
    const owner = rule.captureUserUpload(new File(['x'], '产品.heic', { type: 'image/heic' }));
    rule.activateAssetProject('B'); clearA();
    await api.registerUploadedAsset(owner, 'image', image);
    assert.equal(state.assets[0].metadata.projectId, 'A');
    assert.equal(rule.captureUserUpload(new File(['x'], 'B.png')).projectId, 'B');
    assert.equal(state.assets[0].title, '产品.heic');
    assert.equal(state.assets[0].data.originalStorageKey, 'image:original');
    assert.equal(state.assets[0].data.originalBytes, 6000000);
});

test('恢复、远程缓存、生成Blob不冒充用户上传；无画布上传不认领其他画布', () => {
    const rule = rules();
    assert.equal(rule.captureUserUpload(new Blob(['x'])), null);
    assert.equal(rule.captureUserUpload('data:image/png;base64,eA=='), null);
    assert.equal(rule.captureUserUpload('https://example.invalid/a.png'), null);
    assert.equal(rule.captureUserUpload(new File(['x'], '独立上传.png')).projectId, undefined);
    assert.equal(rule.captureUserUpload(new File(['x'], '替换.png'), '固定画布').projectId, '固定画布');
});

test('同一存储文件在同画布只登记一次，不合并不同画布或不同媒体类型', async () => {
    const { state, api } = registry();
    const owner = { projectId: 'A', name: '测试.png' };
    const ids = await Promise.all([api.registerUploadedAsset(owner, 'image', image), api.registerUploadedAsset(owner, 'image', image)]);
    assert.equal(ids[0], ids[1]); assert.equal(state.assets.length, 1);
    await api.registerUploadedAsset({ ...owner, projectId: 'B' }, 'image', image);
    await api.registerUploadedAsset(owner, 'video', { url: 'blob:v', storageKey: 'video:1', width: 1920, height: 1080, durationMs: 1600, bytes: 200, mimeType: 'video/mp4' });
    await api.registerUploadedAsset(owner, 'audio', { url: 'blob:a', storageKey: 'audio:1', durationMs: 900, bytes: 100, mimeType: 'audio/wav' });
    assert.equal(state.assets.length, 4);
    assert.equal(state.assets[2].data.durationMs, 1600); assert.equal(state.assets[3].kind, 'audio');
});

test('资产恢复未完成时等待，不能覆盖恢复出的原有资产', async () => {
    const { state, api, listeners } = registry(); state.hydrated = false;
    const pending = api.registerUploadedAsset({ projectId: 'A', name: '新图' }, 'image', image);
    assert.equal(state.assets.length, 0);
    state.assets.push({ id: '旧资产', kind: 'text', data: { content: '原有数据' } });
    state.hydrated = true; for (const fn of [...listeners]) fn(state);
    await pending;
    assert.equal(state.assets[0].id, '旧资产'); assert.equal(state.assets.length, 2); assert.equal(listeners.size, 0);
});

test('拖动只传资产标识，拒绝跨画布、错误版本、空ID和外部伪造内容', () => {
    const rule = rules(), data = rule.assetDragData('图片1', 'A');
    assert.equal(rule.readAssetDrag(data, 'A'), '图片1'); assert.equal(rule.readAssetDrag(data, 'B'), null);
    for (const bad of ['', '{}', 'null', '[]', '{', JSON.stringify({ version: 2, projectId: 'A', assetId: '1' }), JSON.stringify({ version: 1, projectId: 'A', assetId: '' })]) assert.equal(rule.readAssetDrag(bad, 'A'), null);
    assert.equal(data.includes('blob:'), false);
});

function nodeBuilder() {
    const types = { CanvasNodeType: { Image: 'image', Text: 'text', Video: 'video', Audio: 'audio' } };
    const sizing = load(source('.运行/3100源/画布副本/web/src/lib/canvas/canvas-node-size.ts'));
    const factory = load(source('.运行/3100源/画布副本/web/src/lib/canvas/canvas-node-factory.ts'), {
        '@/constant/canvas': { getNodeSpec: () => ({ width: 320, height: 200, title: '默认' }), NODE_DEFAULT_SIZE: {} },
        '@/lib/canvas/canvas-node-size': sizing, '@/types/canvas': types,
    });
    return load(source('扩展功能/素材/资产画布节点.ts'), { '@/lib/canvas/canvas-node-factory': factory, '@/lib/canvas/canvas-node-size': sizing, '@/types/canvas': types });
}

test('三类媒体按落点居中，图片保留原图/交付图，音视频保留时长和存储引用', async () => {
    const { state, api } = registry(), builder = nodeBuilder();
    await api.registerUploadedAsset({ projectId: 'A', name: '原图' }, 'image', image);
    await api.registerUploadedAsset({ projectId: 'A', name: '视频' }, 'video', { url: 'blob:v', storageKey: 'video:v', width: 1920, height: 1080, durationMs: 1000, bytes: 100, mimeType: 'video/mp4' });
    await api.registerUploadedAsset({ projectId: 'A', name: '音频' }, 'audio', { url: 'blob:a', storageKey: 'audio:a', durationMs: 2000, bytes: 20, mimeType: 'audio/wav' });
    for (const asset of state.assets) {
        const node = builder.assetCanvasNode(asset, { x: -310.5, y: 945.25 });
        assert.equal(node.type, asset.kind); assert.equal(node.title, asset.title);
        assert.equal(node.position.x + node.width / 2, -310.5); assert.equal(node.position.y + node.height / 2, 945.25);
        assert.equal(node.metadata.storageKey, asset.data.storageKey); assert.equal(node.metadata.status, 'success');
        if (asset.kind === 'image') { assert.equal(node.metadata.originalStorageKey, 'image:original'); assert.equal(node.metadata.originalWidth, 1800); assert.equal(node.metadata.naturalWidth, 900); }
        else assert.equal(node.metadata.durationMs, asset.data.durationMs);
    }
});

test('资产插入使用已存媒体且进入原有节点事务；拒绝其他画布与已移除资产', async () => {
    const { state, api, store } = registry(), builder = nodeBuilder();
    await api.registerUploadedAsset({ projectId: 'A', name: '图片' }, 'image', image);
    let nodes = [], selected, connection = 'old', errors = [], resolves = 0, placements = [];
    const hook = load(source('扩展功能/素材/资产插入操作.ts'), {
        react: { useCallback: fn => fn }, '@/stores/use-asset-store': { useAssetStore: store },
        '@/stores/canvas/use-canvas-store': { useCanvasStore: { getState: () => ({ projects: [{ id: 'A' }, { id: 'B' }] }) } },
        '@/services/image-storage': { async resolveImageUrl() { resolves++; return 'blob:resolved'; } },
        '@/services/file-storage': { resolveMediaUrl() { throw Error('图片不应访问音视频存储'); } }, './资产画布节点': builder,
        './资产可见落点': load(source('扩展功能/素材/资产可见落点.ts'), { '../画布布局/卡片自动避让': load(source('扩展功能/画布布局/卡片自动避让.ts')) }),
    });
    const insert = projectId => hook.useCanvasAssetInsertion({ projectId, setNodes: (fn, placement) => { nodes = fn(nodes); placements.push(placement); }, setSelectedNodeIds: value => { selected = value; }, setSelectedConnectionId: value => { connection = value; }, onError: error => errors.push(error) });
    await insert('B')(state.assets[0].id, { x: 20, y: 30 }); assert.equal(nodes.length, 0);
    await insert('A')('不存在', { x: 20, y: 30 }); assert.equal(nodes.length, 0); assert.equal(errors.length, 2);
    await insert('A')(state.assets[0].id, { x: 20, y: 30 }); assert.equal(nodes.length, 1); assert.equal(resolves, 1);
    assert.equal(nodes[0].metadata.content, 'blob:resolved'); assert.equal(selected.has(nodes[0].id), true); assert.equal(connection, null);
    assert.equal(state.assets.length, 1, '拖入只新增节点，不新增资产或上传媒体');
    await insert('A')(state.assets[0].id, { x: 20, y: 30 }, 'exact');
    assert.equal(nodes.length, 2);
    assert.deepEqual(plain(nodes[1].position), plain(nodes[0].position), '资产拖入同样以松手位置为准，允许重叠');
    assert.equal(placements.at(-1), 'exact', '同时通知公共事务跳过本次避让');
});

test('外部拖放真实入口对图片、视频、音频保留转换后的松手位置和多文件错位，不受已有卡片阻挡', async () => {
    const placement = load(source('扩展功能/画布布局/卡片自动避让.ts'));
    const transaction = load(source('扩展功能/画布生成/画布节点事务.ts'), {
        react: { useCallback: fn => fn, useState: value => [value, () => {}], useRef: value => ({ current: value }) },
        '../Excel画布/Excel卡片事务': { reconcileExcelPreviews: (_previous, next) => next },
        '../画布布局/卡片自动避让': placement,
    }).useCanvasNodeTransactions();
    const old = { id: 'old', type: 'image', position: { x: -2000, y: -2000 }, width: 10000, height: 10000, metadata: {} };
    transaction.setRawNodes([old]);
    const file = '.运行/3100源/画布副本/web/src/pages/canvas/project.tsx';
    const ast = ts.createSourceFile(file, source(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const names = ['createImageFileNode', 'createVideoFileNode', 'createAudioFileNode', 'handleDrop'];
    const statements = new Map();
    function visit(node) {
        if (ts.isVariableStatement(node)) for (const decl of node.declarationList.declarations) {
            if (ts.isIdentifier(decl.name) && names.includes(decl.name.text)) statements.set(decl.name.text, node.getText(ast));
        }
        ts.forEachChild(node, visit);
    }
    visit(ast); assert.equal(statements.size, names.length);
    const api = load([...statements.values()].join('\n') + '\nexports.handleDrop = handleDrop;', {}, {
        useCallback: fn => fn, ...transaction, projectId: 'A',
        setSelectedNodeIds() {}, setSelectedConnectionId() {}, setDialogNodeId() {},
        attemptImageUpload: fn => fn(), message: { error: text => assert.fail(text) },
        uploadImage: async () => ({ ...image, width: 240, height: 180 }),
        uploadMediaFile: async () => ({ url: 'blob:media', storageKey: 'media:test', width: 320, height: 180 }),
        fitNodeSize: load(source('.运行/3100源/画布副本/web/src/lib/canvas/canvas-node-size.ts')).fitNodeSize,
        imageMetadata: value => ({ content: value.url }), videoMetadata: value => ({ content: value.url }), audioMetadata: value => ({ content: value.url }),
        CanvasNodeType: { Image: 'image', Video: 'video', Audio: 'audio' }, NODE_DEFAULT_SIZE: { audio: { width: 340, height: 120 } },
        VIDEO_NODE_MAX_WIDTH: 420, VIDEO_NODE_MAX_HEIGHT: 420,
        screenToCanvas: (x, y) => ({ x: (x - 100) / 0.5, y: (y - 50) / 0.5 }),
        ASSET_DRAG_TYPE: 'application/x-guan-canvas-asset', EXCEL_PROMPT_DRAG_TYPE: 'application/x-excel', dropExcelCards: () => false,
        isAudioFile: file => file.type.startsWith('audio/'), hasHeicNameOrType: () => false, insertStoredAsset() {},
    });
    const files = [new File(['i'], '图.png', { type: 'image/png' }), new File(['v'], '视频.mp4', { type: 'video/mp4' }), new File(['a'], '音频.wav', { type: 'audio/wav' })];
    api.handleDrop({ preventDefault() {}, clientX: 280.25, clientY: 315.5, dataTransfer: { types: ['Files'], files, getData: () => '' } });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(transaction.nodesRef.current.length, 4);
    for (const [index, file] of files.entries()) {
        const node = transaction.nodesRef.current.find(item => item.title === file.name);
        assert.ok(node); assert.equal(node.position.x + node.width / 2, 360.5 + index * 40);
        assert.equal(node.position.y + node.height / 2, 531 + index * 40);
        assert.ok(placement.nodesOverlap(node, old), '拖入卡片按鼠标位置覆盖已有卡片');
    }
    assert.equal(transaction.getCurrentNode('old'), old);
});

test('真实图片上传入口在首次await前捕获归属，成功才登记；生成和失败不误登记', async () => {
    const file = '.运行/3100源/画布副本/web/src/services/image-storage.ts', text = source(file);
    const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const fn = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'uploadImage').getText(ast);
    const rule = rules(); let finish, registrations = [];
    const api = load(fn, { '@/扩展功能/素材/上传资产登记': { async registerUploadedAsset(...args) { registrations.push(args); } } }, {
        captureUserUpload: rule.captureUserUpload, storeImage: () => new Promise(resolve => { finish = resolve; }),
    });
    rule.activateAssetProject('A'); const pending = api.uploadImage(new File(['x'], '上传.png'));
    rule.activateAssetProject('B'); finish(image); await pending;
    assert.equal(registrations[0][0].projectId, 'A');
    const generated = api.uploadImage(new File(['x'], '生成.png'), { registerAsset: false }); finish(image); await generated;
    assert.equal(registrations.length, 1);
    const failed = load(fn, {}, { captureUserUpload: rule.captureUserUpload, storeImage: async () => { throw Error('存储失败'); } });
    await assert.rejects(failed.uploadImage(new File(['x'], '坏图.png')), /存储失败/);
});

test('真实音视频上传入口捕获原画布，登记成功后返回；生成Blob只保存文件', async () => {
    const file = '.运行/3100源/画布副本/web/src/services/file-storage.ts', text = source(file);
    const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const fn = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'uploadMediaFile').getText(ast);
    const rule = rules(); let finish, registrations = [], writes = 0;
    const api = load(fn, { '@/扩展功能/素材/上传资产登记': { async registerUploadedAsset(...args) { registrations.push(args); } } }, {
        captureUserUpload: rule.captureUserUpload, nanoid: () => String(++writes),
        store: { setItem: () => new Promise(resolve => { finish = resolve; }) },
        URL: { createObjectURL: () => 'blob:stored' }, objectUrls: new Map(),
        readVideoMeta: async () => ({ width: 1920, height: 1080, durationMs: 1500 }), readAudioMeta: async () => ({ durationMs: 1000 }),
    });
    for (const kind of ['video', 'audio']) {
        rule.activateAssetProject('A');
        const pending = api.uploadMediaFile(new File(['media'], '上传文件', { type: kind + '/test' }), kind);
        rule.activateAssetProject('B'); finish(); const result = await pending;
        const entry = registrations.at(-1);
        assert.equal(entry[0].projectId, 'A'); assert.equal(entry[1], kind); assert.equal(entry[2].storageKey, result.storageKey);
        assert.ok(result.durationMs > 0);
    }
    const generated = api.uploadMediaFile(new Blob(['generated'], { type: 'video/mp4' }), 'video'); finish(); await generated;
    assert.equal(registrations.length, 2); assert.equal(writes, 3);
});

test('拥挤落点优先找可见空位，保留间隔且不把视频沿现有卡片一路挤到屏幕下方', () => {
    const layout = load(source('扩展功能/画布布局/卡片自动避让.ts'));
    const { placeAssetNode } = load(source('扩展功能/素材/资产可见落点.ts'), { '../画布布局/卡片自动避让': layout });
    const make = (id, x, y, width = 240, height = 180) => ({ id, type: 'video', position: { x, y }, width, height });
    const occupied = [make('old-video', 518, 239), make('old-image', 558, 467), make('old-audio', 548, 695, 340, 120), make('dropped-image', 78, 86), make('dropped-audio', 44, 354, 340, 120)];
    const before = plain(occupied), bounds = { x: 42, y: 81, width: 1102, height: 431 };
    const positioned = placeAssetNode(make('new-video', 789, 51), occupied, bounds);
    assert.ok(positioned.position.y >= bounds.y && positioned.position.y + positioned.height <= bounds.y + bounds.height);
    assert.ok(positioned.position.x >= bounds.x && positioned.position.x + positioned.width <= bounds.x + bounds.width);
    assert.equal(occupied.some(other => layout.nodesOverlap(positioned, other, 48)), false);
    assert.deepEqual(plain(occupied), before);
    const safe = make('free', 850, 90);
    assert.deepEqual(plain(placeAssetNode(safe, occupied, bounds).position), safe.position);
});
