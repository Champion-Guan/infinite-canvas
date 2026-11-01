import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { transformWithEsbuild } from "../.运行/3100源/画布副本/web/node_modules/vite/dist/node/index.js";
import { historyMediaInfo } from "../扩展功能/生成历史/历史媒体详情.js";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

async function loadStatusModule() {
  const file = resolve(root, "扩展功能/画布生成/配置节点状态显示.tsx");
  const { code } = await transformWithEsbuild(readFileSync(file, "utf8"), file, {
    loader: "tsx",
    format: "cjs",
    target: "es2022",
    tsconfigRaw: "{}",
  });
  const module = { exports: {} };
  new Function("require", "module", "exports", code)(
    id => {
      assert.equal(id, "@/stores/use-config-store");
      return { resolveModelChannel: () => ({ id: "channel-id", name: "当前渠道" }) };
    },
    module,
    module.exports,
  );
  return module.exports;
}

test("生成中的图片槽位优先显示本次实际渠道，旧数据有模型编码时回退", async () => {
  const { resultNodeLoadingLabel } = await loadStatusModule();
  assert.equal(resultNodeLoadingLabel({ metadata: { channel: "节点渠道" } }, "生成中"), "节点渠道 · 生成中");
  assert.equal(resultNodeLoadingLabel({ metadata: { channel: "根节点渠道" } }, "生成中", { channel: "槽位实际渠道" }), "槽位实际渠道 · 生成中");
  assert.equal(resultNodeLoadingLabel({ metadata: { model: "旧渠道ID::gpt-image-2" } }, "生成中"), "旧渠道ID · 生成中");
  assert.equal(resultNodeLoadingLabel({ metadata: {} }, "Generating"), "Generating");
});

test("生成历史只为存在成功文件的项目显示查看入口", () => {
  const source = readFileSync(resolve(root, "扩展功能/生成历史/生成历史页签.tsx"), "utf8");
  assert.match(source, /!selectionMode && nodeFiles\.length \? <span[^>]*>查看<\/span>/);
  assert.match(source, /nodeFiles\.length \? `查看\$\{node\.title \|\| "生成任务"\}的成功图片/);
  assert.match(source, /historyDownloadFiles\(displayedHistory\)/);
});

test("旧成功图片的历史记录能通过唯一模型反查渠道；失败槽不会产生查看文件", async () => {
  const legacy = { id: "legacy", type: "image", metadata: {
    status: "success", model: "channel-old::image-model",
    images: [{ id: "slot", status: "success", content: "local:image-model", model: "image-model" }],
    primaryImageId: "slot",
  } };
  const channels = [{ id: "channel-old", name: "旧渠道", models: [{ name: "image-model" }] }];
  assert.equal(historyMediaInfo(legacy, channels).channel, "旧渠道");
  assert.equal(historyMediaInfo({ ...legacy, metadata: { ...legacy.metadata, channel: "暂无", status: "error", images: [
    { id: "failed", status: "error", content: "", model: "image-model" },
  ] } }, channels).channel, "旧渠道");
});
