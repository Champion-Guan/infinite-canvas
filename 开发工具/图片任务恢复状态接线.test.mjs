import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../上游适配/指定渠道图片自动重试状态接入.patch", import.meta.url), "utf8");

test("图片卡片把原任务恢复状态接到根图和批次图", () => {
    assert.match(source, /ImageAutoRetryStatus/);
    assert.match(source, /<ImageSlotStatus node=\{node\} image=\{primaryImage\} \/>/);
    assert.match(source, /<ImageSlotStatus node=\{node\} image=\{image\} \/>/);
    assert.match(source, /<ImageAutoRetryStatus node=\{node\} slotId=\{image\?\.id\}/);
    assert.match(source, /<ImageAutoRetryStatus node=\{node\} label=\{resultNodeLoadingLabel\(node, t\("canvas\.node\.generating"\)\)\}/);
});
