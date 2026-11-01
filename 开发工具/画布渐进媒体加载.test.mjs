import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { transformWithEsbuild } from "../.运行/3100源/画布副本/web/node_modules/vite/dist/node/index.js";

async function loadImageStorage(createImageThumbnail) {
    const file = ".运行/3100源/画布副本/web/src/services/image-storage.ts";
    const { code } = await transformWithEsbuild(readFileSync(file, "utf8"), file, { loader: "ts", format: "cjs", target: "es2022", tsconfigRaw: "{}" });
    const stores = new Map();
    const reads = new Map();
    const urls = new Map();
    const pendingUrls = new Map();
    const createdUrls = [];
    let urlNumber = 0;
    const urlApi = {
        createObjectURL(blob) { const url = `blob:test-${++urlNumber}`; createdUrls.push({ url, blob }); return url; },
        revokeObjectURL() {},
    };
    const localforage = {
        createInstance({ storeName }) {
            if (!stores.has(storeName)) stores.set(storeName, new Map());
            const values = stores.get(storeName);
            return {
                async getItem(key) {
                    reads.set(`${storeName}:${key}`, (reads.get(`${storeName}:${key}`) || 0) + 1);
                    return values.get(key) ?? null;
                },
                async setItem(key, value) { values.set(key, value); return value; },
                async removeItem(key) { values.delete(key); },
                async iterate(iterator) { values.forEach((value, key) => iterator(value, key)); },
            };
        },
    };
    const mediaCache = {
        resolve: async (key, read, fallback) => {
            if (urls.has(key)) return urls.get(key);
            if (!pendingUrls.has(key)) {
                pendingUrls.set(key, Promise.resolve().then(read).then(blob => {
                    if (!blob) return fallback;
                    const url = urlApi.createObjectURL(blob);
                    urls.set(key, url);
                    return url;
                }).finally(() => pendingUrls.delete(key)));
            }
            return pendingUrls.get(key);
        },
        set(key, url) { urls.set(key, url); },
        get(key) { return urls.get(key); },
        delete(key) { urls.delete(key); },
    };
    class Reader {
        readAsDataURL(blob) {
            this.result = `data:${blob.type};base64,decoded`;
            queueMicrotask(() => this.onload?.());
        }
    }
    const dependencies = {
        "@/扩展功能/素材/上传资产规则": { captureUserUpload: () => null },
        "@/扩展功能/媒体交付/媒体地址缓存": { createMediaUrlCache: () => mediaCache },
        "@/扩展功能/网络代理/本地转发请求": { 本地转发请求: async () => ({ ok: true, blob: async () => new Blob(["read-by-key"], { type: "image/png" }) }) },
        "@/扩展功能/本机存储/上游浏览器存储桥": { sqliteForage: localforage },
        nanoid: { nanoid: () => "test" },
        "@/扩展功能/画布迁移扩展/内嵌图片解码.mjs": { decodeInlineImage: value => value },
        "@/扩展功能/安全与批量/persistence-checkpoint": { createPersistenceCheckpoint: () => ({ run: (_key, callback) => callback() }) },
        "@/扩展功能/安全与批量/settle-activity-group": { settleActivityGroup: async tasks => Promise.all(tasks) },
        "@/i18n": { default: { t: key => key } },
        "@/扩展功能/媒体交付/生成图片尺寸交付.mjs": { parseDeliverySize: () => undefined, prepareGeneratedDelivery: async (blob, metadata) => ({ blob, metadata }) },
        "@/扩展功能/媒体交付/图片上传预检.mjs": { preflightImageUpload: async () => ({ width: 1, height: 1 }) },
        "@/扩展功能/媒体交付/HEIC上传兼容.mjs": { prepareCompatibleImage: async blob => ({ original: blob, delivery: blob }) },
        "@/扩展功能/媒体交付/上传前存储检查.mjs": { assertUploadStorageReady: () => {} },
        "@/stores/use-config-store": { withLocalProxy: value => value },
        "@/lib/image-thumbnail": { createImageThumbnail },
    };
    const module = { exports: {} };
    new Function("require", "module", "exports", "URL", "FileReader", "window", code)((id) => {
        assert.ok(Object.hasOwn(dependencies, id), id);
        return dependencies[id];
    }, module, module.exports, urlApi, Reader, { setTimeout, clearTimeout });
    return { image: module.exports, stores, reads, createdUrls };
}

test("同一图片并发恢复共用一次解码，优先返回缓存缩略图", async () => {
    let decodes = 0;
    const fixture = await loadImageStorage(async () => {
        decodes++;
        await Promise.resolve();
        return new Blob(["preview"], { type: "image/webp" });
    });
    fixture.stores.get("image_files").set("image:shared", new Blob(["original"], { type: "image/png" }));

    const sources = await Promise.all(Array.from({ length: 40 }, () => fixture.image.resolveCanvasImageSource("image:shared")));

    assert.equal(decodes, 1);
    assert.equal(fixture.reads.get("image_files:image:shared"), 1);
    assert.equal(fixture.stores.get("image_previews").get("image:shared").version, 2);
    assert.equal(fixture.createdUrls.length, 1);
    assert.equal(new Set(sources).size, 1);
});

test("无需缩略图时回退原图URL，并复用同一个原图对象URL", async () => {
    let decodes = 0;
    const fixture = await loadImageStorage(async () => { decodes++; return undefined; });
    fixture.stores.get("image_files").set("image:small", new Blob(["small"], { type: "image/png" }));

    const sources = await Promise.all(Array.from({ length: 20 }, () => fixture.image.resolveCanvasImageSource("image:small")));

    assert.equal(decodes, 1);
    assert.equal(fixture.reads.get("image_files:image:small"), 2);
    assert.equal(fixture.createdUrls.length, 1);
    assert.equal(new Set(sources).size, 1);
});

test("生成请求的持久化图片主键优先于已失效的旧内嵌地址", async () => {
    const fixture = await loadImageStorage(async () => undefined);
    fixture.stores.get("image_files").set("image:original", new Blob(["original"], { type: "image/png" }));

    const result = await fixture.image.imageToDataUrl({ storageKey: "image:original", dataUrl: "[image omitted]" });

    assert.equal(result, "data:image/png;base64,decoded");
    assert.equal(fixture.reads.get("image_files:image:original"), 1);
    assert.equal(fixture.createdUrls.length, 1);
});
