import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(new URL("../.运行/3100源/画布副本/web/package.json", import.meta.url));
const ts = require("typescript");
function cacheFactory(Reader) {
    const source = readFileSync(new URL("../扩展功能/媒体交付/缩略图缓存.ts", import.meta.url), "utf8");
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const module = { exports: {} };
    new Function("module", "exports", "FileReader", code)(module, module.exports, Reader);
    return module.exports.createThumbnailCache;
}
class Reader {
    readAsDataURL(blob) {
        blob.arrayBuffer().then(buffer => {
            this.result = `data:${blob.type};base64,${Buffer.from(buffer).toString("base64")}`;
            this.onload?.();
        });
    }
}

test("缩略图正常编码、空结果及异常路径都释放位图和画布 backing store", async () => {
    const source = readFileSync(new URL("../.运行/3100源/画布副本/web/src/lib/image-thumbnail.ts", import.meta.url), "utf8");
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    for (const scenario of ["success", "small", "no-context", "draw-error", "encode-error", "empty"]) {
        let closed = 0, canvasCreated = false;
        const bitmap = { width: scenario === "small" ? 100 : 2000, height: 100, close() { closed++; } };
        const canvas = {
            width: 0, height: 0,
            getContext() {
                if (scenario === "no-context") return null;
                return { drawImage() { if (scenario === "draw-error") throw Error("draw failed"); } };
            },
            toBlob(callback) {
                assert.equal(closed, 1, "编码开始前释放原始位图");
                if (scenario === "encode-error") throw Error("encode failed");
                callback(scenario === "empty" ? null : new Blob(["preview"]));
            },
        };
        const module = { exports: {} };
        new Function("module", "exports", "createImageBitmap", "document", code)(module, module.exports,
            async () => bitmap, { createElement() { canvasCreated = true; return canvas; } });
        const task = module.exports.createImageThumbnail(new Blob(["original"]));
        if (scenario.endsWith("error")) await assert.rejects(task);
        else assert.equal(Boolean(await task), scenario === "success");
        assert.equal(closed, 1, scenario);
        assert.equal(canvasCreated, scenario !== "small");
        assert.equal(canvas.width, 0, scenario);
        assert.equal(canvas.height, 0, scenario);
    }
});

test("连续浏览10000张缩略图仍受条目与字节双预算约束，淘汰不破坏已交付的图片", async () => {
    const cache = cacheFactory(Reader)({ maxEntries: 128, maxBytes: 8192 });
    let first;
    for (let index = 0; index < 10000; index++) {
        const source = await cache.resolve(String(index), async () => new Blob([`preview-${index}`], { type: "image/webp" }));
        first ||= source;
        assert.ok(cache.status().entries <= 128);
        assert.ok(cache.status().bytes <= 8192);
    }
    assert.equal(cache.get("0"), undefined);
    assert.equal(Buffer.from(first.split(",")[1], "base64").toString(), "preview-0");
    assert.equal(cache.status().pending, 0);
    assert.ok(cache.status().entries > 0);
});

test("LRU保留最近访问，超大预览可显示但不占缓存，失败后可重试", async () => {
    const cache = cacheFactory(Reader)({ maxEntries: 2, maxBytes: 1024 });
    const read = async () => new Blob(["preview"]);
    await cache.resolve("a", read); await cache.resolve("b", read); cache.get("a");
    await cache.resolve("c", read);
    assert.ok(cache.get("a")); assert.equal(cache.get("b"), undefined);
    const large = await cache.resolve("large", async () => new Blob(["a".repeat(2048)]));
    assert.ok(large); assert.equal(cache.get("large"), undefined);
    assert.equal(await cache.resolve("fail", async () => { throw Error("read failed"); }), undefined);
    assert.ok(await cache.resolve("fail", read));
    assert.equal(cache.status().pending, 0);
});

