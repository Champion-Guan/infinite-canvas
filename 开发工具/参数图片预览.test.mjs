import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { transformWithEsbuild } from "../.运行/3100源/画布副本/web/node_modules/vite/dist/node/index.js";

const file = "扩展功能/Excel画布/参数图片预览.tsx";
const { code } = await transformWithEsbuild(readFileSync(file, "utf8"), file, { loader: "tsx", jsx: "automatic", format: "cjs", target: "es2022", tsconfigRaw: "{}" });
const jsx = (type, props) => ({ type, props });
const flatten = tree => tree && typeof tree === "object" ? Array.isArray(tree) ? tree.flatMap(flatten) : [tree, ...flatten(tree.props?.children)] : [];
function fixture(read = async () => new Blob(["original"])) {
    let cursor = 0, active = true, props = { image: { storageKey: "image:original", url: "blob:stale" }, name: "产品主图 1" };
    const states = [], effects = [], pending = [], reads = [], created = [], revoked = [];
    const module = { exports: {} };
    const deps = {
        react: {
            useState(initial) {
                const index = cursor++;
                if (!(index in states)) states[index] = initial;
                return [states[index], next => { states[index] = typeof next === "function" ? next(states[index]) : next; }];
            },
            useEffect(effect, dependencies) {
                const index = cursor++, previous = effects[index];
                if (!previous || dependencies.some((value, i) => !Object.is(value, previous.dependencies[i]))) {
                    pending.push(() => { previous?.cleanup?.(); effects[index] = { dependencies, cleanup: effect() }; });
                }
            },
        },
        "react/jsx-runtime": { jsx, jsxs: jsx },
        antd: { Image: "Image", Spin: "Spin" },
        "../媒体交付/媒体缩略图": { MediaThumbnail: "Thumbnail" },
        "../产品/产品界面边界": { useProductActive: () => active, createProductPortal: node => node },
        "../媒体交付/图片上传编号": { ImageUploadNumber: "ImageUploadNumber" },
        "../主题/原生可关闭浮层": { OutsidePopover: "Popover" },
        "../画布迁移扩展/media-download": { readDownloadBlob: async media => { reads.push(media); return read(media); } },
    };
    new Function("require", "module", "exports", "URL", "document", code)(name => {
        assert.ok(name in deps, name); return deps[name];
    }, module, module.exports, {
        createObjectURL(blob) { created.push(blob); return "blob:full-original-" + created.length; },
        revokeObjectURL(url) { revoked.push(url); },
    }, { body: {} });
    const render = () => {
        cursor = 0;
        const tree = flatten(module.exports.ParameterImageThumbnail(props));
        pending.splice(0).forEach(fn => fn());
        return { button: tree.find(item => item.type === "button"), image: tree.find(item => item.type === "Image") };
    };
    const tick = async () => { await new Promise(resolve => setImmediate(resolve)); return render(); };
    return { render, tick, reads, created, revoked,
        update: next => { props = { ...props, ...next }; },
        hide: () => { active = false; },
        unmount: () => effects.forEach(effect => effect?.cleanup?.()),
    };
}
const event = () => ({ stopped: false, stopPropagation() { this.stopped = true; } });

test("未点击不读取原图；点击隔离画布事件并读取持久原图供缩放预览", async () => {
    const f = fixture(), initial = f.render();
    assert.equal(f.reads.length, 0);
    assert.equal(initial.image, undefined);
    const click = event(); initial.button.props.onClick(click); assert.equal(click.stopped, true);
    f.render();
    assert.deepEqual(f.reads, [{ kind: "image", storageKey: "image:original", url: "blob:stale" }]);
    const loaded = await f.tick();
    assert.equal(loaded.image.props.preview.open, true);
    assert.equal(loaded.image.props.src, "blob:full-original-1");
    const pointer = event(); loaded.button.props.onPointerDown(pointer); assert.equal(pointer.stopped, true);
    f.unmount(); assert.deepEqual(f.revoked, ["blob:full-original-1"]);
});
test("关闭保留原生退场所需原图，退场结束释放URL，重新打开重新读取", async () => {
    const f = fixture(); f.render().button.props.onClick(event()); f.render();
    const loaded = await f.tick(); loaded.image.props.preview.onOpenChange(false);
    const closing = f.render(); assert.equal(closing.image.props.preview.open, false);
    assert.equal(f.revoked.length, 0);
    closing.image.props.preview.afterOpenChange(false); f.render();
    assert.deepEqual(f.revoked, ["blob:full-original-1"]);
    f.render().button.props.onClick(event()); f.render(); await f.tick();
    assert.equal(f.reads.length, 2);
    f.unmount();
});
test("卸载或切换图片后拒绝迟到结果，不创建无主预览URL", async () => {
    let release;
    const f = fixture(() => new Promise(resolve => { release = resolve; }));
    f.render().button.props.onClick(event()); f.render(); f.unmount();
    release(new Blob(["old"])); await f.tick();
    assert.equal(f.created.length, 0);
});
test("缺图时保留可关闭错误状态，不以缩略图冒充原图", async () => {
    const f = fixture(async () => { throw Error("本地原文件不存在"); });
    f.render().button.props.onClick(event()); f.render();
    const loaded = await f.tick();
    assert.equal(loaded.image.props.src, undefined);
    const error = flatten(loaded.image.props.preview.imageRender(null)).find(item => item.props?.role === "alert");
    assert.equal(error.props.children, "本地原文件不存在");
    assert.equal(loaded.image.props.preview.actionsRender("actions"), null);
    f.unmount();
});
test("切换产品关闭预览并释放原图", async () => {
    const f = fixture(); f.render().button.props.onClick(event()); f.render(); await f.tick();
    f.hide(); const hidden = f.render();
    assert.equal(hidden.image.props.preview.open, false);
    assert.deepEqual(f.revoked, ["blob:full-original-1"]);
    f.unmount();
});
