import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { transformWithEsbuild } from "../.运行/3100源/画布副本/web/node_modules/vite/dist/node/index.js";
import { imageRequestSizePlan } from "../扩展功能/媒体交付/生成图片尺寸交付.mjs";

async function load(file, deps = {}) {
    const { code } = await transformWithEsbuild(readFileSync(file, "utf8"), file, { loader: file.endsWith(".tsx") ? "tsx" : "ts", jsx: "automatic", format: "cjs", target: "es2022", tsconfigRaw: "{}" });
    const module = { exports: {} };
    new Function("require", "module", "exports", code)(id => {
        assert.ok(Object.hasOwn(deps, id), `未声明依赖：${id}`);
        return deps[id];
    }, module, module.exports);
    return module.exports;
}
const rules = await load("扩展功能/画布生成/一键超人规则.ts");
const source = () => ({ id: "source", type: "image", title: "原图", width: 300, height: 400, position: { x: 10, y: 20 },
    metadata: { content: "blob:source", storageKey: "image:source", size: "1800x2400", naturalWidth: 1086, naturalHeight: 1448, model: "image-model" } });

async function fixture(options = {}) {
    let sequence = 0, selected, selectedConnection, finishes = 0;
    const calls = [], messages = [], work = [], edges = [];
    const nodesRef = { current: [source(), { ...source(), id: "other", metadata: { content: "blob:other" } }] };
    const port = {
        projectId: "product", nodesRef,
        surfaceRef: { current: { mounted: true, active: true, projectId: "product", ...options.surface } },
        effectiveConfig: { model: "default", count: "8" },
        setNodes: update => { nodesRef.current = update(nodesRef.current); },
        setConnections: update => { edges.splice(0, edges.length, ...update(edges)); },
        setSelectedNodeIds: ids => { selected = ids; },
        setSelectedConnectionId: id => { selectedConnection = id; },
        startGenerationRequest: () => new AbortController(),
        finishGenerationRequest: () => { finishes++; },
        message: { warning: text => messages.push(text), error: text => messages.push(text) },
        requestImageTool: async (...args) => {
            calls.push(args);
            if (options.failure) throw Error("上游不可用");
            if (options.gate) await options.gate;
            port.setNodes(nodes => nodes.map(node => node.id === args[0] ? { ...node, metadata: { ...node.metadata, content: "blob:result", status: "success" } } : node));
        },
    };
    const hook = await load("扩展功能/画布生成/一键超人操作.ts", {
        react: { useCallback: fn => fn }, nanoid: { nanoid: () => `id-${++sequence}` },
        "@/types/canvas": { CanvasNodeType: { Image: "image" } },
        "@/lib/canvas/canvas-generation-helpers": {
            buildGenerationConfig: (config, node) => ({ ...config, ...node.metadata }),
            isGenerationCanceled: error => error.name === "AbortError",
        },
        "@/lib/canvas/canvas-node-factory": { buildImageGenerationMetadata: (generationType, config, count, refs) =>
            ({ generationType, model: config.model, size: config.size, count, references: refs.map(ref => ref.storageKey) }) },
        "../产品配置/模型配置门禁": { ensureModelConfigured: () => options.configured !== false },
        "../产品/画布驻留保护": { productCanvasResidency: { run: (_id, fn) => { const task = fn(); work.push(task); return task; } } },
        "./一键超人规则": rules,
        "../媒体交付/生成图片尺寸交付.mjs": { imageRequestSizePlan, parseDeliverySize: value => {
            const [width,height] = value.split("x").map(Number);
            if (width > 16384 || height > 16384 || width * height > 40000000) throw Error("尺寸过大");
            return {width,height};
        } },
    });
    return { port, calls, messages, edges, run: hook.useImageSuperGeneration(port), done: () => Promise.all(work),
        state: () => ({ selected, selectedConnection, finishes }) };
}

