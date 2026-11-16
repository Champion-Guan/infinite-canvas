import test from 'node:test';
import assert from 'node:assert/strict';
import { variantModules } from './产品变体生成夹具.mjs';
import { deferCanvasMediaUrl, deferredCanvasMediaPreview, hasDeferredCanvasMedia, restoreCanvasMedia, releaseDeferredCanvasMedia, retainCanvasMedia } from '../扩展功能/本机存储/画布媒体延迟恢复.mjs';

test('有存储键的结果图直接显示预览，不恢复原图或替换节点；明确恢复仍可读取完整内容', async () => {
    let reads = 0;
    const url = deferCanvasMediaUrl(async () => { reads++; return 'blob:original'; });
    const node = { type: 'image', metadata: { storageKey: 'image:result', content: url } };
    try {
        assert.equal(hasDeferredCanvasMedia(node), true);
        assert.equal(hasDeferredCanvasMedia(node, { deferImageNodes: true }), false);
        assert.equal(await restoreCanvasMedia(node, { deferImageNodes: true }), node);
        assert.equal(reads, 0);
        const restored = await restoreCanvasMedia(node);
        assert.equal(reads, 1); assert.equal(restored.metadata.content, 'blob:original');
        assert.equal(node.metadata.content, url);
    } finally { releaseDeferredCanvasMedia(url); }
});

test('升级等待解码交接，缩小不降级，取消后的迟到图片不能覆盖当前显示', () => {
    const { createImageHandoff, validImageSource } = variantModules().load('媒体交付/图片解码交接.ts');
    const state = createImageHandoff();
    const small = state.prepare('image:a', 192, 0);
    assert.equal(state.current(), undefined);
    small.accept('data:image/webp;base64,small');
    const clear = state.prepare('image:a', 768, 0);
    assert.equal(state.current().edge, 192);
    clear.accept('data:image/webp;base64,clear');
    assert.equal(state.prepare('image:a', 192, 0), undefined);
    assert.equal(state.current().edge, 768);
    const original = state.prepare('image:a', Infinity, 0);
    state.cancel(); assert.equal(original.accept('blob:late'), undefined);
    assert.equal(state.current().source, 'data:image/webp;base64,clear');
    const changed = state.prepare('image:a', 192, 1);
    assert.equal(changed.edge, 768);
    changed.accept('data:image/webp;base64,replaced');
    const other = state.prepare('image:b', 192, 0);
    other.accept('data:image/webp;base64,other');
    assert.equal(state.current().key, 'image:b');
    for (const invalid of ['blob:guan-deferred:a', '[image omitted]', '', undefined]) assert.equal(validImageSource(invalid), undefined);
});

test('旧产品包只有内嵌原图时先生成预览，同一来源并发读取去重，不丢图片', async () => {
    let restores = 0, fetches = 0, conversions = 0;
    const previousFetch = globalThis.fetch, previousReader = globalThis.FileReader;
    globalThis.fetch = async () => { fetches++; return { ok: true, blob: async () => new Blob(['original']) }; };
    globalThis.FileReader = class {
        readAsDataURL() { this.result = 'data:image/webp;base64,cHJldmlldw=='; queueMicrotask(() => this.onload()); }
    };
    try {
        const { resolveEmbeddedCanvasPreview } = variantModules({
            '../本机存储/画布媒体延迟恢复.mjs': { deferredCanvasMediaPreview: () => undefined, restoreCanvasMedia: async () => { restores++; return 'blob:original'; } },
            '../本机存储/上游浏览器存储桥': {},
            './缩略图后台生成': { createImageThumbnailInBackground: async (_blob, _fallback, edge) => {
                conversions++; assert.equal(edge, 192); return new Blob(['preview'], { type: 'image/webp' });
            } },
        }).load('媒体交付/画布内嵌图片预览.ts');
        const urls = await Promise.all(Array.from({ length: 10 }, () => resolveEmbeddedCanvasPreview('blob:guan-deferred:old', 192)));
        assert.equal(new Set(urls).size, 1); assert.ok(urls[0]);
        assert.deepEqual([restores, fetches, conversions], [1, 1, 1]);
        assert.equal(await resolveEmbeddedCanvasPreview('blob:guan-deferred:old', Infinity), 'blob:original');
        assert.deepEqual([restores, fetches, conversions], [2, 1, 1]);
    } finally { globalThis.fetch = previousFetch; globalThis.FileReader = previousReader; }
});