test("缩略图编码失败可降级且不留下在途记录，下一次读取仍可成功", async () => {
    let fail = true;
    class UnreliableReader extends Reader {
        readAsDataURL(blob) {
            if (fail) queueMicrotask(() => this.onerror?.());
            else super.readAsDataURL(blob);
        }
    }
    const cache = cacheFactory(UnreliableReader)();
    assert.equal(await cache.resolve("image", async () => new Blob(["image"])), undefined);
    assert.equal(cache.status().pending, 0);
    fail = false;
    assert.ok(await cache.resolve("image", async () => new Blob(["image"])));
});
test("100次并发只读一次；删除后迟到的读取和编码不能恢复缓存或覆盖新图片", async () => {
    const cache = cacheFactory(Reader)(); let reads = 0, finish;
    const same = await Promise.all(Array.from({ length: 100 }, () => cache.resolve("same", async () => { reads++; return new Blob(["same"]); })));
    assert.equal(reads, 1); assert.equal(new Set(same).size, 1);
    const pending = cache.resolve("late", () => new Promise(resolve => { finish = resolve; }));
    await Promise.resolve(); cache.delete("late");
    const replacement = await cache.resolve("late", async () => new Blob(["new"]));
    finish(new Blob(["old"]));
    assert.equal(await pending, undefined);
    assert.equal(cache.get("late"), replacement);
    const readers = [];
    class DelayedReader { readAsDataURL() { readers.push(this); } }
    const encodingCache = cacheFactory(DelayedReader)();
    const encoding = encodingCache.resolve("encoding", async () => new Blob(["old"]));
    await new Promise(resolve => setImmediate(resolve));
    encodingCache.delete("encoding");
    readers[0].result = "data:image/webp;base64,b2xk";
    readers[0].onload();
    assert.equal(await encoding, undefined);
    assert.equal(encodingCache.status().entries, 0);
    assert.equal(readers[0].onload, null);
});

test("列表缩略图仅接近视区时读取，切图及卸载后忽略迟到响应并断开观察器", async () => {
    const cells = [], observers = [], reads = [], completions = [];
    let cursor = 0;
    const effects = [];
    const react = {
        useRef(initial) { const index = cursor++; return cells[index] ||= { current: initial }; },
        useState(initial) {
            const index = cursor++; cells[index] ||= { value: initial };
            return [cells[index].value, value => { cells[index].value = value; }];
        },
        useEffect(callback, deps) {
            const index = cursor++, old = cells[index];
            if (!old || deps.some((value, key) => value !== old.deps[key])) {
                old?.cleanup?.();
                const cell = cells[index] = { deps };
                effects.push(() => { cell.cleanup = callback(); });
            }
        },
    };
    class Observer {
        constructor(callback) { this.callback = callback; observers.push(this); }
        observe() { this.connected = true; }
        disconnect() { this.connected = false; }
    }
    const jsx = (type, props) => ({ type, props });
    const dependencies = {
        react, "react/jsx-runtime": { jsx, jsxs: jsx }, "lucide-react": { ImageIcon: "icon" },
        "@/services/image-storage": { resolveCanvasImageSource(key) { reads.push(key); return new Promise(resolve => completions.push(resolve)); } },
    };
    const source = readFileSync(new URL("../扩展功能/媒体交付/媒体缩略图.tsx", import.meta.url), "utf8");
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    const module = { exports: {} };
    new Function("require", "module", "exports", "IntersectionObserver", code)(id => dependencies[id], module, module.exports, Observer);
    const render = key => {
        cursor = 0;
        const tree = module.exports.MediaThumbnail({ storageKey: key, fallback: "original:" + key });
        tree.props.ref.current = {};
        effects.splice(0).forEach(run => run());
        return tree;
    };
    render("a");
    assert.deepEqual(reads, []);
    observers[0].callback([{ isIntersecting: false }]); assert.deepEqual(reads, []);
    observers[0].callback([{ isIntersecting: true }]); assert.deepEqual(reads, ["a"]);
    assert.equal(observers[0].connected, false);
    render("b"); completions[0]("old-a");
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(render("b").props.children.type, "icon");
    observers[1].callback([{ isIntersecting: true }]);
    completions[1]("preview-b");
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(render("b").props.children.props.src, "preview-b");
    cells.forEach(cell => cell.cleanup?.());
    assert.ok(observers.every(observer => !observer.connected));
});
