import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../.运行/3100源/画布副本/web/package.json', import.meta.url));
const ts = require('typescript');
const js = ts.transpileModule(readFileSync(new URL('../扩展功能/媒体交付/编辑图片读取.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const module = { exports: {} };
new Function('require', 'module', 'exports', js)(id => {
    assert.ok(['react', 'react/jsx-runtime'].includes(id)); return {};
}, module, module.exports);
const { loadEditorImage } = module.exports;
function fixture() {
    const results = [], timers = new Map(); let timerId = 0, removed = 0;
    const image = { src: '', naturalWidth: 0, naturalHeight: 0, onload: null, onerror: null,
        removeAttribute(name) { assert.equal(name, 'src'); removed++; } };
    const cancel = loadEditorImage('blob:原图', value => results.push(value), { createImage: () => image,
        schedule: callback => { timers.set(++timerId, callback); return timerId; }, unschedule: id => timers.delete(id) });
    return { image, results, timers, cancel, get removed() { return removed; } };
}

test('编辑器只接收真实尺寸，成功后释放定时器和事件，迟到超时不会重复回调', () => {
    const f = fixture(), timeout = [...f.timers.values()][0];
    f.image.naturalWidth = 1584; f.image.naturalHeight = 992; f.image.onload(); timeout();
    assert.deepEqual(f.results, [{ image: { width: 1584, height: 992 }, error: '' }]);
    assert.equal(f.timers.size, 0); assert.equal(f.image.onload, null); assert.equal(f.image.onerror, null); assert.equal(f.removed, 1);
});

test('损坏、零尺寸或超时都明确失败，不能编造1024尺寸；超时结束后重试可成功', () => {
    for (const trigger of ['error', 'zero', 'timeout']) {
        const f = fixture();
        if (trigger === 'error') f.image.onerror();
        else if (trigger === 'zero') f.image.onload();
        else [...f.timers.values()][0]();
        assert.equal(f.results.length, 1); assert.equal(f.results[0].image, null); assert.match(f.results[0].error, /失败|超时/);
        assert.equal(f.timers.size, 0); f.cancel(); assert.equal(f.removed, 1);
    }
    const retry = fixture(); retry.image.naturalWidth = 900; retry.image.naturalHeight = 1200; retry.image.onload();
    assert.deepEqual(retry.results[0].image, { width: 900, height: 1200 });
});

test('关闭或换图取消旧读取，即使旧load/error迟到也不回写，更不覆盖新图', () => {
    const old = fixture(), onload = old.image.onload, onerror = old.image.onerror;
    old.cancel(); old.image.naturalWidth = 1024; old.image.naturalHeight = 1024; onload(); onerror();
    assert.equal(old.results.length, 0); assert.equal(old.timers.size, 0); assert.equal(old.removed, 1);
    const next = fixture(); next.image.naturalWidth = 1152; next.image.naturalHeight = 1536; next.image.onload();
    assert.deepEqual(next.results[0].image, { width: 1152, height: 1536 });
});