test("主体尺寸要求保留数字单位，明确箭头测量方向且禁止推断", () => {
    const prompt = rules.buildImageSuperPrompt("dimensions", " 主体高72cm、宽36cm、深23cm ");
    assert.match(prompt, /产品主体添加尺寸标注/);
    assert.match(prompt, /尺寸线、延长线、箭头/);
    assert.match(prompt, /不是图片像素尺寸/);
    assert.match(prompt, /不根据图片比例或常识估算/);
    assert.ok(prompt.endsWith("主体高72cm、宽36cm、深23cm"));
});
test("语言和颜色只编辑指定内容", () => {
    assert.match(rules.buildImageSuperPrompt("language", "俄文"), /保留原意、数字、尺寸、单位/);
    assert.match(rules.buildImageSuperPrompt("color", "哑光黑"), /保留材质质感/);
    assert.throws(() => rules.buildImageSuperPrompt("language", " \n "));
    assert.throws(() => rules.buildImageSuperPrompt("unknown", "x"));
});
for (const action of ["language", "color", "dimensions"]) test(`${action}立即以当前图片单独生成并保留原卡`, async () => {
    const f = await fixture(), before = structuredClone(f.port.nodesRef.current);
    assert.equal(f.run(source(), action, "用户要求"), true);
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0][1].count, "1");
    assert.equal(f.calls[0][1].size, "1086x1448");
    assert.equal(f.calls[0][1].model, "image-model");
    assert.equal(f.calls[0][3].length, 1);
    assert.equal(f.calls[0][3][0].storageKey, "image:source");
    assert.equal(f.edges.length, 1);
    assert.equal(f.edges[0].fromNodeId, "source");
    await f.done();
    assert.deepEqual(f.port.nodesRef.current.slice(0, 2), before);
    assert.equal(f.port.nodesRef.current[2].metadata.status, "success");
    assert.equal(f.state().finishes, 1);
});
test("空输入、失效图片、后台画布和未配置模型不建卡不请求", async () => {
    for (const options of [{}, { surface: { active: false } }, { configured: false }, { surface: { projectId: "other" } }]) {
        const f = await fixture(options);
        const input = Object.keys(options).length ? "黑色" : " ";
        assert.equal(f.run(source(), "color", input), false);
        assert.equal(f.calls.length, 0);
        assert.equal(f.port.nodesRef.current.length, 2);
    }
    const f = await fixture();
    f.port.nodesRef.current = [];
    assert.equal(f.run(source(), "color", "黑色"), false);
});
test("读取最新图片引用，失败结果保留可重试且释放运行状态", async () => {
    const f = await fixture({ failure: true });
    f.port.nodesRef.current[0].metadata.storageKey = "image:replaced";
    assert.equal(f.run(source(), "color", "黑色"), true);
    await f.done();
    assert.equal(f.calls[0][3][0].storageKey, "image:replaced");
    assert.equal(f.port.nodesRef.current[2].metadata.status, "error");
    assert.equal(f.port.nodesRef.current[2].metadata.errorDetails, "上游不可用");
    assert.equal(f.state().finishes, 1);
});
test("并发操作各自有独立结果、输入快照和引用", async () => {
    let release;
    const f = await fixture({ gate: new Promise(resolve => { release = resolve; }) });
    f.run(source(), "language", "英文");
    f.run(source(), "dimensions", "高72cm");
    assert.notEqual(f.calls[0][0], f.calls[1][0]);
    assert.match(f.calls[0][2], /英文\n输出图片/);
    assert.match(f.calls[1][2], /高72cm\n输出图片/);
    release();
    await f.done();
    assert.equal(f.state().finishes, 2);
});
test("采用显示原图的像素尺寸，不继承旧生成尺寸或画布卡片尺寸", async () => {
    const f = await fixture();
    f.port.nodesRef.current[0].metadata.deliveryWidth = 1800;
    f.port.nodesRef.current[0].metadata.deliveryHeight = 2400;
    f.run(source(), "color", "黑色");
    await f.done();
    assert.equal(f.calls[0][1].size, "1800x2400");
    assert.equal(f.port.nodesRef.current[2].metadata.imageSuperSourceSize, "1800x2400");
    assert.match(f.calls[0][2], /1800 × 2400 px/);
});
test("缺失或超出支持范围的原图尺寸不擅自改用默认分辨率", async () => {
    for (const width of [undefined, 20000]) {
        const f = await fixture();
        f.port.nodesRef.current[0].metadata.naturalWidth = width;
        assert.equal(f.run(source(), "color", "黑色"), false);
        assert.equal(f.calls.length, 0);
    }
});
test("旧工具栏偏好补上新入口，新版明确隐藏的选择保存恢复后不被重置", async () => {
    const tools = await load(".运行/3100源/画布副本/web/src/components/canvas/canvas-image-toolbar-tools.tsx", {
        "react/jsx-runtime": { jsx: () => null },
        "lucide-react": new Proxy({}, { get: () => () => null }),
        "@/i18n": { default: { t: key => key } },
    });
    assert.ok(tools.defaultImageQuickToolIds.includes("superGenerate"));
    assert.ok(tools.readImageQuickToolsConfig(["info"]).ids.includes("superGenerate"));
    assert.ok(tools.readImageQuickToolsConfig({ids: ["info"], showLabels: true}).ids.includes("superGenerate"));
    const hidden = tools.readImageQuickToolsConfig({ids: ["info"], showLabels: true, superToolsVersion: 1});
    assert.deepEqual(hidden.ids, ["info"]);
    assert.equal(hidden.showLabels, true);
});