test('下载和详情明确读取旧产品包原图时恢复延迟地址，保存原件而不是缩略图', async () => {
    let reads = 0;
    const original = new Blob(['original-file'], { type: 'image/png' }), saved = [];
    const url = deferCanvasMediaUrl(async () => { reads++; return 'blob:full-original'; });
    const { readDownloadBlob } = variantModules({
        '../本机存储/画布媒体延迟恢复.mjs': { restoreCanvasMedia },
        '@/services/image-storage': { getImageBlob: async () => undefined, setImageBlob: async (key, blob) => saved.push([key, blob]) },
        '@/services/file-storage': { getMediaBlob: async () => undefined },
        '@/stores/use-config-store': { withLocalProxy: source => source },
        '@/扩展功能/网络代理/本地转发请求': { 本地转发请求: async source => {
            assert.equal(source, 'blob:full-original'); return { ok: true, blob: async () => original };
        } },
    }).load('画布迁移扩展/media-download.ts');
    try {
        assert.equal(await readDownloadBlob({ kind: 'image', storageKey: 'image:old', url }), original);
        assert.equal(reads, 1); assert.deepEqual(saved, [['image:old', original]]);
    } finally { releaseDeferredCanvasMedia(url); }
});

test('同一原媒体刷新后读取持久预览，不再读取或解码原图；原件变化不误用旧缓存', async () => {
    const saved = new Map(), originals = [], generated = [], lookups = [];
    const previousReader = globalThis.FileReader;
    globalThis.FileReader = class { readAsDataURL(blob) { this.result = `blob:test-preview-${blob.size}`; queueMicrotask(() => this.onload()); } };
    const read = identity => deferCanvasMediaUrl(() => { throw Error('预览不创建原图URL'); }, () => {}, {
        identity, readBlob: async () => { originals.push(identity); return new Blob([identity]); },
    });
    const first = read('original-a'), reload = read('original-a'), changed = read('original-b');
    const load = () => variantModules({
        '../本机存储/画布媒体延迟恢复.mjs': { deferredCanvasMediaPreview, restoreCanvasMedia },
        '../本机存储/上游浏览器存储桥': { sqliteForage: { createInstance: () => ({
            getItem: async key => { lookups.push(key); return saved.get(key); },
            setItem: async (key, value) => { saved.set(key, value); },
        }) } },
        './缩略图后台生成': { createImageThumbnailInBackground: async (_blob, _fallback, edge) => {
            generated.push(edge); return new Blob(['small'], { type: 'image/webp' });
        } },
    }).load('媒体交付/画布内嵌图片预览.ts');
    try {
        const one = load();
        assert.equal(one.isEmbeddedCanvasImage(first), true);
        await Promise.all(Array.from({ length: 10 }, () => one.resolveEmbeddedCanvasPreview(first, 192)));
        assert.deepEqual(originals, ['original-a']); assert.deepEqual(generated, [192]);
        await load().resolveEmbeddedCanvasPreview(reload, 192);
        assert.deepEqual(originals, ['original-a']); assert.deepEqual(generated, [192]);
        assert.equal(lookups[0], lookups[1]); assert.ok(lookups[0].length < 128);
        await load().resolveEmbeddedCanvasPreview(changed, 192);
        assert.deepEqual(originals, ['original-a', 'original-b']); assert.notEqual(lookups[1], lookups[2]);
    } finally {
        globalThis.FileReader = previousReader;
        [first, reload, changed].forEach(releaseDeferredCanvasMedia);
    }
});

test('原图Blob读取跨休眠迟到时清理缓存；派生预览不会改变原媒体引用', async () => {
    let complete, released = 0;
    const url = deferCanvasMediaUrl(async () => 'blob:original', () => {}, {
        identity: 'original', readBlob: () => new Promise(resolve => { complete = resolve; }), release: () => { released++; },
    });
    const owner = retainCanvasMedia(url);
    const pending = deferredCanvasMediaPreview(url).readBlob();
    owner(); await Promise.resolve();
    complete(new Blob(['late']));
    await assert.rejects(pending, /休眠/);
    assert.ok(released >= 1); releaseDeferredCanvasMedia(url);
});

test('图片队列继续工作不依赖计时器，避免后台节流逐批拖慢，仍保留并发预算', async () => {
    const { createPreviewReadQueue } = variantModules().load('媒体交付/缩略图读取队列.ts');
    const queue = createPreviewReadQueue(4), timer = globalThis.setTimeout;
    let active = 0, peak = 0;
    globalThis.setTimeout = () => { throw Error('队列不应等待计时器'); };
    try {
        const values = await Promise.all(Array.from({ length: 100 }, (_, index) => queue(async () => {
            active++; peak = Math.max(peak, active);
            await Promise.resolve(); active--; return index;
        })));
        assert.equal(values.length, 100); assert.equal(peak, 4); assert.equal(active, 0);
    } finally { globalThis.setTimeout = timer; }
});

