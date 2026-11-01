import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const source = readFileSync("扩展功能/软件更新/软件更新设置.tsx", "utf8");

test("更新设置不再渲染生成任务恢复提示面板", () => {
    assert.doesNotMatch(source, /UpgradeTaskReview/);
    assert.doesNotMatch(source, /升级前仍需恢复/);
    assert.match(source, /OnlineInstallActions/);
});
