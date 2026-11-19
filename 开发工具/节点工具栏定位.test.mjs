import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { transformWithEsbuild } from "../.运行/3100源/画布副本/web/node_modules/vite/dist/node/index.js";

const file = "扩展功能/画布交互/节点工具栏定位.ts";
const { code } = await transformWithEsbuild(readFileSync(file, "utf8"), file, { loader: "ts", format: "cjs", target: "es2022", tsconfigRaw: "{}" });
const module = { exports: {} };
new Function("module", "exports", code)(module, module.exports);
const { nodeToolbarTop } = module.exports;

test("顶部空间充足，功能栏完整位于卡片外且保留14px间距", () => {
    for (const top of [126, 200, 400, 900]) {
        assert.equal(nodeToolbarTop(top) + 48, top - 14);
    }
});
test("实时视区绘制在卡片外和图内切换，保持屏幕尺寸不随缩放变形", () => {
    const toolbar = { dataset: { toolbarNodeX: "100", toolbarNodeY: "100", toolbarNodeWidth: "300" }, style: {} };
    const selection = { dataset: { toolbarNodeX: "0", toolbarNodeY: "100", toolbarNodeWidth: "600", toolbarNodeOffsetY: "-8" }, style: {} };
    const root = { querySelectorAll: () => [toolbar, selection] };
    module.exports.paintNodeToolbar(root, {x: 20, y: 200, k: .5});
    assert.deepEqual(toolbar.style, {left: "145px", top: "188px"});
    assert.deepEqual(selection.style, {left: "170px", top: "180px"});
    module.exports.paintNodeToolbar(root, {x: 20, y: -200, k: .5});
    assert.deepEqual(toolbar.style, {left: "145px", top: "0px"});
    assert.equal(selection.style.top, "0px", "内容层顶部才是工具栏的真实边界");
    module.exports.paintNodeToolbar(null, {x: 0, y: 0, k: 1});
});
test("外侧空间不足时才移入图片顶部", () => {
    assert.equal(nodeToolbarTop(50), 60);
    assert.equal(nodeToolbarTop(125), 63);
    assert.equal(nodeToolbarTop(100), 38);
});
test("图片顶部已经被裁切，工具栏留在标题区下方的可见图片内", () => {
    assert.equal(nodeToolbarTop(-300), 0);
    assert.equal(nodeToolbarTop(-50), 0);
    assert.equal(nodeToolbarTop(0), 10);
    assert.equal(nodeToolbarTop(40), 50);
});
test("平移缩放后的屏幕坐标决定位置，不使用图片尺寸或固定画布坐标", () => {
    assert.equal(nodeToolbarTop(150 + 100 * .45), 133);
    assert.equal(nodeToolbarTop(-60 + 100 * .45), 0);
    assert.equal(nodeToolbarTop(200 + 100 * 2), 338);
});