test('实际图片hook保留旧画面直至解码成功，40%回5%不重新读取，失败不清空已显示图片', async () => {
    let cursor = 0, effects = [], revision = 0, embedded = false, embeddedReads = 0;
    const cells = [], reads = [], decodes = [];
    const handoff = variantModules().load('媒体交付/图片解码交接.ts');
    const react = {
        useCallback: value => value,
        useSyncExternalStore: (_subscribe, get) => get(),
        useState() { const cell = cells[cursor++] ??= {}; return [cell.value, next => { cell.value = next; }]; },
        useRef(initial) { const index = cursor++; return cells[index] ??= { current: initial }; },
        useEffect(callback, deps) {
            const index = cursor++, old = cells[index];
            if (!old || deps.some((value, at) => value !== old.deps[at])) effects.push(() => {
                old?.cleanup?.(); cells[index] = { deps, cleanup: callback() };
            });
        },
    };
    const fixture = variantModules({ react,
        '@/services/image-storage': {
            subscribeImagePreviews: () => () => {}, getImagePreviewRevision: () => revision,
            resolveCanvasImageSource: async (key, edge) => { reads.push([key, edge]); return `data:image/webp;${edge}:${revision}`; },
            resolveImageUrl: async key => { reads.push([key, Infinity]); return 'blob:original'; },
        },
        './图片解码交接': { ...handoff, decodeImageSource: source => new Promise((resolve, reject) => decodes.push({ source, resolve, reject })) },
        './画布内嵌图片预览': { isEmbeddedCanvasImage: () => embedded, resolveEmbeddedCanvasPreview: async () => {
            if (!embedded) return undefined;
            embeddedReads++; return 'blob:embedded-preview';
        } },
    });
    const { useResidentCanvasImage } = fixture.load('媒体交付/画布图片连续显示.ts');
    const render = (edge, key = 'image:a') => {
        cursor = 0; effects = []; const source = useResidentCanvasImage(key, 'blob:guan-deferred:x', edge);
        effects.forEach(effect => effect()); return source;
    };
    const tick = () => new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(render(100), undefined); await tick();
    decodes.shift().resolve(); await tick();
    const small = render(100); assert.match(small, /192/);
    assert.equal(render(400), small); await tick();
    assert.equal(render(400), small);
    assert.equal(render(100), small); await tick();
    assert.equal(decodes.length, 1, '缩小时不取消正在解码的升级图，也不重排同一张图');
    decodes.shift().resolve(); await tick();
    const clear = render(400); assert.match(clear, /768/);
    assert.equal(render(100), clear); await tick(); assert.equal(reads.length, 2);
    revision++;
    assert.equal(render(100), clear); await tick();
    decodes.shift().reject(new Error('解码失败')); await tick();
    assert.equal(render(100), clear);
    assert.equal(render(400, 'image:b'), undefined); await tick();
    assert.equal(reads.at(-1)[1], 192, '高倍率首次打开也先出轻量预览');
    assert.equal(render(100, 'image:b'), undefined); await tick();
    assert.equal(decodes.length, 1);
    const beforeReady = reads.length;
    decodes.shift().resolve(); await tick();
    assert.ok(render(100, 'image:b'));
    assert.equal(reads.length, beforeReady, '缩回低倍率后不再继续读取过时的高清目标');
    const before = reads.length;
    embedded = true;
    assert.equal(render(100, 'image:c'), undefined); await tick();
    decodes.shift().resolve(); await tick();
    assert.equal(render(100, 'image:c'), 'blob:embedded-preview');
    assert.equal(reads.length, before); assert.equal(embeddedReads, 1);
    embedded = false;
    assert.equal(render(400, 'image:d'), undefined); await tick();
    assert.equal(reads.at(-1)[1], 192);
    decodes.shift().resolve(); await tick();
    const firstPaint = render(400, 'image:d');
    assert.match(firstPaint, /192/, '高清尚在解码时先显示已经就绪的小预览');
    assert.equal(reads.at(-1)[1], 768); assert.equal(decodes.length, 1);
    cells.forEach(cell => cell?.cleanup?.());
    decodes.shift().resolve(); await tick();
    assert.equal(render(400, 'image:d'), firstPaint, '卸载后的迟到解码不能继续升级画面');
});
