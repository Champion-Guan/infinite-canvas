import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { variantModules } from './产品变体生成夹具.mjs';

const require = createRequire(resolve('.运行/3100源/画布副本/web/package.json'));
const fflate = require('fflate');
const node = (id, type, metadata, title = id) => ({ id, type, title, metadata });

function fixture(read) {
    const errors = [], warnings = [], states = [], effects = [];
    const loader = variantModules({
        react: { useCallback: fn => fn, useRef: current => ({ current }), useState: value => [value, next => states.push(next)], useEffect: fn => effects.push(fn) },
        fflate,
        'file-saver': { saveAs() { throw Error('多文件应只触发一次ZIP下载'); } },
        '@/lib/canvas/canvas-generation-helpers': { audioExtension: () => 'mp3' },
        '../画布迁移扩展/media-download': { readDownloadBlob: read },
    });
    const exports = loader.load('媒体交付/画布下载操作.ts');
    const hook = exports.useCanvasMediaDownloads({ error: text => errors.push(text), warning: text => warnings.push(text) });
    const cleanup = effects.map(fn => fn()).filter(Boolean);
    return { ...exports, ...hook, errors, warnings, states, cleanup: () => cleanup.forEach(fn => fn()) };
}

test('只收集所选媒体；批次包含全部成功图片，失败、空节点和文本不进入下载', () => {
    const f = fixture();
    const files = f.selectedDownloadFiles([
        node('batch', 'image', { images: [
            { id: 'a', status: 'success', storageKey: 'original-a', name: '第一张' },
            { id: 'b', status: 'error', content: '旧预览' },
            { id: 'c', status: 'success', storageKey: 'original-c' },
        ] }),
        node('video', 'video', { storageKey: 'original-video' }),
        node('audio', 'audio', { content: 'audio-url' }),
        node('empty', 'image', {}),
        node('error', 'image', { status: 'error', content: '旧预览' }),
        node('text', 'text', { content: '文字' }),
    ]);
    assert.deepEqual(files.map(file => file.kind), ['image', 'image', 'video', 'audio']);
    assert.deepEqual(files.map(file => file.storageKey), ['original-a', 'original-c', 'original-video', undefined]);
    assert.equal(files[0].name, '第一张');
    f.cleanup();
});

test('所选文件原字节进入单一ZIP，同名不覆盖，读取失败明确提示，重复点击不重复读取', async () => {
    const globals = { document: globalThis.document, window: globalThis.window };
    const create = URL.createObjectURL, revoke = URL.revokeObjectURL;
    const downloads = [], blobs = [], calls = [], timers = [];
    try {
        globalThis.document = { body: { appendChild() {} }, createElement: () => ({ style: {}, remove() {}, click() { downloads.push({ name: this.download, href: this.href }); } }) };
        globalThis.window = { setTimeout: fn => timers.push(fn) };
        URL.createObjectURL = blob => { blobs.push(blob); return 'blob:test'; };
        URL.revokeObjectURL = () => {};
        let unblock;
        const gate = new Promise(resolve => { unblock = resolve; });
        const f = fixture(async file => {
            calls.push(file.storageKey); await gate;
            if (file.storageKey === 'missing') throw Error('missing');
            return new Blob([file.storageKey === 'a' ? new Uint8Array([1, 2, 3]) : new Uint8Array([7, 8])], { type: 'image/png' });
        });
        const selection = [node('a', 'image', { storageKey: 'a' }, '同名'), node('b', 'image', { storageKey: 'b' }, '同名'), node('c', 'image', { storageKey: 'missing' })];
        const first = f.downloadSelected(selection);
        await f.downloadSelected(selection);
        unblock(); await first;
        assert.deepEqual(calls, ['a', 'b', 'missing']);
        assert.equal(downloads.length, 1); assert.equal(downloads[0].name, '所选文件.zip');
        const archive = fflate.unzipSync(new Uint8Array(await blobs[0].arrayBuffer()));
        assert.deepEqual(Object.keys(archive), ['同名.png', '同名-2.png']);
        assert.deepEqual([...archive['同名.png']], [1, 2, 3]);
        assert.deepEqual([...archive['同名-2.png']], [7, 8]);
        assert.deepEqual(f.states, [true, false]);
        assert.equal(f.errors.length, 0); assert.match(f.warnings[0], /2.*1/);
        timers.forEach(fn => fn()); f.cleanup();
    } finally {
        URL.createObjectURL = create; URL.revokeObjectURL = revoke;
        for (const [key, value] of Object.entries(globals)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }
    }
});
