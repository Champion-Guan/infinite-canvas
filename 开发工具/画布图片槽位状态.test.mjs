import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { transformWithEsbuild } from "../.运行/3100源/画布副本/web/node_modules/vite/dist/node/index.js";

async function loadSlotState() {
    const file = resolve("src/canvas/lib/canvas/canvas-image-slot-state.ts");
    const { code } = await transformWithEsbuild(readFileSync(file, "utf8"), file, {
        loader: "ts",
        format: "cjs",
        target: "es2022",
        tsconfigRaw: "{}",
    });
    const module = { exports: {} };
    new Function("module", "exports", code)(module, module.exports);
    return module.exports.canvasImageSlotState;
}

test("图片槽位区分空态、生成中、素材加载和失败", async () => {
    const state = await loadSlotState();
    assert.equal(state(undefined), "empty");
    assert.equal(state({ status: "idle" }), "empty");
    assert.equal(state({ status: "loading" }), "generating");
    assert.equal(state({ status: "success" }), "loading");
    assert.equal(state({ status: "error" }), "error");
});
